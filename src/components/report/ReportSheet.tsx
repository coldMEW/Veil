import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { Printer, X } from '@phosphor-icons/react';
import { ReportView } from './ReportView';
import type { buildReport } from '../../features/report/report';

type Report = ReturnType<typeof buildReport>;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The report as a sheet of A4 paper over the workspace. On screen it is a dialog with Print and Close;
 * in print only the paper remains (print.css).
 */
export function ReportSheet({ report, onClose, pending }: { report: Report; onClose: () => void; pending: string[] }) {
  const paper = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    if (paper.current && !reduced()) animate(paper.current, { opacity: [0, 1], translateY: [24, 0], duration: 360, ease: 'outExpo' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="report-root fixed inset-0 z-50 flex flex-col bg-[#1f2340]/85 text-white backdrop-blur-md">
      <div className="report-toolbar flex h-16 shrink-0 items-center justify-between gap-3 px-3 sm:px-5" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-1">
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close report" className="icon-btn text-white/90 hover:bg-white/10 hover:text-white">
            <X size={22} aria-hidden />
          </button>
          <h2 id="report-title" className="text-lg font-semibold">Report</h2>
        </div>
        <button type="button" onClick={() => window.print()} className="btn btn-primary">
          <Printer size={18} weight="bold" aria-hidden />
          Print or save PDF
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 sm:px-6">
        {pending.length > 0 && (
          <p className="mx-auto mb-3 max-w-[794px] rounded-control bg-notice-bg px-4 py-3 text-sm text-notice-ink" role="status">
            Still running when this report was made: {pending.join(', ')}. They are not included.
          </p>
        )}
        <div
          ref={paper}
          data-testid="report-sheet"
          className="report-paper mx-auto text-ink w-full max-w-[794px] rounded-[4px] bg-white px-6 py-10 shadow-[0_2px_6px_rgb(31_28_23/0.06),0_24px_60px_-12px_rgb(31_28_23/0.25)] sm:min-h-[1123px] sm:px-14 sm:py-14"
        >
          <ReportView report={report} />
        </div>
      </div>
    </div>
  );
}
