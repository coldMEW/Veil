import { useCallback, useEffect, useMemo, useState } from 'react';
import { runShadowCheck } from './shadowCheck';
import type { CheckResult, HomogeneousPoint, ShadowPair } from './shadowTypes';

export interface NormPoint {
  x: number;
  y: number;
}

/** What the canvas draws for shadow marking. Coordinates are normalized to the oriented image. */
export interface ShadowDrawing {
  pairs: ShadowPair[];
  /** An object point waiting for its shadow point. */
  pending: NormPoint | null;
  /** Pair ids whose line is off the shared light by more than the tolerance. */
  offending: string[];
  /** Finite light (w=1) or a direction at infinity (w=0); null when not estimated. */
  light: HomogeneousPoint | null;
}

export interface ShadowAnnotation {
  marking: boolean;
  setMarking: (on: boolean) => void;
  pairs: ShadowPair[];
  pending: NormPoint | null;
  addPoint: (p: NormPoint) => void;
  undo: () => void;
  clear: () => void;
  /** Null until the person has marked at least one complete pair. */
  result: CheckResult | null;
  drawing: ShadowDrawing | null;
}

export const MIN_PAIRS = 3;

/**
 * Marking state for the shadow check. Tap an object point, then its shadow point; repeat.
 * Everything resets when the photo changes, so no marks or results carry over (product rule 7).
 */
export function useShadowAnnotation(
  assetId: string | null,
  imageSize: { width: number; height: number } | null,
): ShadowAnnotation {
  const [marking, setMarking] = useState(false);
  const [pairs, setPairs] = useState<ShadowPair[]>([]);
  const [pending, setPending] = useState<NormPoint | null>(null);
  const [nextId, setNextId] = useState(1);

  useEffect(() => {
    setMarking(false);
    setPairs([]);
    setPending(null);
    setNextId(1);
  }, [assetId]);

  const addPoint = useCallback(
    (p: NormPoint) => {
      if (!pending) {
        setPending(p);
        return;
      }
      setPairs((prev) => [...prev, { id: `P${nextId}`, object: pending, shadow: p }]);
      setNextId((n) => n + 1);
      setPending(null);
    },
    [pending, nextId],
  );

  const undo = useCallback(() => {
    if (pending) {
      setPending(null);
      return;
    }
    setPairs((prev) => prev.slice(0, -1));
  }, [pending]);

  const clear = useCallback(() => {
    setPairs([]);
    setPending(null);
    setNextId(1);
  }, []);

  const width = imageSize?.width;
  const height = imageSize?.height;
  const result = useMemo(() => {
    if (!assetId || pairs.length === 0) return null;
    const opts = width && height ? { imageSize: { width, height } } : {};
    return runShadowCheck(pairs, assetId, opts);
  }, [assetId, pairs, width, height]);

  const drawing = useMemo<ShadowDrawing | null>(() => {
    if (!assetId || (pairs.length === 0 && !pending)) return null;
    const ev = (result?.evidence ?? {}) as { offendingPairIds?: unknown; lightPoint?: unknown };
    const offending = Array.isArray(ev.offendingPairIds) ? (ev.offendingPairIds as string[]) : [];
    const fitted = result?.execution === 'complete' && (result.finding === 'consistent' || result.finding === 'inconsistent');
    const light = fitted && Array.isArray(ev.lightPoint) ? (ev.lightPoint as HomogeneousPoint) : null;
    return { pairs, pending, offending, light };
  }, [assetId, pairs, pending, result]);

  return { marking, setMarking, pairs, pending, addPoint, undo, clear, result, drawing };
}
