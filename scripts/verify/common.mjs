import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export const base = (process.env.VEIL_URL ?? 'http://localhost:5191/').replace(/\/?$/, '/');
export const out = resolve(process.env.VEIL_OUT ?? '../scratch-eval');
export async function prepare() {
  await mkdir(out, { recursive: true });
}
export function emit(step, value) {
  console.log('VEIL_VERIFY_JSON ' + JSON.stringify({ step, ...value }));
  if (!value.ok) process.exitCode = 1;
}
/** Open through the actual app file picker; do not seed engine outcomes or persisted results. */
export async function openPhoto(page, route, file) {
  // Full document navigation resets the current in-memory image while preserving the same-origin mark key.
  const url = new URL(base);
  url.searchParams.set('verify', crypto.randomUUID());
  url.hash = '/' + route;
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.locator('.dropzone input[type=file]').setInputFiles(file);
}
