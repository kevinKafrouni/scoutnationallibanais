import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testDatabase } from './support/database.js';

async function checkResponsiveLayout(page, card = false) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflows at ${width}px`);
    if (card) {
      const layout = await page.locator('.id-card').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const nodes = [...element.querySelectorAll('.id-card-brand, dt, dd, .photo-box, .qr-code')];
        const contained = nodes.every(node => {
          const rect = node.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom;
        });
        const header = element.querySelector('.id-card-brand').getBoundingClientRect();
        const body = element.querySelector('.id-card-body').getBoundingClientRect();
        return contained && header.bottom <= body.top;
      });
      assert.ok(layout, `Card content overlaps or escapes at ${width}px`);
    }
  }
}

test('browser registration, reload, photo, exports, and sign-in', { timeout: 60000 }, async (t) => {
  const engine = new PGlite();
  const db = testDatabase(engine);
  const server = createServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await engine.close();
  });
  const password = 'browser-test-password';
  await migrate(db, password);
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp(db, { origin }));
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await expect(page.locator('h1')).toContainText('Adventure');
  await checkResponsiveLayout(page);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Login / Register', exact: true }).first().click();
  await expect(page.locator('#memberCountPublic')).toHaveText('0');
  await expect(page.locator('#unusedCodeCountPublic, #unusedCodeCount, #usedCodeCount')).toHaveCount(0);
  await checkResponsiveLayout(page);
  await expect(page.locator('.auth-tab')).toHaveCount(2);
  await expect(page.locator('#adminSignInPanel')).toHaveCount(0);
  await page.locator('#signInScoutId').fill('admin');
  await page.locator('#signInPassword').fill('incorrect-password');
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#signInMessage')).toHaveText('Incorrect sign-in details.');
  await expect(page.locator('#adminView')).toBeHidden();
  await page.locator('#signInPassword').fill(password);
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#adminView')).toBeVisible();
  await page.locator('#codeQuantity').fill('2');
  await page.locator('#codeForm button').click();
  await expect(page.locator('.code-chip')).toHaveCount(2);
  const code = await page.locator('.code-chip').first().textContent();
  await page.locator('#signOutButton').click();
  await expect(page.locator('#authView')).toBeVisible();
  await page.locator('[data-auth-panel="memberSignUpPanel"]').click();
  await expect(page.locator('#memberSignUpPanel input[type="file"]')).toHaveCount(0);
  await page.locator('#memberSignUpPanel input[name="username"]').fill('browser.scout');
  await page.locator('#accessCode').fill(code);
  await page.locator('#firstName').fill('Browser');
  await page.locator('#lastName').fill('Scout');
  await page.locator('#fatherName').fill('Parent Scout');
  await page.locator('#dateOfBirth').fill('2004-05-12');
  await page.locator('#bloodType').selectOption('A+');
  await page.locator('#signUpPassword').fill(password);
  await page.locator('#memberSignUpPanel button').click();
  await expect(page.locator('#memberView')).toBeVisible();
  await expect(page.locator('#profileName')).toHaveText('Browser Scout');
  await checkResponsiveLayout(page, true);
  await page.locator('#cardLastName').evaluate(node => { node.textContent = 'LongFamilyName'.repeat(4); });
  await checkResponsiveLayout(page, true);
  const scoutId = await page.locator('#profileScoutId').textContent();
  await page.reload();
  await expect(page.locator('#profileScoutId')).toHaveText(scoutId);
  await expect(page.locator('#cardFatherName')).toHaveText('Parent Scout');
  await expect(page.locator('#cardQr')).toHaveJSProperty('complete', true);
  assert.ok(await page.locator('#cardQr').evaluate(image => image.naturalWidth > 0));
  await page.locator('#profilePhotoUpdate').setInputFiles({
    name: 'photo.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII=', 'base64'),
  });
  await page.locator('#photoForm button').click();
  await expect(page.locator('#profileMessage')).toHaveText('Profile photo updated.');
  await expect(page.locator('#cardPhoto')).toHaveClass('visible');
  await page.locator('#signOutButton').click();
  await expect(page.locator('#authView')).toBeVisible();
  await page.locator('[data-auth-panel="memberSignInPanel"]').click();
  await page.locator('#signInScoutId').fill('BROWSER.SCOUT');
  await page.locator('#signInPassword').fill(password);
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#memberView')).toBeVisible();
  await expect(page.locator('#cardPhoto')).toHaveClass('visible');
  await page.locator('#signOutButton').click();
  await expect(page.locator('#authView')).toBeVisible();
  await page.locator('#signInScoutId').fill(' ADMIN ');
  await page.locator('#signInPassword').fill(password);
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('1');
  await expect(page.locator('#membersTable')).toContainText('Browser');
  await checkResponsiveLayout(page);
  const downloaded = page.waitForEvent('download');
  await page.locator('#exportJson').click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(exported.members.length, 1);
  assert.equal(exported.members[0].fatherName, 'Parent Scout');
  assert.equal(exported.members[0].password, undefined);
  assert.equal(exported.session, undefined);
  await page.locator('#addMember').click();
  for (const [name, value] of Object.entries({ username: 'added.scout', firstName: 'Added', lastName: 'Scout', fatherName: 'Parent', dateOfBirth: '2005-04-17', password })) {
    await page.locator(`#memberEditor [name="${name}"]`).fill(value);
  }
  await page.locator('#memberEditor button[type="submit"]').click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('2');
  const addedRow = page.locator('#membersTable tr').filter({ hasText: 'added.scout' });
  await addedRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#memberEditor [name="firstName"]').fill('Edited');
  await page.locator('#memberEditor button[type="submit"]').click();
  await expect(addedRow).toContainText('Edited');
  page.once('dialog', dialog => dialog.accept());
  await addedRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('1');
  assert.deepEqual(errors, []);
});
