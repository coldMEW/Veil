// Real-photo check of Remove details on a street-sign photo: tick the unconfirmed sign too, clean,
// save the result and the mask so the plate can be looked at.
//   node scripts/verify/e2e-clean-sign.mjs <photo.jpg>     VEIL_URL, VEIL_OUT as in the other drivers
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = process.env.VEIL_URL ?? 'http://localhost:5173';
const out = resolve(process.env.VEIL_OUT ?? '.scratch/e2e-clean-sign');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/#/clean`);
await page.locator('.dropzone input[type=file]').setInputFiles(process.argv[2]);
await page.getByRole('button', { name: 'Shield it', exact: true }).click();
const t0 = Date.now();
await page.getByRole('heading', { name: 'Remove these?' }).waitFor({ timeout: 240_000 });
await page.locator('.candidates').first().waitFor({ timeout: 240_000 });
console.log('scan s', ((Date.now() - t0) / 1000).toFixed(1));
const maybe = page.locator('details.maybe');
if (await maybe.count()) {
  await maybe.locator('summary').click();
  const boxes = maybe.locator('input[type=checkbox]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const label = (await boxes.nth(i).locator('xpath=ancestor::label').textContent()) ?? '';
    console.log('maybe:', label.trim().slice(0, 80));
    if (/lee|ave|street|address/i.test(label) || (await boxes.count()) === 1) await boxes.nth(i).check();
  }
}
console.log('confirmed:', await page.locator('ul.candidates').first().locator('label').allTextContents());
await page.screenshot({ path: join(out, '1-review.png'), fullPage: true });
const t1 = Date.now();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.locator('.ba').waitFor({ timeout: 300_000 });
await page.waitForTimeout(1500);
console.log('clean s', ((Date.now() - t1) / 1000).toFixed(1));
await page.screenshot({ path: join(out, '2-done.png'), fullPage: true });
const dbg = await page.evaluate(() => {
  const d = globalThis.__veilClean;
  if (!d) return null;
  const { mask, candidates } = d;
  const c = document.createElement('canvas');
  c.width = mask.width; c.height = mask.height;
  const img = new ImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) { const v = mask.data[i] ? 255 : 0; img.data.set([v, v, v, 255], i * 4); }
  c.getContext('2d').putImageData(img, 0, 0);
  return { png: c.toDataURL('image/png').split(',')[1], candidates: candidates.map((x) => ({ text: x.text, selected: x.selected, verified: x.verified, region: x.region, quad: x.quad, category: x.category })) };
});
if (dbg) { writeFileSync(join(out, 'mask.png'), Buffer.from(dbg.png, 'base64')); writeFileSync(join(out, 'candidates.json'), JSON.stringify(dbg.candidates, null, 1)); }
const result = await page.evaluate(() => { const cs = document.querySelectorAll('.ba canvas'); const c = cs[cs.length - 1]; return c ? c.toDataURL('image/png').split(',')[1] : null; });
if (result) writeFileSync(join(out, 'result.png'), Buffer.from(result, 'base64'));
console.log('page says:', (await page.locator('.panel').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500));
await browser.close();
