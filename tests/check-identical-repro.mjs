import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
if (!process.argv.slice(2).length) throw Error('Provide at least one local camera photo.');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [id, file] of process.argv.slice(2).map((file, i) => ['camera-control-' + (i + 1), file])) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:5192/#/check', { waitUntil: 'networkidle' });
    await page.locator('.dropzone input[type=file]').setInputFiles(file);
    await page.waitForSelector('.stage-bar');
    await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 180000 });
    const before = {
      headline: await page.locator('.verdict h1').innerText(),
      evidence: await page.locator('.evidence h2').allInnerTexts(),
    };
    await page.locator('input[type=file]').last().setInputFiles(file);
    await page.waitForFunction(
      () =>
        document.querySelector('.evidence')?.textContent?.includes('Changed from your original') ||
        document.querySelector('.panel-block .note')?.textContent?.includes('differ strongly'),
      null,
      { timeout: 30000 },
    );
    const after = {
      headline: await page.locator('.verdict h1').innerText(),
      evidence: await page.locator('.evidence h2').allInnerTexts(),
      comparisonSays: await page
        .locator('.panel-block .note')
        .filter({ hasText: 'differ strongly' })
        .innerText()
        .catch(() => null),
    };
    results.push({ id, before, after });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await writeFile(resolve('../scratch-eval/check_identical_repro.json'), JSON.stringify(results, null, 2));
  if (results.some((r) => r.after.evidence.some((h) => h.toLowerCase() === 'changed from your original')))
    process.exitCode = 1;
} finally {
  await browser.close();
}
