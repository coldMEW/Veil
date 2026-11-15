import { formatTimestamp } from './videoFacts.js';

export function combineFindings(local, cloud = []) {
  const findings = [...local.filter(({ check }) => check === 'synthetic_media_model'), ...cloud];
  const ranked = findings.sort((a, b) => a.timeStart - b.timeStart);
  const groups = [];
  for (const finding of ranked) {
    // Group overlapping passages, but keep distinct observations and sources intact.
    const group = groups.at(-1);
    if (!group || finding.timeStart > group.timeEnd + 0.5) {
      groups.push({ timeStart: finding.timeStart, timeEnd: finding.timeEnd, findings: [finding] });
      continue;
    }
    group.timeStart = Math.min(group.timeStart, finding.timeStart);
    group.timeEnd = Math.max(group.timeEnd, finding.timeEnd);
    group.findings.push(finding);
  }
  return groups.map((group) => ({
    ...group,
    label: group.timeEnd - group.timeStart > 0.15
      ? `${formatTimestamp(group.timeStart)}–${formatTimestamp(group.timeEnd)}`
      : formatTimestamp(group.timeStart),
  }));
}
