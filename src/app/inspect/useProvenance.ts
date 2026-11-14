import { useEffect, useState } from 'react';
import type { CheckResult } from '../../contracts';
import { readProvenance, toProvenanceCheckResult, type ProvenanceResult } from '../../features/inspect/provenance/contentCredentials';

export type ProvenanceState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'done'; result: ProvenanceResult; checkResult: CheckResult };

/** Reads Content Credentials automatically from the original bytes of each opened photo (local only). */
export function useProvenance(assetId: string | null, bytes: Uint8Array | null, mimeType: string | null): ProvenanceState {
  const [state, setState] = useState<ProvenanceState>({ status: 'idle' });
  useEffect(() => {
    if (!assetId || !bytes || !mimeType) {
      setState({ status: 'idle' });
      return;
    }
    let live = true;
    setState({ status: 'reading' });
    void readProvenance(bytes, mimeType).then((result) => {
      if (live) setState({ status: 'done', result, checkResult: toProvenanceCheckResult(assetId, result) });
    });
    return () => {
      live = false;
    };
  }, [assetId, bytes, mimeType]);
  return state;
}
