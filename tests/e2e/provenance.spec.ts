import { expect, test } from '@playwright/test';

// Public CAI c2pa-rs fixture; downloaded at test time and never vendored.
const REV = '0e92435c6d621c02c9bde2a8d82346295ed1f509';
const FIXTURE = `https://raw.githubusercontent.com/contentauth/c2pa-rs/${REV}/sdk/tests/fixtures/CA.jpg`;

test('offline provenance distinguishes unsigned, intact and altered credentials', async ({ page, request }) => {
  test.setTimeout(120_000);
  const response = await request.get(FIXTURE);
  expect(response.ok()).toBe(true);
  const signed = await response.body();
  const altered = Buffer.from(signed);
  let scan = -1;
  for (let offset = 2; offset < altered.length - 4; ) {
    expect(altered[offset]).toBe(0xff);
    const marker = altered[offset + 1]!;
    const length = altered.readUInt16BE(offset + 2);
    if (marker === 0xda) {
      scan = offset + 2 + length;
      break;
    }
    expect(length).toBeGreaterThanOrEqual(2);
    offset += 2 + length;
  }
  expect(scan).toBeGreaterThan(0);
  let changed = 0;
  for (let i = scan + 64; i < altered.length - 2 && changed < 3; i++) {
    if (altered[i] !== 0xff && altered[i + 1] !== 0xff) {
      altered[i] = altered[i]! ^ 1;
      changed++;
    }
  }
  expect(changed).toBe(3);

  const blocked: string[] = [];
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://localhost:5180') {
      blocked.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  const results = await page.evaluate(
    async ({ signed, altered }) => {
      const { readProvenance } = await import(/* @vite-ignore */ '/src/features/inspect/provenance/contentCredentials.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      const plain = new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg'))).arrayBuffer());
      return Promise.all([
        readProvenance(plain, 'image/jpeg'),
        readProvenance(new Uint8Array(signed), 'image/jpeg'),
        readProvenance(new Uint8Array(altered), 'image/jpeg'),
      ]);
    },
    { signed: Array.from(signed), altered: Array.from(altered) },
  );
  expect(blocked).toEqual([]);
  expect(results[0]!.credentials.present).toBe(false);
  expect(results[1]!.credentials.present).toBe(true);
  expect(results[2]!.credentials.statusCodes).toContain('assertion.dataHash.mismatch');
  expect(results[2]!.credentials.contentChanged).toBe(true);
});
