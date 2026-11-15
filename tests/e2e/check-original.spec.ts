import { test, expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
function scene(changed = false) {
  const canvas = createCanvas(512, 384),
    ctx = canvas.getContext('2d'),
    image = ctx.createImageData(512, 384);
  for (let y = 0; y < 384; y++)
    for (let x = 0; x < 512; x++) {
      const i = 4 * (y * 512 + x);
      image.data[i] = 120 + 40 * Math.sin(x / 13) * Math.cos(y / 17);
      image.data[i + 1] = 110 + 40 * Math.sin((x + y) / 19);
      image.data[i + 2] = 100 + 30 * Math.cos((x - 2 * y) / 23);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  if (changed) {
    ctx.fillStyle = '#ff0010';
    ctx.fillRect(300, 200, 90, 90);
  }
  return canvas.toBuffer('image/png');
}
for (const changed of [false, true])
  test(
    changed
      ? 'actual changed object produces a difference region'
      : 'identical original never becomes changed evidence',
    async ({ page }) => {
      await page.goto('/#/check');
      await page
        .locator('.dropzone input[type=file]')
        .setInputFiles({ name: 'suspect.png', mimeType: 'image/png', buffer: scene(changed) });
      await expect(page.getByRole('button', { name: 'Add my original', exact: true })).toBeVisible();
      await page
        .locator('input[type=file]')
        .last()
        .setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: scene() });
      if (changed)
        await expect(
          page.getByRole('heading', { name: 'Changed from your original', exact: true }),
        ).toBeVisible({ timeout: 30000 });
      else {
        await expect(
          page.getByText('0 areas differ strongly from the original.', { exact: false }),
        ).toBeVisible({ timeout: 30000 });
        await expect(
          page.getByRole('heading', { name: 'Changed from your original', exact: true }),
        ).toHaveCount(0);
      }
    },
  );
