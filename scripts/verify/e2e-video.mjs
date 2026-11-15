// End-to-end check of Video evidence in a real browser: scan a clip, read the sealed record,
// then prove that a tampered record and a different video are both caught.
//   node scripts/verify/e2e-video.mjs <video.mp4> [more.mp4 ...]
// VEIL_URL (default http://localhost:5173), VEIL_OUT (default .scratch/e2e-video), VEIL_MOBILE=1 for a phone viewport.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const base = process.env.VEIL_URL ?? 'http://localhost:5173';
const out = resolve(process.env.VEIL_OUT ?? '.scratch/e2e-video');
const mobile = process.env.VEIL_MOBILE === '1';
const clips = process.argv.slice(2);
if (!clips.length) throw new Error('Give at least one video file.');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.VEIL_CHROME ? { channel: 'chrome', headless: false } : {});
const context = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, acceptDownloads: true, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const problems = [];
// ONNX Runtime prints its own warnings through console.error; they are not app errors.
page.on('console', (m) => { if (m.type() === 'error' && !/\[W:onnxruntime/.test(m.text())) problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const results = [];
let failed = 0;
const expect = (ok, what) => { if (!ok) { failed++; console.log(`  FAIL ${what}`); } else console.log(`  ok   ${what}`); };

for (const clip of clips) {
  const name = basename(clip).replace(/\W+/g, '-');
  console.log(`\n== ${basename(clip)}`);
  await page.goto(`${base}/#/video`);
  await page.reload();
  await page.getByRole('heading', { name: 'Is the video real?' }).waitFor();
  const t0 = Date.now();
  await page.locator('.dropzone input[type=file]').setInputFiles(clip);
  await page.locator('.tool-video video').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}-1-scanning.png`) });
  // The scan ends when the verdict stops listing pending work.
  await page.locator('.verdict-meta').waitFor({ timeout: 300_000 });
  const scanMs = Date.now() - t0;
  await page.getByRole('button', { name: 'Download record' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.passport .td-actions button[disabled]'), null, { timeout: 20_000 });
  await page.waitForTimeout(600);

  const verdict = ((await page.locator('.verdict h1').textContent()) ?? '').trim();
  const reasonsFor = await page.locator('.reasons-col[data-side=for] li').allInnerTexts();
  const reasonsAgainst = await page.locator('.reasons-col[data-side=against] li').allInnerTexts();
  const modelSignals = await page.locator('.panel > .signals h2').allInnerTexts();
  const marks = await page.locator('.vt-mark').count();
  const seal = (await page.locator('.passport-facts > div:last-child dd').innerText()).trim();
  await page.screenshot({ path: join(out, `${name}-2-done.png`), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download record' }).click()]);
  const recordPath = join(out, `${name}-record.json`);
  await download.saveAs(recordPath);
  const sealed = JSON.parse(readFileSync(recordPath, 'utf8'));
  const text = JSON.stringify(sealed);

  expect(verdict !== 'Checking', `verdict settles: "${verdict}"`);
  expect(sealed.record.schema === 'veil-video-passport/v1', 'record has the schema');
  expect(/^[a-f0-9]{64}$/.test(sealed.record.asset.sha256), 'record carries the SHA-256');
  expect(sealed.record.scan?.frames.length >= 10, `frames sampled: ${sealed.record.scan?.frames.length}`);
  expect(sealed.record.scan.frames.some((f) => f.ai !== null), 'AI-image model scored frames');
  expect(Boolean(sealed.witness?.signature), 'server stamp present');
  expect(!text.includes('data:image'), 'no thumbnails or pixels in the record');
  expect(sealed.record.events.length >= 4, `handling log entries: ${sealed.record.events.length}`);

  // Jump to the first marked moment, add a note, and confirm the seal is renewed with the note inside.
  if (marks) {
    await page.locator('.vt-mark').first().click();
    const at = await page.locator('.tool-video video').evaluate((v) => v.currentTime);
    expect(at > 0, `timeline mark seeks the video (to ${at.toFixed(2)} s)`);
  }
  await page.locator('#video-note').fill('Lighting on the face does not match the background.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.locator('.notes li').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.passport .td-actions button[disabled]'), null, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download record' }).click()]);
  const notedPath = join(out, `${name}-record-with-note.json`);
  await d2.saveAs(notedPath);
  const noted = JSON.parse(readFileSync(notedPath, 'utf8'));
  expect(noted.record.notes.length === 1 && noted.record.events.at(-1).type === 'note-added', 'note is in the record and in the log');
  expect(noted.signature !== sealed.signature, 'record was sealed again after the note');

  // A tampered copy: one word of one log entry changed.
  const tampered = structuredClone(noted);
  tampered.record.events[0].detail = tampered.record.events[0].detail.replace('was not uploaded', 'was uploaded');
  const tamperedPath = join(out, `${name}-record-TAMPERED.json`);
  writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));

  // Verify screen
  await page.getByRole('button', { name: 'Open another' }).click();
  await page.getByRole('button', { name: /Check it/ }).click();
  const verify = async (record, video) => {
    await page.locator('.verify-card input[accept*=json]').setInputFiles(record);
    await page.locator('.verify-lines li').first().waitFor();
    if (video) {
      await page.locator('.verify-card input[accept*=video]').setInputFiles(video);
      await page.waitForFunction(() => !/Video not added/.test(document.querySelector('.verify-lines')?.textContent ?? ''), null, { timeout: 30_000 });
    }
    await page.waitForTimeout(300);
    return (await page.locator('.verify-lines li h2').allTextContents()).map((s) => s.trim());
  };
  const good = await verify(notedPath, clip);
  await page.screenshot({ path: join(out, `${name}-3-verified.png`) });
  expect(good.join('|') === 'Same video|History complete|Record unchanged|Existed at this time', `own record verifies: ${good.join(' | ')}`);
  const bad = await verify(tamperedPath);
  await page.screenshot({ path: join(out, `${name}-4-tampered.png`) });
  expect(bad.includes('History altered') && bad.includes('Record altered'), `tampered record is caught: ${bad.join(' | ')}`);
  const other = clips.find((c) => c !== clip);
  if (other) {
    const wrong = await verify(notedPath, other);
    expect(wrong[0] === 'Different video', `a different video is caught: ${wrong[0]}`);
  }
  await page.getByRole('button', { name: 'Back' }).click();

  results.push({ clip: basename(clip), scanMs, verdict, reasonsFor, reasonsAgainst, modelSignals, marks, seal, checks: sealed.record.scan.checks, frames: sealed.record.scan.frames.map((f) => [Number(f.time.toFixed(1)), f.ai === null ? null : Number(f.ai.toFixed(3)), f.faceFake === null ? null : Number(f.faceFake.toFixed(2))]), signals: sealed.record.scan.signals.map((s) => `${s.check}@${s.start.toFixed(1)}-${s.end.toFixed(1)}`) });
}

expect(problems.length === 0, `no console or page errors${problems.length ? `: ${problems.slice(0, 4).join(' || ')}` : ''}`);
writeFileSync(join(out, 'results.json'), JSON.stringify({ base, mobile, userAgent: await page.evaluate(() => navigator.userAgent), results, problems }, null, 2));
console.log(`\n${JSON.stringify(results, null, 1)}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
