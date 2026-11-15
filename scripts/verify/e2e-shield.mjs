import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { join } from 'node:path';
import { base, out, prepare, emit, openPhoto } from './common.mjs';
let browser;
const started = Date.now();
try {
  await prepare();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }),
    page = await ctx.newPage();
  async function shield(file, destination) {
    await openPhoto(page, 'shield', file);
    await page
      .locator('.choices .choice')
      .filter({ hasText: 'Remove where I live' })
      .locator('input')
      .setChecked(false);
    await page.getByRole('button', { name: 'Shield it', exact: true }).click();
    await page.getByRole('heading', { name: 'Shielded', exact: true }).waitFor({ timeout: 180000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save the shielded copy' }).click(),
    ]);
    await dl.saveAs(destination);
  }
  await shield('public/demo/source/selfie-1.jpg', join(out, 'shielded.jpg'));
  await page.screenshot({ path: join(out, 'e2e-shield.png') });
  await sharp(join(out, 'shielded.jpg'))
    .resize({ width: 700 })
    .jpeg({ quality: 72 })
    .toFile(join(out, 'shielded-reposted.jpg'));
  await openPhoto(page, 'check', join(out, 'shielded-reposted.jpg'));
  await page
    .getByRole('heading', { name: 'Made from your photo', exact: true })
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  const madeFromYourPhoto = await page
    .getByRole('heading', { name: 'Made from your photo', exact: true })
    .first()
    .isVisible();
  await page.screenshot({ path: join(out, 'e2e-check-reposted.png') });
  let tested12mp = false;
  if (process.env.VEIL_MARK_12MP) {
    await shield(process.env.VEIL_MARK_12MP, join(out, 'shielded-12mp.jpg'));
    tested12mp = true;
  }
  emit('mark', {
    ok: madeFromYourPhoto,
    madeFromYourPhoto,
    repostWidth: 700,
    jpegQuality: 72,
    tested12mp,
    ms: Date.now() - started,
  });
} catch (error) {
  emit("mark", { ok: false, error: error.name, message: String(error.message).slice(0, 300), ms: Date.now() - started });
} finally {
  await browser?.close();
}
