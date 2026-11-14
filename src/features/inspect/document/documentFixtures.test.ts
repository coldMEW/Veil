import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentPanel } from '../../../app/inspect/DocumentPanel';
import { analysePdf, toDocumentCheckResult, type PdfAnalysis } from './pdfForensics';

const script = fileURLToPath(new URL('../../../../scripts/export/docs/make_test_pdfs.mjs', import.meta.url));
const names = ['ai_metadata.pdf', 'edited.pdf', 'original.pdf', 'signed_then_changed.pdf'];
let folder = '';
const fixtures = new Map<string, { bytes: Uint8Array; analysis: PdfAnalysis }>();

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'veil-document-fixtures-'));
  execFileSync(execPath, [script, folder], { timeout: 10_000, stdio: 'pipe' });
  for (const name of names) {
    const bytes = new Uint8Array(await readFile(join(folder, name)));
    fixtures.set(name, { bytes, analysis: await analysePdf(bytes) });
  }
});

afterAll(async () => {
  if (!folder) return;
  // Inspect the target and keep recursive cleanup confined to this test's own directory.
  if (dirname(resolve(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith('veil-document-fixtures-')) {
    throw new Error('Refusing to remove a directory outside the test temporary folder.');
  }
  const entries = await readdir(folder, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || !names.includes(entry.name))) throw new Error('Unexpected file in fixture directory; leaving it intact.');
  await rm(folder, { recursive: true, force: true });
});

function fixture(name: string) {
  const value = fixtures.get(name);
  if (!value) throw new Error(`Missing fixture ${name}`);
  return value;
}

function render(name: string, options: { fileName?: string; pageCount?: number } = {}) {
  const { bytes, analysis } = fixture(name);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return renderToStaticMarkup(createElement(DocumentPanel, {
    fileName: options.fileName ?? name, sha256, byteLength: bytes.length,
    assetId: sha256, analysis: { ...analysis, pageCount: options.pageCount },
  }));
}

describe('dependency-free synthetic PDF generator', () => {
  it('writes exactly four parseable one-page PDFs with real cross-reference offsets', async () => {
    expect((await readdir(folder)).sort()).toEqual(names);
    for (const name of names) {
      const { bytes, analysis } = fixture(name);
      expect(analysis.isPdf).toBe(true);
      expect(analysis.version).toBe('1.7');
      expect(analysis.warnings).toEqual([]);
      const text = new TextDecoder('latin1').decode(bytes);
      expect(text).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
      expect(text).toContain('(INVOICE #1042) Tj');
      expect(text).toContain('Synthetic invoice for Veil document tests.');
      for (const match of text.matchAll(/startxref\s+(\d+)/g)) expect(text.slice(Number(match[1]), Number(match[1]) + 4)).toBe('xref');
      for (const match of text.matchAll(/^(\d{10}) 00000 n $/gm)) expect(text.slice(Number(match[1]))).toMatch(/^\d+ 0 obj\n/);
    }
  });

  it('keeps the original single-save invoice and matching Info/XMP dates inconclusive', () => {
    const { bytes, analysis } = fixture('original.pdf');
    expect(new TextDecoder().decode(bytes)).toContain('(Total $1,250.00) Tj');
    expect(analysis).toMatchObject({ revisions: 1, datesMismatch: false, info: { Producer: 'Microsoft Word for Microsoft 365' } });
    expect(analysis.xmp.Producer).toBe(analysis.info.Producer);
    expect(toDocumentCheckResult('original', analysis).finding).toBe('inconclusive');
  });

  it('preserves the exact original prefix and appends a proper revised page/content/xref/trailer', () => {
    const original = fixture('original.pdf');
    const edited = fixture('edited.pdf');
    expect(edited.bytes.subarray(0, original.bytes.length)).toEqual(original.bytes);
    const text = new TextDecoder().decode(edited.bytes);
    expect(text.slice(original.bytes.length)).toContain('/Contents 8 0 R');
    expect(text.slice(original.bytes.length)).toContain('(Total $9,250.00) Tj');
    expect(edited.analysis).toMatchObject({ revisions: 2, datesMismatch: false, info: { Producer: 'Adobe Acrobat Pro 24.1', ModDate: 'D:20261114113000Z' } });
    expect(edited.analysis.prevOffsets).toEqual(original.analysis.xrefOffsets);
    expect(edited.analysis.xmp.ModDate).toBe('2026-11-14T11:30:00Z');
    expect(toDocumentCheckResult('edited', edited.analysis).finding).toBe('inconclusive');
  });

  it('has a placeholder signature with exact coverage excluding Contents and appended bytes', () => {
    const { bytes, analysis } = fixture('signed_then_changed.pdf');
    expect(analysis.signatures).toMatchObject({ fields: 1, byteRangeCount: 1, changedAfterSigning: true, verified: false });
    const range = analysis.signatures.ranges[0]!;
    expect(range.valid).toBe(true);
    const text = new TextDecoder('latin1').decode(bytes);
    const [start, firstLength, secondStart, secondLength] = range.values as [number, number, number, number];
    expect(start).toBe(0);
    expect(text[firstLength]).toBe('<');
    expect(text[secondStart - 1]).toBe('>');
    expect(firstLength + (secondStart - firstLength) + secondLength).toBe(analysis.signatures.lastSignedEnd);
    const appended = '% Synthetic bytes appended after the declared signed range.\n';
    expect(text.slice(range.end!)).toBe(appended);
    expect(analysis.signatures.bytesAfterSignature).toBe(appended.length);
    expect(text).toContain('no cryptographic signature');
    expect(toDocumentCheckResult('coverage', analysis).finding).toBe('inconsistent');
  });

  it('keeps AI tool/source metadata as declarations rather than a content verdict', () => {
    const { analysis } = fixture('ai_metadata.pdf');
    expect(analysis.info).toMatchObject({ Producer: 'ChatGPT', Creator: 'OpenAI' });
    expect(analysis.xmp).toMatchObject({ Producer: 'ChatGPT', Creator: 'OpenAI' });
    expect(analysis.c2pa).toMatchObject({ trainedAlgorithmicMedia: true, aiToolNames: ['ChatGPT', 'OpenAI'], present: false });
    expect(toDocumentCheckResult('metadata', analysis).finding).toBe('inconclusive');
  });

  it('refuses to overwrite an existing fixture directory', async () => {
    const original = await readFile(join(folder, 'original.pdf'));
    expect(() => execFileSync(execPath, [script, folder], { stdio: 'pipe' })).toThrow();
    expect(await readFile(join(folder, 'original.pdf'))).toEqual(original);
  });
});

describe('DocumentPanel', () => {
  it('shows file facts and evidence with no summary banner for an ordinary single save', () => {
    const html = render('original.pdf', { pageCount: 1 });
    expect(html).toContain('original.pdf');
    expect(html).toContain('PDF 1.7, 1 page');
    expect(html).toContain('SHA-256 of the opened file');
    expect(html).toContain('Document evidence');
    expect(html).toContain('Microsoft Word for Microsoft 365');
    expect(html).toContain('aria-label="Information"');
    expect(html).not.toContain('role="status"');
  });

  it('does not invent a page count when it is unknown', () => {
    expect(render('original.pdf')).not.toContain('1 page');
  });

  it.each([
    ['edited.pdf', 'Edited after it was first saved (2 saves)', 'bg-gold-soft'],
    ['signed_then_changed.pdf', 'Changed after it was signed', 'bg-misfit/10'],
    ['ai_metadata.pdf', 'Metadata names an AI tool: ChatGPT, OpenAI', 'bg-[#e5383b]/10'],
  ])('shows a factual summary banner for %s', (name, text, tone) => {
    const html = render(name!);
    expect(html).toContain(text);
    expect(html).toContain(tone);
    expect(html).toContain('role="status"');
  });

  it('escapes user-controlled filenames and preserves the signature-validity limitation', () => {
    const html = render('signed_then_changed.pdf', { fileName: '<img src=x onerror=alert(1)>.pdf' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.pdf');
    expect(html).toContain('Signature validity was not checked.');
    expect(html).toContain('aria-label="Warning"');
  });
});
