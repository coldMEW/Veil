import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import type { CheckResult } from '../../contracts';

const pill: Record<CheckResult['finding'], string> = { consistent: 'bg-[#dcfae5] text-[#04250e]', inconsistent: 'bg-[#ffedea] text-[#831c1e]', inconclusive: 'bg-[#eeeeee] text-[#3d3d3d]', not_applicable: 'bg-[#eeeeee] text-[#3d3d3d]' };
export function EvidenceRow({ check, open, onToggle }: { check: CheckResult; open: boolean; onToggle: () => void }) {
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!details.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return; animate(details.current, { opacity: open ? [0, 1] : [1, 0], duration: 180, ease: 'outQuad' }); }, [open]);
  return <article className="border-b border-line py-2">
    <button data-testid="evidence-row" data-check-id={check.id} aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full items-start justify-between gap-3 text-left"><span><strong className="text-sm">{check.title}</strong><span className="mt-1 block text-sm text-muted">{check.observation}</span></span><span className={`rounded-full px-2 py-1 text-xs ${pill[check.finding]}`}>{check.finding.replace('_', ' ')}</span></button>
    {open && <div ref={details} data-testid="evidence-details" className="grid gap-2 py-3 text-sm text-muted"><p><strong>Method</strong><br />{check.method}</p><p><strong>Assumptions</strong><br />{check.assumptions.join(' ')}</p><p><strong>Limitations</strong><br />{check.limitations.join(' ')}</p><p className="font-mono tabular"><strong>Evidence</strong><br />{Object.entries(check.evidence).map(([k,v]) => `${k}: ${String(v)}`).join(' · ')}</p></div>}
  </article>;
}
