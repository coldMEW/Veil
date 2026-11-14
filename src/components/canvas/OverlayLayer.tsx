import { useEffect, useMemo, useRef, useState } from 'react';
import type { CheckResult, Overlay, Point } from '../../contracts';

type Rect = { x: number; y: number; width: number; height: number };

export interface OverlayLayerProps {
  checks: CheckResult[];
  selected: string | null;
  onSelect: (checkId: string) => void;
  /** The element whose content box is the displayed, orientation-corrected image. */
  imageElement: HTMLElement | null;
  width: number;
  height: number;
  rasterOpacity?: number;
}

function useImageRect(element: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const r = element.getBoundingClientRect();
      setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [element]);
  return rect;
}

function pointPath(points: Point[]) { return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '); }
function extendRay(ray: { x1: number; y1: number; x2: number; y2: number }, w: number, h: number) {
  const dx = ray.x2 - ray.x1 || 0.0001; const dy = ray.y2 - ray.y1 || 0.0001;
  const scale = Math.max(w / Math.abs(dx), h / Math.abs(dy)) * 2;
  return { x1: ray.x1 - dx * scale, y1: ray.y1 - dy * scale, x2: ray.x1 + dx * scale, y2: ray.y1 + dy * scale };
}

function rasterUrl(overlay: Extract<Overlay, { type: 'raster' }>) {
  const canvas = document.createElement('canvas'); canvas.width = overlay.width; canvas.height = overlay.height;
  const image = canvas.getContext('2d')!.createImageData(overlay.width, overlay.height);
  overlay.values.forEach((v, i) => { const n = i * 4; image.data[n] = 220; image.data[n + 1] = Math.round(40 + v * 170); image.data[n + 2] = 35; image.data[n + 3] = Math.round(v * 210); });
  canvas.getContext('2d')!.putImageData(image, 0, 0); return canvas.toDataURL();
}

function OverlayShape({ overlay, width, height, opacity }: { overlay: Overlay; width: number; height: number; opacity: number }) {
  if (overlay.type === 'box') return <rect x={overlay.x * width} y={overlay.y * height} width={overlay.width * width} height={overlay.height * height} fill="currentColor" fillOpacity=".08" />;
  if (overlay.type === 'points') return <>{overlay.points.map((p, i) => <circle key={i} cx={p.x * width} cy={p.y * height} r="5" fill="currentColor" />)}</>;
  if (overlay.type === 'lines') return <>{overlay.lines.map((l, i) => <line key={i} x1={l.x1 * width} y1={l.y1 * height} x2={l.x2 * width} y2={l.y2 * height} />)}</>;
  if (overlay.type === 'rays') return <>{overlay.rays.map((r, i) => { const q = extendRay({ x1:r.x1*width,y1:r.y1*height,x2:r.x2*width,y2:r.y2*height }, width, height); return <line key={i} {...q} />; })}</>;
  if (overlay.type === 'polygon') return <path d={`${pointPath(overlay.points.map((p) => ({ x:p.x*width, y:p.y*height })))} Z`} fill="currentColor" fillOpacity=".08" />;
  const url = rasterUrl(overlay); const r = overlay.rect;
  return <image href={url} x={r.x * width} y={r.y * height} width={r.width * width} height={r.height * height} opacity={opacity} preserveAspectRatio="none" />;
}

/** Contract-driven SVG overlay layer aligned to the actual displayed photo rectangle. */
export function OverlayLayer({ checks, selected, onSelect, imageElement, width, height, rasterOpacity = .7 }: OverlayLayerProps) {
  const rect = useImageRect(imageElement);
  const flattened = useMemo(() => checks.flatMap((check) => check.overlays.map((overlay, index) => ({ check, overlay, index }))), [checks]);
  if (!rect || !width || !height) return null;
  return <svg aria-label="Evidence overlays" className="pointer-events-none fixed z-20 overflow-visible" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} viewBox={`0 0 ${width} ${height}`}>
    {flattened.map(({ check, overlay, index }) => {
      const active = selected === check.id; const dim = selected !== null && !active;
      const choose = () => onSelect(check.id);
      return <g key={`${check.id}-${index}`} data-testid="overlay" data-check-id={check.id} data-selected={active ? 'true' : 'false'} role="button" tabIndex={0} aria-label={`Select ${check.title} overlay`} onClick={choose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }} className="pointer-events-auto cursor-pointer text-[#1d5fbf] outline-none" opacity={dim ? .4 : 1}>
        <g stroke="currentColor" strokeWidth={active ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" fill="none"><OverlayShape overlay={overlay} width={width} height={height} opacity={rasterOpacity} /></g>
        <g stroke="transparent" strokeWidth="12" fill="none"><OverlayShape overlay={overlay} width={width} height={height} opacity={0} /></g>
      </g>;
    })}
  </svg>;
}
