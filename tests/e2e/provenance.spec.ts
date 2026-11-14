import { test, expect } from '@playwright/test';

// Downloaded at test time, not vendored. Public CAI c2pa-rs fixture repository, MIT/Apache-2.0.
const REV = '0e92435c6d621c02c9bde2a8d82346295ed1f509';
const FIXTURE = `https://raw.githubusercontent.com/contentauth/c2pa-rs/${REV}/sdk/tests/fixtures/CA.jpg`;
test.use({ baseURL: 'http://localhost:5181' });
test('offline C2PA distinguishes absent, intact and altered embedded credentials', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const response = await request.get(FIXTURE);
  expect(response.ok()).toBe(true);
  const signed = await response.body();
  // Change entropy-coded JPEG image bytes after Start of Scan, preserving APP11/JUMBF credentials.
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
  for (let i = scan + 64; i < altered.length - 2 && changed < 3; i++)
    if (altered[i] !== 0xff && altered[i + 1] !== 0xff) {
      altered[i] = altered[i]! ^ 1;
      changed++;
    }
  expect(changed).toBe(3);
  const blocked: string[] = [];
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://localhost:5181') {
      blocked.push(url.origin);
      await route.abort();
      return;
    }
    if (route.request().isNavigationRequest()) {
      const r = await route.fetch();
      await route.fulfill({
        response: r,
        headers: {
          ...r.headers(),
          'content-security-policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
            "connect-src 'self'",
            "worker-src 'self' blob:",
            "img-src 'self' data: blob:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
          ].join('; '),
        },
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  const results = await page.evaluate(
    async ({ signed, altered }) => {
      const modulePath = '/src/features/inspect/provenance/index.ts';
      const { readProvenance } = await import(/* @vite-ignore */ modulePath);
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#789';
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg'));
      const out = [];
      for (const [id, bytes] of [
        ['plain', new Uint8Array(await blob.arrayBuffer())],
        ['signed', new Uint8Array(signed)],
        ['altered', new Uint8Array(altered)],
      ] as const) {
        const t = performance.now();
        out.push({ id, result: await readProvenance(bytes, id), ms: Math.round(performance.now() - t) });
      }
      return out;
    },
    { signed: Array.from(signed), altered: Array.from(altered) },
  );
  console.log(
    'Provenance results:',
    JSON.stringify(
      results.map((r) => ({
        id: r.id,
        ms: r.ms,
        execution: r.result.execution,
        finding: r.result.finding,
        evidence: r.result.evidence,
      })),
    ),
  );
  expect(blocked).toEqual([]);
  expect(results[0]!.result).toMatchObject({
    execution: 'complete',
    finding: 'not_applicable',
    evidence: { manifestPresent: false },
  });
  expect(results[1]!.result).toMatchObject({
    execution: 'complete',
    finding: 'consistent',
    evidence: { manifestPresent: true, integrity: { status: 'valid' }, signer: { trust: 'unknown' } },
  });
  expect(results[2]!.result.evidence.integrity.validationCodes).toContain('assertion.dataHash.mismatch');
  expect(results[2]!.result).toMatchObject({
    execution: 'complete',
    finding: 'inconsistent',
    evidence: { manifestPresent: true, integrity: { status: 'invalid' } },
  });
});
