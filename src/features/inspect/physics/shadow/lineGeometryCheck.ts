import { shadowAngularResidual, solveShadows } from './solveShadows';
import type { CheckResult, Overlay, ShadowCheckOptions, ShadowPair, ShadowSolution } from './shadowTypes';

const shadowAssumptions = [
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

export type GeometryMode = 'shadow' | 'reflection';

const reflectionAssumptions = [
  'The marked reflections come from one flat reflecting surface, such as a mirror, still water or a glossy floor.',
  'Each marked reflection is the reflection of the marked point.',
  'User marking error and blurry or rippled reflections affect the measured angles.',
];

/** Shared constraint search and guards; only the physical interpretation changes by mode. */
export function runLineGeometryCheck(
  pairs: readonly ShadowPair[], imageAssetId: string, opts: ShadowCheckOptions,
  mode: GeometryMode,
): CheckResult {
  const reflection = mode === 'reflection';
  const text = (shadow: string, mirror: string) => reflection ? mirror : shadow;
  const assumptions = reflection ? reflectionAssumptions : shadowAssumptions;
  // Translate solver-owned diagnostics, never arbitrary pair ids or asset ids.
  const solverReason = (reason: string) => reflection ? reason
    .replaceAll('Object-shadow', 'Object-reflection')
    .replaceAll('projected light', 'reflection vanishing point')
    .replaceAll('light direction', 'reflection direction') : reason;
  const describeSolution = (solution: ShadowSolution) => {
    if (!reflection) return solution;
    const { lightPoint, ...rest } = solution;
    return { ...rest, vanishingPoint: lightPoint, conditioning: {
      ...rest.conditioning,
      ...(rest.conditioning.reason ? { reason: solverReason(rest.conditioning.reason) } : {}),
    } };
  };
  const toleranceDeg = opts.toleranceDeg ?? 5;
  const result: CheckResult = {
    id: text('physics.shadow_geometry', 'reflection-geometry'), assetId: imageAssetId, kind: 'physical', execution: 'complete',
    finding: 'inconclusive', title: text('Shadow geometry', 'Reflection geometry'), source: 'live',
    observation: text('Marked object-shadow lines are checked for a common projected light.', 'Marked object-reflection lines are checked for one shared vanishing point or direction.'),
    method: text('Kee/O\'Brien/Farid shadow-to-object line constraints; homogeneous least squares using a 3x3 symmetric eigensolver; undirected angular residuals.', 'O\'Brien/Farid reflection line constraints (ACM TOG 2012); shared line solver: homogeneous least squares using a 3x3 symmetric eigensolver; undirected angular residuals.'),
    assumptions: [...assumptions], limitations: [...assumptions,
      text('This checks marked correspondences only; the projected light does not determine a 3D light position.', 'A curved or non-flat surface (car body, spoon, wavy water), or several mirrors, breaks the one flat surface assumption. Agreeing lines only mean \"fits this check\".'),
      'The fixed angular tolerance is a marking tolerance, not a calibrated decision rule for an entire image.',
      opts.imageSize ? 'Angles are measured in the pixel plane using the supplied image dimensions.'
        : 'Angles use normalized image coordinates; without image dimensions they are not pixel-plane angles on non-square images.',
      'A least-squares estimate is tested against the tolerance; no search over all feasible tolerance wedges is performed.',
      text('Line directions are undirected; the side of the camera containing the light is unknown.', 'Line directions are undirected; this check does not measure the surface position or its distance from the camera.'),
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
    result.evidence = { ...result.evidence, ...describeSolution(solution),
      droppedPairIds: solution.droppedPairs.map((pair) => pair.pairId) };
    for (const dropped of solution.droppedPairs) {
      result.limitations.push(`Dropped pair ${dropped.pairId}: ${dropped.reason}.`);
    }
    if (opts.allowOffImagePoints) result.limitations.push('Off-image annotations are explicitly allowed to retain cropped correspondences.');
    const usedIds = new Set(solution.usedPairIds);
    const usedPairs = pairs.filter((pair) => usedIds.has(pair.id));
    result.overlays = usedPairs.map((pair): Overlay => ({
      type: 'lines', label: `${text('Object-shadow', 'Object-reflection')} constraint: ${pair.id}`,
      lines: [{ x1: pair.object.x, y1: pair.object.y, x2: pair.shadow.x, y2: pair.shadow.y }],
    }));
    if (solution.usedPairIds.length < 3) {
      result.finding = 'not_applicable';
      result.reason = text('needs at least 3 object-shadow pairs (distinct, nondegenerate correspondences).', 'needs at least 3 object-reflection pairs (distinct, nondegenerate correspondences).');
      result.observation = `Only ${solution.usedPairIds.length} usable ${text('object-shadow', 'object-reflection')} pairs remain.`;
      return result;
    }
    if (solution.conditioning.illConditioned || !solution.lightPoint) {
      result.reason = solverReason(solution.conditioning.reason ?? 'ill-conditioned: no stable projected light estimate.');
      result.observation = text('The marked lines do not determine a stable projected light position or direction.', 'The marked lines do not determine a stable reflection vanishing point or direction.');
      return result;
    }
    let lightPoint = solution.lightPoint;
    let offendingPairIds = solution.perPairResidual
      .filter((residual) => residual.residualDeg !== null && residual.residualDeg > toleranceDeg)
      .map((residual) => residual.pairId);
    result.evidence.offendingPairIds = offendingPairIds;
    if (offendingPairIds.length && usedPairs.length >= 6) {
      const groupSearch = findSeparateLightGroups(usedPairs, toleranceDeg, opts);
      result.evidence[reflection ? 'surfaceGroupSearch' : 'lightGroupSearch'] = reflection
        ? { ...groupSearch, groups: groupSearch.groups?.map(describeSolution) ?? null } : groupSearch;
      if (groupSearch.checkedCandidates === groupSearch.candidateLimit) {
        result.limitations.push(text('The separate-light ambiguity search reached its 256-candidate bound.', 'The separate-surface ambiguity search reached its 256-candidate bound.'));
      }
      if (groupSearch.groups) {
        result.finding = 'inconclusive';
        result.reason = text('Separate groups fit different projected lights; the single dominant light assumption is uncertain (possible multiple lights or ambiguous markings).', 'Separate groups fit different reflection vanishing points; the one flat surface assumption is uncertain (possible two separate reflecting surfaces or ambiguous marks).');
        result.observation = text('Two disjoint groups of at least 3 marked pairs each fit separate projected lights within the tolerance.', 'Two disjoint groups of at least 3 marked pairs each fit separate reflection vanishing points within the tolerance.');
        result.limitations.push(text('Separate fitted groups do not establish how many lights were present.', 'Separate fitted groups do not establish how many reflecting surfaces were present.'));
        return result;
      }
    }
    let subsetObservation: string | null = null;
    if (offendingPairIds.length) {
      const { fit, ...search } = findLargestAgreeingSubset(usedPairs, toleranceDeg, opts);
      result.evidence.pooledFit = describeSolution(solution);
      result.evidence.subsetSearch = search;
      if (fit?.lightPoint) {
        lightPoint = fit.lightPoint;
        const subsetIds = new Set(fit.usedPairIds);
        offendingPairIds = usedPairs.filter((pair) => !subsetIds.has(pair.id)).map((pair) => pair.id);
        const perPairResidual = usedPairs.map((pair) => ({ pairId: pair.id,
          residualDeg: shadowAngularResidual(pair, lightPoint, opts.imageSize) }));
        const maxResidual = perPairResidual.some((pair) => pair.residualDeg === null) ? null
          : perPairResidual.reduce((max, pair) => Math.max(max, pair.residualDeg ?? 0), 0);
        result.evidence = { ...result.evidence, ...(reflection ? { vanishingPoint: lightPoint } : { lightPoint }), perPairResidual, maxResidual,
          conditioning: describeSolution(fit).conditioning, offendingPairIds,
          fitSubsetPairIds: fit.usedPairIds, fitSubsetMaxResidual: fit.maxResidual };
        const excluded = perPairResidual.filter((pair) => !subsetIds.has(pair.pairId)).map((pair) =>
          pair.residualDeg === null ? `${pair.pairId} has no measurable direction to it`
            : `${pair.pairId} is ${Math.round(pair.residualDeg)} degrees off it`);
        subsetObservation = `${fit.usedPairIds.join(', ')} share one ${text('projected light', 'reflection vanishing point')}; ${excluded.join('; ')}.`;
        result.limitations.push(text('The largest uniquely agreeing group defines the reference light. Excluded pairs identify disagreement with that group, not its cause.', 'The largest uniquely agreeing group defines the reference reflection vanishing point. Excluded pairs identify disagreement with that group, not its cause.'));
      } else {
        const statusText = {
          none: 'No subset of 3 or more pairs agrees within the tolerance.',
          ambiguous: text('No unique subset of 3 or more pairs can be chosen: equally large groups agree with different lights.', 'No unique subset of 3 or more pairs can be chosen: equally large groups agree with different reflection vanishing points.'),
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
      result.overlays.push({ type: 'rays', label: text('Estimated light axis at infinity (either direction)', 'Reflection axis at infinity (either direction)'), rays: [
        { x1: 0.5, y1: 0.5, x2: 0.5 + x * 0.25, y2: 0.5 + y * 0.25 },
        { x1: 0.5, y1: 0.5, x2: 0.5 - x * 0.25, y2: 0.5 - y * 0.25 },
      ] });
    } else {
      result.overlays.push({ type: 'points', points: [{ x, y }], label: text('Estimated projected light', 'Estimated reflection vanishing point') });
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        result.limitations.push(text('The estimated projected light is outside the image boundary.', 'The estimated reflection vanishing point is outside the image boundary.'));
      }
    }
    result.finding = offendingPairIds.length ? 'inconsistent' : 'consistent';
    result.observation = subsetObservation
      ?? `All ${solution.usedPairIds.length} marked lines fit a common ${text('projected light', 'reflection vanishing point')} ${w === 0 ? 'direction at infinity' : 'position'} within ${toleranceDeg} degrees.${reflection ? ' This only means \"fits this check\".' : ''}`;
  } catch (error) {
    result.execution = 'failed';
    result.finding = 'inconclusive';
    result.reason = error instanceof RangeError ? solverReason(error.message) : text('Shadow geometry could not be computed.', 'Reflection geometry could not be computed.');
    result.observation = text('The shadow check did not complete.', 'The reflection check did not complete.');
    result.overlays = [];
    // Invalid options must not introduce non-finite values into a deterministic report.
    result.evidence = { inputPairCount: pairs.length };
  }
  return result;
}
