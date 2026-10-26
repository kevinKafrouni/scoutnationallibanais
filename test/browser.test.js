import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testDatabase } from './support/database.js';
import ExcelJS from 'exceljs';
import { memberWorkbook } from '../server/member-import.js';

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
  await page.locator('#codeGroup').selectOption('024');
  await page.locator('#codeRegion').selectOption('02');
  await page.locator('#codeRole').selectOption('2');
  await page.locator('#codeQuantity').fill('2');
  await page.locator('#codeForm button').click();
  await expect(page.locator('.code-chip')).toHaveCount(2);
  const code = await page.locator('.code-chip').first().textContent();
  await page.locator('#signOutButton').click();
  await expect(page.locator('#authView')).toBeVisible();
  await page.locator('[data-auth-panel="memberSignUpPanel"]').click();
  await expect(page.locator('#memberSignUpPanel input[type="file"]')).toHaveCount(0);
  await page.locator('#accessCode').fill(code);
  await page.locator('#firstName').fill('Browser');
  await page.locator('#lastName').fill('Scout');
  await expect(page.locator('#memberSignUpPanel input[name="username"]')).toHaveCount(0);
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
  await page.locator('#signInScoutId').fill('BROWSER-SCOUT');
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
  await expect(page.locator('#memberEditor input[name="username"]')).toHaveCount(0);
  for (const [name, value] of Object.entries({ firstName: 'Added', lastName: 'Scout', fatherName: 'Parent', dateOfBirth: '2005-04-17', password })) {
    await page.locator(`#memberEditor [name="${name}"]`).fill(value);
  }
  await page.locator('#memberEditor button[type="submit"]').click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('2');
  const addedRow = page.locator('#membersTable tr').filter({ hasText: 'added-scout' });
  await addedRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#memberEditor [name="firstName"]').fill('Edited');
  await page.locator('#memberEditor button[type="submit"]').click();
  await expect(addedRow).toContainText('Edited');
  page.once('dialog', dialog => dialog.accept());
  await addedRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('1');
  const accessCode = await page.locator('.code-chip:not(.used)').first().textContent();
  let errorDownloads = 0;
  const countErrorDownload = () => { errorDownloads++; };
  page.on('download', countErrorDownload);
  await page.route('**/api/admin/members-workbook?template=1', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Please sign in again.' }) }));
  await page.locator('#downloadExcelTemplate').click();
  await expect(page.locator('#importMessage')).toHaveText('Please sign in again.');
  assert.equal(errorDownloads, 0);
  await page.unroute('**/api/admin/members-workbook?template=1');
  await page.route('**/api/admin/members-workbook?template=1', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown API endpoint.' }) }));
  await page.locator('#downloadExcelTemplate').click();
  await expect(page.locator('#importMessage')).toContainText('The local server is running an older API.');
  assert.equal(errorDownloads, 0);
  page.off('download', countErrorDownload);
  await page.unroute('**/api/admin/members-workbook?template=1');
  for (const [button, filename] of [['#downloadExcelTemplate', 'member-template.xlsx'], ['#exportMembersWorkbook', 'members-bulk-edit.xlsx']]) {
    const downloading = page.waitForEvent('download');
    await page.locator(button).click();
    const exportedWorkbook = await downloading;
    assert.equal(exportedWorkbook.suggestedFilename(), filename);
    const workbookStream = await exportedWorkbook.createReadStream();
    const bytes = [];
    for await (const chunk of workbookStream) bytes.push(chunk);
    const check = new ExcelJS.Workbook();
    await check.xlsx.load(Buffer.concat(bytes));
    assert.equal(check.getWorksheet('Members').getCell('C1').text, 'Card ID');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await memberWorkbook([
    { firstName: 'Imported', lastName: 'One', fatherName: 'Parent', dateOfBirth: '2004-05-12', bloodType: 'O+', cardId: 'SNL-40' },
    { firstName: 'Imported', lastName: 'Two', fatherName: 'Parent', dateOfBirth: '2004-05-12', bloodType: 'A+', cardId: 'SNL-41' },
  ]));
  workbook.getWorksheet('Members').getCell('J2').value = 'provided-long-password';
  await page.locator('#importFile').setInputFiles({ name: 'members.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  await page.locator('#importForm button').click();
  await expect(page.locator('#importSummary')).toContainText('2 new records, 0 records to update');
  await expect(page.locator('#memberCountAdmin')).toHaveText('1');
  await page.locator('#confirmImport').click();
  await expect(page.locator('#memberCountAdmin')).toHaveText('3');
  const credentialsDownload = page.waitForEvent('download');
  await page.locator('#downloadImportCredentials').click();
  const credentialsStream = await (await credentialsDownload).createReadStream();
  const credentialChunks = [];
  for await (const chunk of credentialsStream) credentialChunks.push(chunk);
  const credentialWorkbook = new ExcelJS.Workbook();
  await credentialWorkbook.xlsx.load(Buffer.concat(credentialChunks));
  const credentialSheet = credentialWorkbook.getWorksheet('Credentials');
  assert.equal(credentialSheet.rowCount, 3);
  assert.equal(credentialSheet.getCell('C2').text, 'imported-one');
  assert.equal(credentialSheet.getCell('D2').text, 'provided-long-password');
  const importedLoginId = credentialSheet.getCell('A2').text;
  await page.locator('#memberSearch').fill('Imported');
  await page.locator('#bulkEditIds').click();
  const idInputs = page.locator('#bulkIdRows input[name="cardId"]');
  await expect(idInputs).toHaveCount(2);
  for (const [index, row] of (await page.locator('#bulkIdRows tr').all()).entries()) {
    await row.locator('[name="cardIdMode"]').selectOption('structured');
    await row.locator('[name="regionCode"]').selectOption('02');
    await row.locator('[name="groupCode"]').selectOption(index === 0 ? '03' : '027');
    await row.locator('[name="roleCode"]').selectOption(index === 0 ? '1' : '2');
    await row.locator('[name="cardSerial"]').fill('0001');
  }
  await expect(idInputs.nth(0)).toHaveValue('020310001');
  await expect(idInputs.nth(1)).toHaveValue('0202720001');
  await page.locator('#bulkIdForm button[type="submit"]').click();
  await expect(page.locator('#importSummary')).toContainText('0 new records, 2 records to update');
  await page.locator('#confirmImport').click();
  await expect(page.locator('#importMessage')).toHaveText('Saved 0 new records and updated 2 records.');
  await expect(page.locator('#membersTable')).toContainText('020310001');
  await checkResponsiveLayout(page);
  await page.locator('#signOutButton').click();
  await expect(page.locator('#downloadImportCredentials')).toBeHidden();
  await page.locator('#signInScoutId').fill('imported-one');
  await page.locator('#signInPassword').fill('provided-long-password');
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#activationView')).toBeVisible();
  await expect(page.locator('#memberView')).toBeHidden();
  await page.reload();
  await expect(page.locator('#activationView')).toBeVisible();
  await page.locator('#activationForm [name="accessCode"]').fill(accessCode);
  await page.locator('#activationForm [name="password"]').fill('chosen-new-password');
  await page.locator('#activationForm button').click();
  await expect(page.locator('#memberView')).toBeVisible();
  await expect(page.locator('#profileScoutId')).toHaveText('0202420002');
  await expect(page.locator('#cardScoutId')).toHaveText('0202420002');
  await expect(page.locator('#profileLoginId')).toHaveText(importedLoginId);
  await expect(page.locator('#activationView')).toBeHidden();
  await page.locator('#signOutButton').click();
  await page.locator('#signInScoutId').fill(importedLoginId);
  await page.locator('#signInPassword').fill('chosen-new-password');
  await page.locator('#memberSignInPanel button').click();
  await expect(page.locator('#memberView')).toBeVisible();
  assert.deepEqual(errors, []);
});
