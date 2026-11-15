// Real web search through the UI: enrol a face, search the web, confirm candidates on the device.
// Usage: node scripts/verify/e2e-hunt.mjs <photo of a face that is public on the web>. Tickets stay local.
import { chromium } from '@playwright/test';
const base = process.env.VEIL_URL ?? 'http://localhost:5194/';
const photo = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '#/trace', { waitUntil: 'networkidle' });
await page.locator('.vault input[type=file]').setInputFiles(photo);
await page.waitForSelector('.vault-list li', { timeout: 120000 });
await page.evaluate(() => localStorage.setItem('veil.hunt.consent.v1', 'true'));
await page.reload({ waitUntil: 'networkidle' });
const t0 = Date.now();
await page.locator('.scan-body input[type=file]').setInputFiles(photo);
await page.waitForFunction(() => /confirmed as your face|was not found|search failed|stopped/i.test(document.querySelector('.results-head')?.textContent ?? ''), null, { timeout: 600000 });
const engines = await page.locator('.engine-list li').allInnerTexts();
const head = (await page.locator('.results-head').innerText()).replace(/\s+/g, ' ');
const hits = await page.locator('.hits li').evaluateAll((els) => els.map((e) => ({ label: e.querySelector('.hit-label')?.textContent, site: e.querySelector('.hit-url')?.textContent })));
await page.screenshot({ path: `${process.env.VEIL_OUT ?? '../scratch-eval/final'}/hunt-ui.png`, fullPage: true });
console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), engines: engines.map((e) => e.replace(/\s+/g, ' ')), head, confirmed: hits.length, sample: hits.slice(0, 8), errors }, null, 1));
await browser.close();
