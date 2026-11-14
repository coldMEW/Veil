import { shadowAngularResidual, solveShadows } from './solveShadows';
import type { CheckResult, Overlay, ShadowCheckOptions, ShadowPair, ShadowSolution } from './shadowTypes';

const assumptions = [
  'A single dominant light illuminates the marked objects and their cast shadows.',
  'A planar ground surface is not required, but each selected shadow must be cast by the marked point.',
  'User marking error and ambiguous or soft shadow edges affect the measured angles.',
];

/**
 * Conservative ambiguity guard: look for two disjoint groups of >=3 correspondences,
 * each fitting its own stable projected light. This suggests multiple lights or ambiguous
 * markings, not a measured light count. A lone outlier cannot satisfy this guard.
 * Bound candidate count so user annotation sets cannot trigger an unbounded cubic search.
 */
function findSeparateLightGroups(pairs: readonly ShadowPair[], toleranceDeg: number, opts: ShadowCheckOptions) {
  const candidateLimit = 256;
  let checkedCandidates = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      if (checkedCandidates >= candidateLimit) return { groups: null, checkedCandidates, candidateLimit };
      checkedCandidates++;
      const candidate = solveShadows([pairs[i]!, pairs[j]!], opts);
      if (!candidate.lightPoint || candidate.conditioning.illConditioned) continue;
      const group: ShadowPair[] = [];
      const remainder: ShadowPair[] = [];
      for (const pair of pairs) {
        const residual = shadowAngularResidual(pair, candidate.lightPoint, opts.imageSize);
        (residual !== null && residual <= toleranceDeg ? group : remainder).push(pair);
      }
      if (group.length < 3 || remainder.length < 3) continue;
      const first = solveShadows(group, opts);
      const second = solveShadows(remainder, opts);
      if (!first.conditioning.illConditioned && !second.conditioning.illConditioned
        && first.maxResidual !== null && first.maxResidual <= toleranceDeg
        && second.maxResidual !== null && second.maxResidual <= toleranceDeg) {
        return { groups: [first, second], checkedCandidates, candidateLimit };
      }
    }
  }
  return { groups: null, checkedCandidates, candidateLimit };
}

interface SubsetSearch {
  status: 'unique' | 'none' | 'ambiguous' | 'below_half' | 'limit_reached';
  checkedCandidates: number;
  candidateLimit: number;
  bestSubsetSize: number;
  matchingSubsets: number;
  fit: ShadowSolution | null;
}

/** Enumerate combinations in input order without retaining all combinations in memory. */
function* subsets(pairs: readonly ShadowPair[], size: number): Generator<ShadowPair[]> {
  const indices = Array.from({ length: size }, (_, i) => i);
  while (true) {
    yield indices.map((i) => pairs[i]!);
    let pivot = size - 1;
    while (pivot >= 0 && indices[pivot] === pairs.length - size + pivot) pivot--;
    if (pivot < 0) return;
    indices[pivot] = indices[pivot]! + 1;
    for (let i = pivot + 1; i < size; i++) indices[i] = indices[i - 1]! + 1;
  }
}

/**
 * Search largest groups first. For <=12 pairs, 4096 candidates cover all removals.
 * Larger inputs stop at 256 candidates. A partially searched size can never establish
 * uniqueness. Two successful groups of the same largest size already establish a tie.
 */
function findLargestAgreeingSubset(
  pairs: readonly ShadowPair[], toleranceDeg: number, opts: ShadowCheckOptions,
): SubsetSearch {
  const search: SubsetSearch = { status: 'none', checkedCandidates: 0,
    candidateLimit: pairs.length <= 12 ? 4096 : 256, bestSubsetSize: 0, matchingSubsets: 0, fit: null };
  for (let size = pairs.length - 1; size >= 3; size--) {
    let best: ShadowSolution | null = null;
    for (const subset of subsets(pairs, size)) {
      if (search.checkedCandidates >= search.candidateLimit) {
        return { ...search, status: 'limit_reached' };
      }
      search.checkedCandidates++;
      const fit = solveShadows(subset, opts);
      if (!fit.lightPoint || fit.conditioning.illConditioned || fit.maxResidual === null || fit.maxResidual > toleranceDeg) continue;
      search.bestSubsetSize = size;
      search.matchingSubsets++;
      if (size * 2 < pairs.length) return { ...search, status: 'below_half' };
      if (best) return { ...search, status: 'ambiguous' };
      best = fit;
    }
    if (best) return { ...search, status: 'unique', fit: best };
  }
  return search;
}

