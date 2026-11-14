import type { PdfAnalysis } from './pdfForensics';

export interface DocumentEvidenceRow {
  label: string;
  value: string;
  severity: 'info' | 'notice' | 'warning';
}

export function documentEvidence(analysis: PdfAnalysis): DocumentEvidenceRow[] {
  if (!analysis.isPdf) return [{ label: 'File format', value: 'No PDF header found; structure was not analysed.', severity: 'notice' }];
  const rows: DocumentEvidenceRow[] = [
    { label: 'PDF', value: `Version ${analysis.version}; ${analysis.sizeBytes.toLocaleString('en-US')} bytes`, severity: 'info' },
    { label: 'Save history', value: `${analysis.revisions} revision marker(s), ${analysis.xrefOffsets.length} cross-reference section(s)`, severity: analysis.revisions > 1 ? 'notice' : 'info' },
  ];
  for (const [label, value] of Object.entries(analysis.info)) if (value) rows.push({ label, value, severity: 'info' });
  if (analysis.xmp.read) rows.push({ label: 'XMP', value: 'Readable metadata packet found.', severity: 'info' });
  else if (analysis.xmp.status !== 'absent') rows.push({ label: 'XMP', value: analysis.xmp.status, severity: 'notice' });
  for (const issue of analysis.dateIssues) rows.push({ label: 'Dates', value: issue, severity: analysis.modificationBeforeCreation ? 'warning' : 'notice' });
  if (analysis.fonts.length) rows.push({ label: 'Fonts', value: analysis.fonts.map((font) => `${font.family}: ${font.subsets} subset(s)`).join('; '), severity: analysis.fonts.some((font) => font.subsets > 1) ? 'notice' : 'info' });
  if (analysis.signatures.fields || analysis.signatures.byteRangeCount) rows.push({ label: 'Signatures', value: `${analysis.signatures.fields} signature field(s), ${analysis.signatures.byteRangeCount} ByteRange declaration(s); cryptography not verified.`, severity: 'info' });
  if (analysis.signatures.changedAfterSigning) rows.push({ label: 'After signature coverage', value: `${analysis.signatures.bytesAfterSignature} bytes follow the last declared signed range.`, severity: 'warning' });
  const features = [analysis.javascript && 'JavaScript', analysis.openAction && 'OpenAction', analysis.embeddedFiles && 'embedded files'].filter(Boolean);
  if (features.length) rows.push({ label: 'Active / embedded features', value: `${features.join(', ')} present; nothing was executed or opened.`, severity: 'notice' });
  if (analysis.c2pa.present) rows.push({ label: 'C2PA', value: 'Manifest marker present; claims and signature not verified.', severity: 'notice' });
  if (analysis.c2pa.trainedAlgorithmicMedia) rows.push({ label: 'Source-type metadata', value: 'trainedAlgorithmicMedia mentioned in readable metadata; declaration not verified.', severity: 'notice' });
  if (analysis.c2pa.aiToolNames.length) rows.push({ label: 'Tool-name metadata', value: analysis.c2pa.aiToolNames.join(', '), severity: 'notice' });
  if (analysis.compressed || analysis.objectStreams) rows.push({ label: 'Compressed structures', value: `${analysis.objectStreams ? 'Object streams present. ' : ''}${analysis.compression.decodedStreams} decoded, ${analysis.compression.unreadStreams} compressed stream(s) not read.`, severity: analysis.compression.unreadStreams ? 'notice' : 'info' });
  for (const warning of analysis.warnings.slice(0, 8)) rows.push({ label: 'Read limitation', value: warning, severity: 'notice' });
  return rows;
}

export const toDocumentEvidence = documentEvidence;
