import type { CheckResult } from '../../contracts';

export function OverlayLayer({ checks, selected, onSelect }: { checks: CheckResult[]; selected: string | null; onSelect: (id: string) => void }) {
  return <div className="absolute inset-4 pointer-events-none">
    {checks.flatMap((check) => check.overlays.map((overlay, index) => {
      const style = overlay.type === 'box' ? { left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, width: `${overlay.width * 100}%`, height: `${overlay.height * 100}%` } : { left: `${12 + index * 11}%`, top: `${16 + index * 9}%`, width: '22%', height: '18%' };
      return <button key={`${check.id}-${index}`} type="button" data-testid="overlay" data-check-id={check.id} data-selected={selected === check.id ? 'true' : 'false'} onClick={() => onSelect(check.id)} className={selected === check.id ? 'pointer-events-auto absolute border-2 border-[#1d5fbf]' : 'pointer-events-auto absolute border border-transparent'} style={style} aria-label={`Select ${check.title} overlay`} />;
    }))}
  </div>;
}
