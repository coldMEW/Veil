// Control: the same real photo as suspect and as original must never read as changed or faked.
import { chromium } from '@playwright/test';
const base = process.env.VEIL_URL ?? 'http://localhost:5191/';
const files = process.argv.slice(2);
const browser = await chromium.launch();
let ok = true;
for (const f of files) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '#/check', { waitUntil: 'networkidle' });
  await page.locator('.dropzone input[type=file]').setInputFiles(f);
  await page.waitForSelector('.verdict h1');
  await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 240000 });
  const before = await page.locator('.verdict h1').innerText();
  await page.locator('.panel-block input[type=file]').setInputFiles(f);
  await page.waitForFunction(() => /nothing differs|differ|could not/i.test(document.querySelector('.panel')?.textContent ?? ''), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const after = await page.locator('.verdict h1').innerText();
  const evidence = await page.locator('.evidence h2').allInnerTexts();
  const note = (await page.locator('.panel-block .note').allInnerTexts()).join(' | ');
  const pass = before === after && !evidence.some((e) => /changed from your original/i.test(e)) && /nothing differs/i.test(note);
  ok &&= pass;
  console.log(JSON.stringify({ file: f.split('/').pop(), before, after, evidence, note, pass }));
  await page.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
