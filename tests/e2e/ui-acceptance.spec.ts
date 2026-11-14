/**
 * UI acceptance contract for UI/UX-01 (written by Claude, the head). Do NOT weaken or delete these tests.
 * Implement the UI until every test passes. Satisfying a test with a fake, hidden, empty or zero-size element is a FAILURE of the task. Add the data-testid attributes named here to the real components.
 */
import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// Synthetic 800x600 PNG with planted text-like dark bars (no private photos).
function syntheticPng(): Buffer {
  const w = 800, h = 600;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const bar = y > 280 && y < 300 && x > 300 && x < 500 && x % 12 < 7;
      raw[i] = bar ? 20 : 120 + (x % 40);
      raw[i + 1] = bar ? 20 : 140 + (y % 30);
      raw[i + 2] = bar ? 20 : 160;
    }
  }
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function openPhoto(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: syntheticPng() });
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20000 });
}

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('empty state is the canvas drop zone, not a card grid', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toContainText(/drop a photo/i);
    await expect(page.locator('[data-testid="home-card"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/AI-made|real or fake|detects AI/i);
    await page.screenshot({ path: 'ui-shots/acceptance/empty-1440.png' });
  });

  test('workspace: tools rail, canvas, evidence rail', async ({ page }) => {
    await openPhoto(page);
    const tools = page.getByTestId('tools-rail');
    await expect(tools).toBeVisible();
    for (const g of ['Inspect', 'Clean', 'Protect']) await expect(tools).toContainText(g);
    await expect(page.getByTestId('canvas-well')).toBeVisible();
    await expect(page.getByTestId('evidence-rail')).toBeVisible();
    await page.screenshot({ path: 'ui-shots/acceptance/workspace-1440.png' });
  });

  test('evidence rows expand in place and select their overlay', async ({ page }) => {
    await openPhoto(page);
    const row = page.getByTestId('evidence-row').first();
    await expect(row).toBeVisible({ timeout: 60000 });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('evidence-details').first()).toBeVisible();
    const id = await row.getAttribute('data-check-id');
    expect(id).toBeTruthy();
    // The overlay must be a REAL visible element drawn on the canvas well (not sr-only / zero-size).
    const ov = page.getByTestId('canvas-well').locator(`[data-testid="overlay"][data-check-id="${id}"]`);
    await expect(ov).toBeVisible();
    await expect(ov).toHaveAttribute('data-selected', 'true');
    const ob = await ov.boundingBox();
    expect(ob && ob.width > 8 && ob.height > 8).toBeTruthy();
    expect(await ov.evaluate((e) => getComputedStyle(e).clip === 'rect(0px, 0px, 0px, 0px)' || e.classList.contains('sr-only'))).toBeFalsy();
    // Details show the check's real method and limitations, not a placeholder.
    const det = page.getByTestId('evidence-details').first();
    await expect(det).toContainText(/method/i);
    await expect(det).toContainText(/limitation/i);
    await expect(det).not.toContainText(/available in the evidence details below/i);
    // Reverse sync: clicking an overlay selects/expands its row.
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await ov.click({ force: true });
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  test('tools rail switches tools', async ({ page }) => {
    await openPhoto(page);
    await page.getByTestId('tools-rail').getByRole('button', { name: /clean|find private text/i }).first().click();
    await expect(page.getByTestId('clean-panel')).toBeVisible();
  });

  test('report opens as a printable sheet', async ({ page }) => {
    await openPhoto(page);
    await page.getByTestId('open-report').click();
    const rep = page.getByTestId('report-sheet');
    await expect(rep).toBeVisible();
    await expect(rep).toContainText(/SHA-256/i);
    const rb = await rep.boundingBox();
    expect(rb && rb.height > 400).toBeTruthy();
    await page.screenshot({ path: 'ui-shots/acceptance/report-1440.png' });
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no horizontal scroll; evidence becomes a bottom sheet', async ({ page }) => {
    await openPhoto(page);
    const sheet = page.getByTestId('evidence-sheet');
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box && box.width <= 390 && box.height >= 120).toBeTruthy(); // a real peeking sheet, not a 1px strip
    await expect(sheet.getByTestId('evidence-row').first()).toBeVisible({ timeout: 60000 });
    expect(box && box.y > 300).toBeTruthy(); // peeks from the bottom
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'ui-shots/acceptance/workspace-390.png' });
  });
});

test('reduced motion keeps content visible', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await ctx.close();
});