/** Call only for correspondences whose single-light assumption the user has confirmed. */
export function runShadowCheck(
  pairs: readonly ShadowPair[], imageAssetId: string, opts: ShadowCheckOptions = {},
): CheckResult {
  const toleranceDeg = opts.toleranceDeg ?? 5;
  const result: CheckResult = {
    id: 'physics.shadow_geometry', assetId: imageAssetId, kind: 'physical', execution: 'complete',
    finding: 'inconclusive', title: 'Shadow geometry', source: 'live',
    observation: 'Marked object-shadow lines are checked for a common projected light.',
    method: 'Kee/O\'Brien/Farid shadow-to-object line constraints; homogeneous least squares using a 3x3 symmetric eigensolver; undirected angular residuals.',
    assumptions: [...assumptions], limitations: [...assumptions,
      'This checks marked correspondences only; the projected light does not determine a 3D light position.',
      'The fixed angular tolerance is a marking tolerance, not a calibrated decision rule for an entire image.',
      opts.imageSize ? 'Angles are measured in the pixel plane using the supplied image dimensions.'
        : 'Angles use normalized image coordinates; without image dimensions they are not pixel-plane angles on non-square images.',
      'A least-squares estimate is tested against the tolerance; no search over all feasible tolerance wedges is performed.',
      'Line directions are undirected; the side of the camera containing the light is unknown.',
    ],
    evidence: { toleranceDeg, inputPairCount: pairs.length, minPairLength: 0.01,
      infinityEpsilon: opts.infinityEpsilon ?? 1e-8, minConditionRatio: 1e-6,
      imageSize: opts.imageSize ? { ...opts.imageSize } : null,
      angleFrame: opts.imageSize ? 'pixels' : 'normalized', allowOffImagePoints: opts.allowOffImagePoints ?? false }, overlays: [],
  };
  try {
    if (!Number.isFinite(toleranceDeg) || toleranceDeg < 0 || toleranceDeg > 90) {
      throw new RangeError('Angular tolerance must be finite and between 0 and 90 degrees.');
    }
    const solution = solveShadows(pairs, opts);
    result.evidence = { ...result.evidence, ...solution,
      droppedPairIds: solution.droppedPairs.map((pair) => pair.pairId) };
    for (const dropped of solution.droppedPairs) {
      result.limitations.push(`Dropped pair ${dropped.pairId}: ${dropped.reason}.`);
    }
    if (opts.allowOffImagePoints) result.limitations.push('Off-image annotations are explicitly allowed to retain cropped correspondences.');
    const usedIds = new Set(solution.usedPairIds);
    const usedPairs = pairs.filter((pair) => usedIds.has(pair.id));
    result.overlays = usedPairs.map((pair): Overlay => ({
      type: 'lines', label: `Object-shadow constraint: ${pair.id}`,
      lines: [{ x1: pair.object.x, y1: pair.object.y, x2: pair.shadow.x, y2: pair.shadow.y }],
    }));
    if (solution.usedPairIds.length < 3) {
      result.finding = 'not_applicable';
      result.reason = 'needs at least 3 object-shadow pairs (distinct, nondegenerate correspondences).';
      result.observation = `Only ${solution.usedPairIds.length} usable object-shadow pairs remain.`;
      return result;
    }
    if (solution.conditioning.illConditioned || !solution.lightPoint) {
      result.reason = solution.conditioning.reason ?? 'ill-conditioned: no stable projected light estimate.';
      result.observation = 'The marked lines do not determine a stable projected light position or direction.';
      return result;
    }
    let lightPoint = solution.lightPoint;
    let offendingPairIds = solution.perPairResidual
      .filter((residual) => residual.residualDeg !== null && residual.residualDeg > toleranceDeg)
      .map((residual) => residual.pairId);
    result.evidence.offendingPairIds = offendingPairIds;
    if (offendingPairIds.length && usedPairs.length >= 6) {
      const groupSearch = findSeparateLightGroups(usedPairs, toleranceDeg, opts);
      result.evidence.lightGroupSearch = groupSearch;
      if (groupSearch.checkedCandidates === groupSearch.candidateLimit) {
        result.limitations.push('The separate-light ambiguity search reached its 256-candidate bound.');
      }
      if (groupSearch.groups) {
        result.finding = 'inconclusive';
        result.reason = 'Separate groups fit different projected lights; the single dominant light assumption is uncertain (possible multiple lights or ambiguous markings).';
        result.observation = 'Two disjoint groups of at least 3 marked pairs each fit separate projected lights within the tolerance.';
        result.limitations.push('Separate fitted groups do not establish how many lights were present.');
        return result;
      }
    }
    let subsetObservation: string | null = null;
    if (offendingPairIds.length) {
      const { fit, ...search } = findLargestAgreeingSubset(usedPairs, toleranceDeg, opts);
      result.evidence.pooledFit = solution;
      result.evidence.subsetSearch = search;
      if (fit?.lightPoint) {
        lightPoint = fit.lightPoint;
        const subsetIds = new Set(fit.usedPairIds);
        offendingPairIds = usedPairs.filter((pair) => !subsetIds.has(pair.id)).map((pair) => pair.id);
        const perPairResidual = usedPairs.map((pair) => ({ pairId: pair.id,
          residualDeg: shadowAngularResidual(pair, lightPoint, opts.imageSize) }));
        const maxResidual = perPairResidual.some((pair) => pair.residualDeg === null) ? null
          : perPairResidual.reduce((max, pair) => Math.max(max, pair.residualDeg ?? 0), 0);
        result.evidence = { ...result.evidence, lightPoint, perPairResidual, maxResidual,
          conditioning: fit.conditioning, offendingPairIds,
          fitSubsetPairIds: fit.usedPairIds, fitSubsetMaxResidual: fit.maxResidual };
        const excluded = perPairResidual.filter((pair) => !subsetIds.has(pair.pairId)).map((pair) =>
          pair.residualDeg === null ? `${pair.pairId} has no measurable direction to it`
            : `${pair.pairId} is ${Number(pair.residualDeg.toFixed(2))} degrees off it`);
        subsetObservation = `${fit.usedPairIds.join(', ')} share one projected light; ${excluded.join('; ')}.`;
        result.limitations.push('The largest uniquely agreeing group defines the reference light. Excluded pairs identify disagreement with that group, not its cause.');
      } else {
        const statusText = {
          none: 'No subset of 3 or more pairs agrees within the tolerance.',
          ambiguous: 'No unique subset of 3 or more pairs can be chosen: equally large groups agree with different lights.',
          below_half: 'No qualifying subset agrees: the largest fitting group contains fewer than half the pairs.',
          limit_reached: 'No subset was chosen because the bounded search stopped before uniqueness could be checked.',
          unique: '',
        }[search.status];
        subsetObservation = `${statusText} Using all pairs together, pairs ${offendingPairIds.join(', ')} exceed the ${toleranceDeg} degree tolerance.`;
        result.limitations.push('The pooled fit does not isolate a single wrong marking.');
        if (search.status === 'limit_reached') result.limitations.push('The agreeing-subset search reached its candidate bound.');
      }
    }
    const [x, y, w] = lightPoint;
    if (w === 0) {
      // Opposing rays show an axis, avoiding an unsupported choice of light orientation.
      result.overlays.push({ type: 'rays', label: 'Estimated light axis at infinity (either direction)', rays: [
        { x1: 0.5, y1: 0.5, x2: 0.5 + x * 0.25, y2: 0.5 + y * 0.25 },
        { x1: 0.5, y1: 0.5, x2: 0.5 - x * 0.25, y2: 0.5 - y * 0.25 },
      ] });
    } else {
      result.overlays.push({ type: 'points', points: [{ x, y }], label: 'Estimated projected light' });
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        result.limitations.push('The estimated projected light is outside the image boundary.');
      }
    }
    result.finding = offendingPairIds.length ? 'inconsistent' : 'consistent';
    result.observation = subsetObservation
      ?? `All ${solution.usedPairIds.length} marked lines fit a common projected light ${w === 0 ? 'direction at infinity' : 'position'} within ${toleranceDeg} degrees.`;
  } catch (error) {
    result.execution = 'failed';
    result.finding = 'inconclusive';
    result.reason = error instanceof RangeError ? error.message : 'Shadow geometry could not be computed.';
    result.observation = 'The shadow check did not complete.';
    result.overlays = [];
    // Invalid options must not introduce non-finite values into a deterministic report.
    result.evidence = { inputPairCount: pairs.length };
  }
  return result;
}
