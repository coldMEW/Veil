// Drives the installed Android app through its WebView debug port (debug builds only).
// adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>, then: node scripts/verify/device-e2e.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB = process.env.ADB ?? 'C:/Users/DSU/Android/Sdk/platform-tools/adb.exe';
const out = process.env.VEIL_OUT ?? '../scratch-eval/shots';
const browser = await chromium.connectOverCDP('http://localhost:9333');
const page = browser.contexts()[0].pages()[0];
page.on('pageerror', (e) => console.log('pageerror', String(e)));
const give = async (selector, path, name) => {
  await page.waitForSelector(selector, { state: 'attached', timeout: 30000 });
  const b64 = readFileSync(path).toString('base64');
  await page.evaluate(([sel, data, n]) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], n, { type: 'image/jpeg' }));
    const input = document.querySelector(sel);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, b64, name]);
};
// WebView screenshots over CDP can stall on fonts; the phone's own screencap is what a person sees anyway.
const shot = async (n) => writeFileSync(`${out}/device-${n}.png`, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('veil.onboarded.v1', 'true'); localStorage.setItem('veil.hunt.consent.v1', 'true'); location.hash = '#/trace'; location.reload(); });
await page.waitForSelector('#vault-title', { timeout: 30000 });
let t = Date.now();
await give('.vault input[type=file]', 'public/demo/source/selfie-1.jpg', 'selfie-1.jpg');
await page.waitForSelector('.vault-list li', { timeout: 120000 });
console.log('enrol ms', Date.now() - t);
t = Date.now();
await page.getByRole('tab', { name: 'Check a page I know' }).click();
await page.getByRole('button', { name: 'demo leaks page' }).click();
await page.waitForFunction(() => /pictures show you|matches your face|Could not scan/.test(document.querySelector('.results-head')?.textContent ?? ''), null, { timeout: 300000 });
console.log('scan ms', Date.now() - t, '|', (await page.locator('.results-head').innerText()).replace(/\s+/g, ' '));
console.log('hits', (await page.locator('.hit-label').allInnerTexts()).join(', '));
await shot('trace');
await page.evaluate(() => { location.hash = '#/tickets'; });
await page.waitForSelector('.ticket-list li a', { timeout: 30000 });
console.log('tickets', await page.locator('.ticket-list li').count());
await page.locator('.ticket-list li a').first().click();
await page.waitForSelector('text=Who to tell');
await page.waitForTimeout(1500);
await shot('ticket');
// Shield, then check the shielded copy for the mark.
await page.evaluate(() => { location.hash = '#/shield'; });
await page.waitForSelector('.dropzone', { timeout: 30000 });
await give('input[type=file]', 'public/demo/source/selfie-2.jpg', 'selfie-2.jpg');
await page.getByText('Remove where I live').click();
t = Date.now();
await page.getByRole('button', { name: 'Shield it' }).click();
await page.getByRole('heading', { name: 'Shielded', exact: true }).waitFor({ timeout: 300000 });
console.log('shield ms', Date.now() - t);
await shot('shield');
const shielded = await page.evaluate(async () => {
  const c = document.querySelectorAll('.ba canvas')[1];
  return c.toDataURL('image/jpeg', 0.75).split(',')[1];
});
await page.evaluate(() => { location.hash = '#/check'; });
await page.waitForTimeout(500);
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 });
t = Date.now();
await page.evaluate((data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'reposted.jpg', { type: 'image/jpeg' }));
  const input = document.querySelector('input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, shielded);
await page.waitForSelector('.evidence h2', { timeout: 300000 });
await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 300000 }).catch(() => {});
console.log('check ms', Date.now() - t, '|', await page.locator('.verdict h1').innerText(), '|', (await page.locator('.evidence h2').allInnerTexts()).join(' / '));
await shot('check');
// Real web search on the phone itself (native HTTP, no server): a public-domain portrait that is on the web.
if (process.env.VEIL_HUNT_PHOTO) {
  await page.evaluate(() => { location.hash = '#/trace'; });
  await page.waitForSelector('#vault-title', { timeout: 30000 });
  await give('.vault input[type=file]', process.env.VEIL_HUNT_PHOTO, 'portrait.jpg');
  await page.waitForFunction(() => document.querySelectorAll('.vault-list li').length >= 2, null, { timeout: 120000 });
  await page.getByRole('tab', { name: 'Search the web' }).click();
  t = Date.now();
  await give('.scan-body input[type=file]', process.env.VEIL_HUNT_PHOTO, 'portrait.jpg');
  await page.waitForFunction(() => /confirmed as your face|was not found|search failed|stopped/i.test(document.querySelector('.results-head')?.textContent ?? ''), null, { timeout: 600000 });
  console.log('hunt ms', Date.now() - t, '|', (await page.locator('.engine-list li').allInnerTexts()).map((e) => e.replace(/\s+/g, ' ')).join(' ; '), '|', (await page.locator('.results-head').innerText()).replace(/\s+/g, ' '));
  await shot('hunt');
}
await browser.close();
