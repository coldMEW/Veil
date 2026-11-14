import type { ShadowExplanation } from './shadowExplain';
import type { CheckResult } from './shadowTypes';

export type ReflectionExplanation = ShadowExplanation;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}
function angle(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 90 ? value : null;
}

function incompleteObservation(result: CheckResult): string {
  if (result.execution === 'timeout') return 'The check ran out of time. Try again with clear marks and at least 3 pairs.';
  if (result.execution === 'unavailable') return 'The reflection tool is not available. Reopen the photo and try again.';
  const reason = result.reason ?? '';
  if (reason.includes('pair ids')) return 'Some pair labels are missing or repeated. Give each pair its own label and try again.';
  if (reason.includes('numeric range')) return 'Some locations are too far from the photo for this calculation. Open the original photo and mark the pairs again.';
  if (reason.includes('coordinates')) return 'Some point locations are invalid. Mark each point again inside the photo. Keep outside marks only when applying a crop.';
  if (reason.includes('Angular tolerance')) return 'The angle limit is invalid. Choose a limit between 0 and 90 degrees and try again.';
  if (reason.includes('infinityEpsilon')) return 'A calculation setting is invalid. Restore the default settings and try again.';
  if (reason.includes('Image dimensions')) return 'The photo width or height is missing or invalid. Reopen the photo and try again.';
  return 'The calculation could not finish. Check the point matches and try again.';
}

function unclearObservation(reason: string): string {
  if (reason.includes('Separate groups')) return 'Different groups of pairs meet in different places. There may be two separate reflecting surfaces or ambiguous marks. Check that every pair belongs to the same flat surface.';
  if (reason.includes('coincides with a marked object point')) return 'The shared meeting place falls on a marked object point. Its direction cannot be measured there. Check that pair and add points elsewhere in the photo.';
  if (reason.includes('did not converge')) return 'A shared direction could not be calculated reliably. Check the marks and try again.';
  if (reason.includes('ill-conditioned')) return 'The marked lines overlap or leave their shared direction unclear. Mark at least 3 pairs spread across the photo, then try again.';
  return 'There is not enough information for a clear comparison. Mark at least 3 pairs spread across the photo and check each point match.';
}

