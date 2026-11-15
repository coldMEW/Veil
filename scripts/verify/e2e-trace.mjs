import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { base, out, prepare, emit } from './common.mjs';
let browser;
const started = Date.now();
try {
  await prepare();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '#/trace', { waitUntil: 'networkidle' });
  await page.locator('.vault input[type=file]').setInputFiles('public/demo/source/selfie-1.jpg');
  await page.waitForSelector('.vault-list li', { timeout: 90000 });
  const t = Date.now();
  await page.getByRole('tab', { name: 'Check a page I know' }).click();
await page.getByRole('button', { name: 'demo leaks page' }).click();
  await page.waitForFunction(
    () =>
      /pictures show you|matches your face|Could not scan/.test(
        document.querySelector('.results-head')?.textContent ?? '',
      ),
    null,
    { timeout: 180000 },
  );
  const scanMs = Date.now() - t;
  const hits = await page
    .locator('.hits li img')
    .evaluateAll((elements) => elements.map((e) => e.currentSrc));
  // Inspect matched original URLs in the app's ticket store; thumbnails themselves are data URIs.
  const ticketData = await page.evaluate(() => JSON.parse(localStorage.getItem('veil.tickets.v1') ?? '[]'));
  const matchedUrls = ticketData.map((t) => t.imageUrl ?? '');
  await page.screenshot({ path: join(out, 'e2e-trace.png') });
  await page.goto(base + '#/tickets', { waitUntil: 'networkidle' });
  await page.locator('.ticket-list li').first().waitFor({ timeout: 30000 });
  const tickets = await page.locator('.ticket-list li').count();
  if (tickets) {
    await page.locator('.ticket-list li a').first().click();
    await page.screenshot({ path: join(out, 'e2e-ticket.png'), fullPage: true });
  }
  const expected = ['fake-party', 'fake-crypto-ad', 'fake-arrest', 'selfie-3', 'fake-beach'];
  emit('trace', {
    ok:
      hits.length === 5 &&
      tickets === 5 &&
      expected.every((n) => matchedUrls.some((u) => u.endsWith('/' + n + '.jpg'))) &&
      !matchedUrls.some((u) => u.includes('other-person')),
    matches: hits.length,
    tickets,
    scanMs,
    matchedFiles: matchedUrls.map((u) => u.split('/').pop()),
    ms: Date.now() - started,
  });
} catch (error) {
  emit('trace', { ok: false, error: error.name, ms: Date.now() - started });
} finally {
  await browser?.close();
}
