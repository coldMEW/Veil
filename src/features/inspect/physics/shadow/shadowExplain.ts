import type { CheckResult } from './shadowTypes';

export interface ShadowExplanation {
  headline: string;
  observation: string;
  method: string;
  assumptions: string[];
  unknowns: string[];
  /** Original marking ids, for connecting each explanation to its overlay. */
  perPair: { id: string; text: string }[];
}

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

function degrees(value: number): string {
  return Math.round(value).toString();
}

function incompleteObservation(result: CheckResult): string {
  if (result.execution === 'timeout') {
    return 'The check ran out of time. Try again with clear marks and at least 3 pairs.';
  }
  if (result.execution === 'unavailable') {
    return 'The shadow tool is not available. Reopen the photo and try again.';
  }
  const reason = result.reason ?? '';
  if (reason.includes('pair ids')) return 'Some pair labels are missing or repeated. Give each pair its own label and try again.';
  if (reason.includes('numeric range')) return 'Some locations are too far from the photo for this calculation. Open the original photo and mark the pairs again.';
  if (reason.includes('coordinates')) return 'Some point locations are invalid. Please mark each point again inside the photo. Keep outside marks only when applying a crop.';
  if (reason.includes('Angular tolerance')) return 'The angle limit is invalid. Choose a limit between 0 and 90 degrees and try again.';
  if (reason.includes('infinityEpsilon')) return 'A calculation setting is invalid. Restore the default settings and try again.';
  if (reason.includes('Image dimensions')) return 'The photo width or height is missing or invalid. Reopen the photo and try again.';
  return 'The calculation could not finish. Check the point matches and try again.';
}

function unclearObservation(reason: string): string {
  if (reason.includes('Separate groups')) {
    return 'Different groups of pairs fit different lights. More than one light or uncertain point matches may explain this. Check which light each shadow belongs to before trying again.';
  }
  if (reason.includes('coincides with a marked object point')) {
    return 'The estimated light falls on a marked object point, so its direction cannot be measured there. Check that pair and add points elsewhere in the photo.';
  }
  if (reason.includes('did not converge')) {
    return 'A shared light direction could not be calculated reliably. Check the marks and try again.';
  }
  if (reason.includes('ill-conditioned')) {
    return 'The marked lines overlap or leave the light direction unclear. Mark at least 3 pairs spread across the photo, then try again.';
  }
  return 'There is not enough information for a clear comparison. Mark at least 3 pairs spread across the photo and check each point match.';
}

/**
 * Presentation only: never recomputes or upgrades a finding. Technical descriptions and
 * arbitrary reason text are translated through known templates rather than repeated.
 */
