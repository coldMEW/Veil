import { chromium } from '@playwright/test';
const base = process.env.VEIL_URL ?? 'http://localhost:5191/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '#/shield', { waitUntil: 'networkidle' });
await page.locator('input[type=file]').first().setInputFiles('public/demo/source/selfie-1.jpg');
await page.getByText('Remove where I live').click();
await page.getByRole('button', { name: 'Shield it' }).click();
await page.waitForSelector('text=Shielded', { timeout: 120000 });
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save the shielded copy' }).click()]);
const out = (process.env.VEIL_OUT ?? '../scratch-eval') + '/shielded.jpg';
await dl.saveAs(out);
await page.screenshot({ path: (process.env.VEIL_OUT ?? '../scratch-eval') + '/e2e-shield.png' });
// Re-encode like a social network would: smaller and recompressed.
const sharp = (await import('sharp')).default;
await sharp(out).resize({ width: 700 }).jpeg({ quality: 72 }).toFile((process.env.VEIL_OUT ?? '../scratch-eval') + '/shielded-reposted.jpg');
for (const f of [(process.env.VEIL_OUT ?? '../scratch-eval') + '/shielded-reposted.jpg', 'public/demo/source/fake-party.jpg']) {
  await page.goto(base + '#/check', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('.stage-bar button')?.click());
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').first().setInputFiles(f);
  await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 180000 }).catch(() => {});
  console.log(f, '=>', (await page.locator('.verdict h1').innerText()), '|', (await page.locator('.evidence h2').allInnerTexts()).join(' / '));
  await page.screenshot({ path: `../scratch-eval/shots/e2e-check-${f.split('/').pop()}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
