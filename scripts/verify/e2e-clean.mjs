import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { out, prepare, emit, openPhoto } from './common.mjs';
let browser;
const started = Date.now();
try {
  await prepare();
  const file = process.argv[2],
    destination = process.argv[3] ?? join(out, 'cleaned.jpg');
  if (!file) throw Error('photo-required');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }),
    page = await ctx.newPage();
  await openPhoto(page, 'shield', file);
  await page
    .locator('.choices .choice')
    .filter({ hasText: 'Hide my Veil mark' })
    .locator('input')
    .setChecked(false);
  const t = Date.now();
  await page.getByRole('button', { name: 'Shield it', exact: true }).click();
  await page.waitForFunction(
    () => ['Remove these?', 'Shielded'].includes(document.querySelector('.verdict h1')?.textContent ?? ''),
    null,
    { timeout: 240000 },
  );
  const scanMs = Date.now() - t;
  // Count checkboxes only. Never read candidate text, console output, OCR values or storage.
  const candidates = await page.locator('.candidates .choice input').count(),
    selected = await page.locator('.candidates .choice input:checked').count();
  if (candidates) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Shielded', exact: true }).waitFor({ timeout: 300000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save the shielded copy' }).click(),
  ]);
  await dl.saveAs(destination);
  await page.screenshot({ path: join(out, 'e2e-clean.png') });
  emit('clean', { ok: true, candidates, selected, scanMs, ms: Date.now() - started });
} catch (error) {
  emit('clean', { ok: false, error: error.name, ms: Date.now() - started });
} finally {
  await browser?.close();
}
