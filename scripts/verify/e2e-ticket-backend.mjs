// Real ticket lifecycle through the UI and the Python backend, against public addresses on example.com.
import { chromium } from '@playwright/test';
const base = process.env.VEIL_URL ?? 'http://localhost:5194/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const out = { cases: [] };
for (const [name, found, expectRemoved] of [['still-up', 'https://example.com/', false], ['gone', `https://example.com/veil-test-missing-${Date.now()}.jpg`, true]]) {
  await page.goto(base + '#/check', { waitUntil: 'networkidle' });
  await page.locator('.dropzone input[type=file]').setInputFiles('public/demo/source/fake-party.jpg');
  await page.locator('#found-at').fill(found);
  await page.getByRole('button', { name: 'Open a takedown ticket' }).click();
  await page.waitForSelector('.ticket-detail #ticket-title');
  const id = (await page.locator('.ticket-detail .num.small').first().innerText()).split('·')[0].trim();
  await page.getByRole('button', { name: 'I sent it' }).click();
  await page.waitForTimeout(1500);
  const btn = page.getByRole('button', { name: 'Check if it is gone' });
  if (await btn.count()) await btn.click({ force: true });
  await page.waitForFunction(() => /gone|Still up|Could not tell/i.test(document.querySelector('.log')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const status = await page.locator('.td-clock strong').innerText();
  const log = await page.locator('.log li').allInnerTexts();
  const server = await (await fetch(`${base}api/tickets?ids=${id}`)).json();
  const removed = server[0]?.status === 'removed';
  out.cases.push({ name, id, uiStatus: status, serverStatus: server[0]?.status, serverEvents: server[0]?.events.map((e) => e.type), lastLog: log.at(-1), pass: removed === expectRemoved && /removed/i.test(status) === expectRemoved });
  await page.screenshot({ path: `${process.env.VEIL_OUT ?? '../scratch-eval/final'}/ticket-${name}.png`, fullPage: true });
}
out.errors = errors;
out.ok = out.cases.every((c) => c.pass) && !errors.length;
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.ok ? 0 : 1);