/** Presentation only. Known templates keep technical or arbitrary reason text out of the card. */
export function explainReflectionResult(result: CheckResult): ReflectionExplanation {
  const explanation: ReflectionExplanation = {
    headline: 'The reflection check is unclear.', observation: '',
    method: 'The check draws a line through each object point and its reflection. With one flat surface, these lines should meet in one place or run in the same direction. It compares each marked line with that shared direction.',
    assumptions: [
      'All marked reflections come from one flat surface, such as a mirror, still water or a glossy floor.',
      'Each marked reflection belongs to the marked object point.',
      'The marks are close enough to the intended points to compare their directions.',
    ],
    unknowns: [
      'Agreeing lines only mean "fits this check". This check cannot tell whether the photo has been changed.',
      'Only the marked pairs are considered. The rest of the photo is outside this check.',
      'A curved or non-flat surface, such as a car body, spoon or wavy water, breaks the one flat surface assumption. Several mirrors also break it.',
      'Marking error and blurry or rippled reflections can change the measured angles.',
      'The surface position and its distance from the camera are not measured.',
      'Displayed angles are rounded to whole degrees.',
    ], perPair: [],
  };
  if (result.source === 'recorded_fixture') explanation.unknowns.push('This is a saved example tied to this exact photo file, not a new check.');
  if (result.execution !== 'complete') {
    explanation.headline = 'The reflection check did not finish.';
    explanation.observation = incompleteObservation(result);
    return explanation;
  }

  const evidence = result.evidence;
  const tolerance = angle(evidence.toleranceDeg);
  const used = ids(evidence.usedPairIds);
  const offenders = new Set(ids(evidence.offendingPairIds));
  const measurements = new Map<string, number | null>();
  if (Array.isArray(evidence.perPairResidual)) for (const row of evidence.perPairResidual) {
    const item = record(row);
    if (typeof item.pairId === 'string' && item.pairId) {
      const value = angle(item.residualDeg);
      measurements.set(item.pairId, value);
      if (value !== null && tolerance !== null && value > tolerance) offenders.add(item.pairId);
    }
  }
  const dropped = new Map<string, string>();
  if (Array.isArray(evidence.droppedPairs)) for (const row of evidence.droppedPairs) {
    const item = record(row);
    if (typeof item.pairId === 'string' && item.pairId) dropped.set(item.pairId, typeof item.reason === 'string' ? item.reason : '');
  }
  const comparable = result.finding === 'consistent' || result.finding === 'inconsistent';
  function pairText(id: string): string {
    if (dropped.has(id)) {
      const reason = dropped.get(id)!;
      if (reason.includes('duplicate')) return `Pair ${id} was not used. It repeats another pair. Mark a different object point and its reflection.`;
      if (reason.includes('length')) return `Pair ${id} was not used. The two marks are too close to show a direction. Choose points farther apart.`;
      return `Pair ${id} was not used. Check both marks and try again.`;
    }
    if (!comparable) return `Pair ${id} was not compared with a shared direction. Check its point match and add clear pairs across the photo.`;
    const value = measurements.get(id);
    if (value === null || value === undefined) return `Pair ${id}: its angle is not available. Check the marks and run the check again.`;
    const limit = tolerance === null ? '' : `, ${value > tolerance ? 'above' : 'within'} the ${Math.round(tolerance)} degree limit`;
    return `Pair ${id} is ${Math.round(value)} degrees off the shared direction${limit}.`;
  }
  explanation.perPair = [...new Set([...used, ...measurements.keys(), ...offenders, ...dropped.keys()])]
    .map((id) => ({ id, text: pairText(id) }));

  if (result.finding === 'not_applicable') {
    explanation.headline = 'More object-reflection pairs are needed.';
    explanation.observation = `${Array.isArray(evidence.usedPairIds) ? `Only ${used.length} distinct pairs remain. ` : ''}Mark at least 3 pairs spread across the photo. Each pair needs an object point and its reflection in the same flat mirror or water.`;
  } else if (result.finding === 'inconclusive') {
    explanation.observation = unclearObservation(result.reason ?? '');
  } else if (result.finding === 'inconsistent') {
    explanation.headline = 'Some marked reflections disagree with one shared direction.';
    const agreeing = ids(evidence.fitSubsetPairIds);
    const search = record(evidence.subsetSearch);
    let context = '';
    if (agreeing.length >= 3) {
      context = `Pairs ${agreeing.join(', ')} fit one shared direction in this check. `;
      explanation.method += ' The largest group that agrees is used to compare the remaining pairs.';
      explanation.unknowns.push('The agreeing group helps locate disagreement. It cannot tell why a mark differs.');
    } else if (typeof search.status === 'string') {
      const descriptions: Record<string, string> = {
        none: 'No group of 3 or more pairs fits one shared direction within the chosen angle limit.',
        ambiguous: 'Several equally large groups meet in different places. No single group was chosen.',
        below_half: 'The largest agreeing group contains fewer than half the marked pairs. No group was chosen.',
        limit_reached: 'The search stopped before a single agreeing group could be chosen.',
      };
      if (descriptions[search.status]) context = `${descriptions[search.status]} These angles use all pairs together. They do not identify one wrong mark. `;
      if (search.status === 'limit_reached') explanation.unknowns.push('Not every group was checked. Review the marks before trying again.');
    }
    explanation.observation = offenders.size
      ? `${context}${[...offenders].map(pairText).join(' ')} Check these point matches.`
      : `${context}Some marked pairs do not fit this check. Their pair labels and angles are not available. Check the marks and run the check again.`;
    explanation.unknowns.push('Two separate reflecting surfaces or ambiguous marks can cause disagreement.');
  } else {
    explanation.headline = 'These reflections fit this check.';
    explanation.observation = tolerance === null ? 'The marked pairs fit the chosen angle limit in this check.'
      : `The marked pairs are within the ${Math.round(tolerance)} degree limit.`;
    const point = evidence.vanishingPoint;
    if (Array.isArray(point) && point.length === 3 && point.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      if (point[2] === 0) {
        explanation.observation += ' The lines run in the same direction instead of meeting at a place in the photo. Either direction along these lines fits.';
        explanation.unknowns.push('A single meeting place is not available when the lines run in the same direction.');
      } else if (point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1) explanation.unknowns.push('The estimated meeting place lies outside the photo.');
    }
  }
  if (dropped.size) explanation.unknowns.push(`${dropped.size} ${dropped.size === 1 ? 'pair was' : 'pairs were'} not used. Review the skipped marks below.`);
  if (tolerance === null && comparable) explanation.unknowns.push('The angle limit is not available, so the displayed angles cannot be compared with it here.');
  if (evidence.angleFrame === 'normalized') explanation.unknowns.push('Angles treat the photo as if it were stretched to a square. Supply its width and height to measure angles in the photo itself.');
  if (evidence.allowOffImagePoints === true) explanation.unknowns.push('Marks outside the crop were kept. Check that they still match the same object points and reflections.');
  const groupSearch = record(evidence.surfaceGroupSearch);
  if (typeof groupSearch.checkedCandidates === 'number' && typeof groupSearch.candidateLimit === 'number'
    && groupSearch.checkedCandidates >= groupSearch.candidateLimit) explanation.unknowns.push('The search for separate surface groups stopped early; not every grouping was checked.');
  return explanation;
}
