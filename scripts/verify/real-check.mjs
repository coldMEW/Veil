// Check verdicts on a folder of REAL camera photos: any "fake" or "model flags it" here is a false alarm.
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
const base = process.env.VEIL_URL ?? 'http://localhost:5194/';
const dir = process.argv[2];
const browser = await chromium.launch();
const rows = [];
for (const f of readdirSync(dir).filter((x) => /\.jpe?g$/i.test(x))) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + '#/check', { waitUntil: 'networkidle' });
  await page.locator('.dropzone input[type=file]').setInputFiles(`${dir}/${f}`);
  await page.waitForSelector('.verdict h1', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 240000 });
  rows.push({ file: f, verdict: await page.locator('.verdict h1').innerText(), evidence: await page.locator('.evidence h2').allInnerTexts() });
  await page.close();
}
await browser.close();
for (const r of rows) console.log(r.file.padEnd(44), r.verdict.padEnd(22), r.evidence.join(' / '));
const alarms = rows.filter((r) => !/NOTHING DECISIVE|CREDENTIALS INTACT/.test(r.verdict));
console.log(`${rows.length} real photos, ${alarms.length} false alarms`);
