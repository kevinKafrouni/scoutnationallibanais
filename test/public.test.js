import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server/app.js';

test('public pages, contact validation and keyboard navigation', async t => {
  const server = createApp({ query: async () => ({ rows: [{ members: 0, unused: 0 }] }) }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/contact']) {
    await page.goto(base + path);
    await expect(page.locator('#siteNav')).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} overflows at ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#siteNav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#siteNav')).toBeHidden();
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.locator('#contactName')).toBeFocused();
  await expect(page.locator('#nameError')).toHaveText('Please complete this field.');
  await page.locator('#contactName').fill('Test Scout');
  await page.locator('#contactEmail').fill('invalid');
  await page.locator('#contactSubject').fill('Joining');
  await page.locator('#contactMessage').fill('How can I join?');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.locator('#emailError')).toHaveText('Enter a valid email address.');
  await page.locator('#contactEmail').fill('scout@example.com');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.locator('#contactStatus')).toContainText('Message not sent.');
  await expect(page.locator('#contactMessage')).toHaveValue('How can I join?');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();
  await page.goto(base);
  await expect(page.locator('.branch-card')).toHaveCount(4);
  assert.ok(await page.locator('.hero-photo').evaluate(img => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: process.env.TEMP + '/snl-home-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: process.env.TEMP + '/snl-home-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Join Us' }).first().click();
  await expect(page.locator('#memberSignUpPanel')).toBeVisible();
  assert.deepEqual(errors, []);
});