export function explainShadowResult(result: CheckResult): ShadowExplanation {
  const explanation: ShadowExplanation = {
    headline: 'The shadow check is unclear.',
    observation: '',
    method: 'The check draws a line through each object point and its matching shadow point. It looks for one shared light and compares each pair\'s angle to the direction toward that light.',
    assumptions: [
      'One main light casts the marked shadows.',
      'Each shadow point belongs to the marked point on its object.',
      'The marks are close enough to the intended points to compare their directions.',
      'Flat ground is not required when the object and shadow points match.',
    ],
    unknowns: [
      'This check cannot tell whether the photo has been changed.',
      'Only the marked pairs are considered. The rest of the photo is outside this check.',
      'The light\'s distance and height are not measured.',
    ],
    perPair: [],
  };
  if (result.source === 'recorded_fixture') {
    explanation.unknowns.push('This is a saved example tied to this exact photo file, not a new check.');
  }
  // Stale evidence must never appear as a finding when execution did not complete.
  if (result.execution !== 'complete') {
    explanation.headline = 'The shadow check did not finish.';
    explanation.observation = incompleteObservation(result);
    return explanation;
  }

  const evidence = result.evidence;
  const tolerance = angle(evidence.toleranceDeg);
  const measurements = new Map<string, number | null>();
  if (Array.isArray(evidence.perPairResidual)) {
    for (const row of evidence.perPairResidual) {
      const item = record(row);
      if (typeof item.pairId === 'string' && item.pairId) measurements.set(item.pairId, angle(item.residualDeg));
    }
  }
  const usedIds = ids(evidence.usedPairIds);
  const offenders = new Set(ids(evidence.offendingPairIds));
  for (const [id, value] of measurements) {
    if (value !== null && tolerance !== null && value > tolerance) offenders.add(id);
  }
  const dropped = new Map<string, string>();
  if (Array.isArray(evidence.droppedPairs)) {
    for (const row of evidence.droppedPairs) {
      const item = record(row);
      if (typeof item.pairId === 'string' && item.pairId) {
        dropped.set(item.pairId, typeof item.reason === 'string' ? item.reason : '');
      }
    }
  }
  const allIds = new Set([...usedIds, ...measurements.keys(), ...offenders, ...dropped.keys()]);
  const comparable = result.finding === 'consistent' || result.finding === 'inconsistent';
  function pairText(id: string): string {
    if (dropped.has(id)) {
      const reason = dropped.get(id)!;
      if (reason.includes('duplicate')) return `Pair ${id} was not used. It repeats another pair. Mark a different object and its matching shadow.`;
      if (reason.includes('length')) return `Pair ${id} was not used. The two marks are too close to show a direction. Choose points farther apart.`;
      return `Pair ${id} was not used. Check both marks and try again.`;
    }
    if (!comparable) return `Pair ${id} was not compared with a shared light. Check its point match and add clear pairs across the photo.`;
    const value = measurements.get(id);
    if (value === null || value === undefined) return `Pair ${id}: its angle is not available. Check the marks and run the check again.`;
    const aboveLimit = tolerance !== null && value > tolerance;
    const amount = `${degrees(value)} degrees`;
    const limit = tolerance === null ? ''
      : `, ${aboveLimit ? 'above' : 'within'} the ${tolerance} degree limit`;
    return `Pair ${id} is ${amount} off the direction to the shared light${limit}.`;
  }
  explanation.perPair = [...allIds].map((id) => ({ id, text: pairText(id) }));

  if (result.finding === 'not_applicable') {
    explanation.headline = 'More object-shadow pairs are needed.';
    explanation.observation = `${Array.isArray(evidence.usedPairIds) ? `Only ${usedIds.length} distinct pairs remain. ` : ''}Mark at least 3 pairs spread across the photo. Each pair needs a point on an object and the matching point on its shadow.`;
  } else if (result.finding === 'inconclusive') {
    explanation.observation = unclearObservation(result.reason ?? '');
  } else if (result.finding === 'inconsistent') {
    explanation.headline = 'Some marked shadows disagree with one shared light.';
    const agreeingIds = ids(evidence.fitSubsetPairIds);
    const subsetSearch = record(evidence.subsetSearch);
    let context = '';
    if (agreeingIds.length >= 3) {
      context = `Pairs ${agreeingIds.join(', ')} fit one light in this check. `;
      explanation.method += ' The largest group that agrees on one light is used to compare the remaining pairs.';
      explanation.unknowns.push('The agreeing group helps locate disagreement. It cannot tell why a mark differs.');
    } else if (typeof subsetSearch.status === 'string') {
      const descriptions: Record<string, string> = {
        none: 'No group of 3 or more pairs fits one light within the chosen angle limit.',
        ambiguous: 'Several equally large groups fit different lights. No single group was chosen.',
        below_half: 'The largest agreeing group contains fewer than half the marked pairs. No group was chosen.',
        limit_reached: 'The search stopped before a single agreeing group could be chosen.',
      };
      const description = descriptions[subsetSearch.status];
      if (description) context = `${description} These angles use all pairs together. They do not identify one wrong mark. `;
      if (subsetSearch.status === 'limit_reached') explanation.unknowns.push('Not every group was checked. Review the marks before trying again.');
    }
    explanation.observation = offenders.size
      ? `${context}${[...offenders].map(pairText).join(' ')} Check these point matches.`
      : `${context}Some marked pairs do not fit one shared light in this check. Their pair labels and angles are not available. Check the marks and run the check again.`;
    explanation.unknowns.push(
      'More than one light can cause disagreement.',
      'Marking error can change the measured angles.',
      'Curved or uneven ground can make it harder to match each shadow to the right point.',
      'A shadow may be cast by a different part of the object.',
    );
  } else {
    explanation.headline = 'These shadows fit one light source in this check.';
    explanation.observation = tolerance === null
      ? 'The marked pairs fit the chosen angle limit in this check.'
      : `The marked pairs are within the ${tolerance} degree limit.`;
    const light = evidence.lightPoint;
    if (Array.isArray(light) && light.length === 3 && light.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      if (light[2] === 0) {
        explanation.observation += ' The lines have a shared direction, as shadows from a distant light can.';
        explanation.unknowns.push('A precise light position is not available when the lines share a direction.');
      } else if (light[0] < 0 || light[0] > 1 || light[1] < 0 || light[1] > 1) {
        explanation.unknowns.push('The estimated light location lies outside the photo.');
      }
    }
  }
  if (dropped.size) explanation.unknowns.push(`${dropped.size} ${dropped.size === 1 ? 'pair was' : 'pairs were'} not used. Review the skipped marks below.`);
  if (tolerance === null && comparable) explanation.unknowns.push('The angle limit is not available, so the displayed angles cannot be compared with it here.');
  if (evidence.angleFrame === 'normalized') explanation.unknowns.push('Angles treat the photo as if it were stretched to a square. Supply its width and height to measure angles in the photo itself.');
  if (evidence.allowOffImagePoints === true) explanation.unknowns.push('Marks outside the crop were kept. Check that they still match the same object and shadow points.');
  const groupSearch = record(evidence.lightGroupSearch);
  if (typeof groupSearch.checkedCandidates === 'number' && typeof groupSearch.candidateLimit === 'number'
    && groupSearch.checkedCandidates >= groupSearch.candidateLimit) {
    explanation.unknowns.push('The search for separate light groups stopped early; not every grouping was checked.');
  }
  return explanation;
}
