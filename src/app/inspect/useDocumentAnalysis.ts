import { useEffect, useState } from 'react';
import { analysePdf, type PdfAnalysis } from '../../features/inspect/document/pdfForensics';

export type DocumentAnalysisState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'done'; analysis: PdfAnalysis; ms: number }
  | { status: 'failed'; message: string };

/** Structure analysis of an opened PDF, local only. Re-runs when the document changes. */
export function useDocumentAnalysis(sha256: string | null, bytes: Uint8Array | null): DocumentAnalysisState {
  const [state, setState] = useState<DocumentAnalysisState>({ status: 'idle' });
  useEffect(() => {
    if (!sha256 || !bytes) {
      setState({ status: 'idle' });
      return;
    }
    let live = true;
    setState({ status: 'reading' });
    const t0 = performance.now();
    analysePdf(bytes)
      .then((analysis) => live && setState({ status: 'done', analysis, ms: performance.now() - t0 }))
      .catch((e: unknown) => live && setState({ status: 'failed', message: e instanceof Error ? e.message : 'The PDF could not be read.' }));
    return () => {
      live = false;
    };
  }, [sha256, bytes]);
  return state;
}
