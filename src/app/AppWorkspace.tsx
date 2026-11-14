import { useEffect, useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { MotionConfig, motion } from 'motion/react';
import {
  ArrowCounterClockwise,
  Broom,
  CaretDown,
  Check,
  Copy,
  FilePdf,
  FileText,
  LockSimple,
  MagnifyingGlass,
  ShieldCheck,
  WarningOctagon,
  X,
  type IconProps,
} from '@phosphor-icons/react';
import { ImageCanvas } from '../components/canvas/ImageCanvas';
import type { Rect } from '../components/canvas/Viewfinder';
import { OverlayLayer } from '../components/canvas/OverlayLayer';
import { ChoosePhotoButton, OpenAnotherButton } from '../components/ImagePicker';
import { closeImage, openImageFile, useImageSession, type ImageSessionState } from '../lib/runtime/imageSession';
import { ModelFocusCard } from '../features/inspect/model/ModelFocusCard';
import { useModelFocus } from '../features/inspect/model/useModelFocus';
import type { HeatOverlay, MarkOverlay } from '../components/canvas/ImageCanvas';
import { ShadowCard } from '../features/inspect/physics/shadow/ShadowCard';
import { useShadowAnnotation } from '../features/inspect/physics/shadow/useShadowAnnotation';
import { CleanFlow } from './clean/CleanPanel';
import { ProtectPanel } from './protect/ProtectPanel';
import { useProtect } from './protect/useProtect';
import { FaceWarpCard } from './inspect/FaceWarpCard';
import { widenToTrainingCrop } from './inspect/faceBox';
import { ProvenanceCard } from './inspect/ProvenanceCard';
import { useProvenance } from './inspect/useProvenance';
import { useDocumentAnalysis } from './inspect/useDocumentAnalysis';
import { DocumentPanel } from './inspect/DocumentPanel';
import { useWarpDetector } from '../features/inspect/warp/useWarpDetector';
import { LOW as WARP_LOW, toWarpOverlay } from '../features/inspect/warp/preprocess';
import type { FaceBox } from '../features/inspect/warp/warpTypes';
import { useClean, type FillMethod } from './clean/useClean';
import { EvidenceRow } from './results/EvidenceRow';
import { EvidenceSheet } from './results/EvidenceSheet';
import { toEvidence } from './results/evidence';
import { aiSignalFinding, provenanceFinding, warpFinding, type Finding } from './results/findings';
import { ReportSheet } from '../components/report/ReportSheet';
import { buildReport } from '../features/report/report';
import type { CheckResult } from '../contracts';

type TabId = 'inspect' | 'clean' | 'protect';
type Ready = Extract<ImageSessionState, { status: 'ready' }>;


const EASE = [0.16, 1, 0.3, 1] as const;
const onFile = (file: File) => void openImageFile(file);

type Mode = 'photo' | 'document' | 'clean' | 'protect';

export function AppWorkspace() {
  const [mode, setMode] = useState<Mode>('photo');
  const [showReport, setShowReport] = useState(false);
  const tab: TabId = mode === 'clean' ? 'clean' : mode === 'protect' ? 'protect' : 'inspect';
  const session = useImageSession();
  const ready = session.status === 'ready' ? session : null;
  const focus = useModelFocus(ready?.asset.id ?? null, ready?.bitmap ?? null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null);
  const imageSize = useMemo(
    () => (ready ? { width: ready.asset.width, height: ready.asset.height } : null),
    [ready?.asset.id],
  );
  const shadow = useShadowAnnotation(ready?.asset.id ?? null, imageSize);
  const doc = session.status === 'document' ? session : null;
  const provenance = useProvenance(
    ready?.asset.id ?? doc?.sha256 ?? null,
    ready?.bytes ?? doc?.bytes ?? null,
    ready ? ready.asset.mimeType : doc ? 'application/pdf' : null,
  );
  const docAnalysis = useDocumentAnalysis(doc?.sha256 ?? null, doc?.bytes ?? null);
  const warp = useWarpDetector(ready?.asset.id ?? null, ready?.bitmap ?? null);
  const [faceMarking, setFaceMarking] = useState(false);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [showWarp, setShowWarp] = useState(true);
  useEffect(() => {
    setFaceMarking(false);
    setFaceBox(null);
  }, [ready?.asset.id]);
  useEffect(() => {
    if (shadow.marking) setFaceMarking(false);
  }, [shadow.marking]);
  const startFaceMarking = () => {
    shadow.setMarking(false);
    setFaceMarking(true);
    warp.preload?.(); // load and verify the model while the person draws
  };
  const onImageRect =
    faceMarking && tab === 'inspect'
      ? (tight: FaceBox) => {
          if (!ready) return;
          const crop = widenToTrainingCrop(tight, ready.asset.width, ready.asset.height);
          setFaceMarking(false);
          setFaceBox(crop);
          setShowWarp(true);
          void warp.run(crop);
        }
      : null;
  // Render the predicted-warp heat once per result, not on every paint.
  const warpHeat = useMemo(() => {
    if (warp.state.status !== 'done' || !ready) return null;
    const r = warp.state.result;
    const c = document.createElement('canvas');
    c.width = r.width;
    c.height = r.height;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(toWarpOverlay(r.magnitude, r.width, r.height)), r.width, r.height), 0, 0);
    const W = ready.asset.width;
    const H = ready.asset.height;
    return { rect: { x: r.faceRect.x / W, y: r.faceRect.y / H, w: r.faceRect.width / W, h: r.faceRect.height / H }, image: c };
  }, [warp.state, ready]);
  const onImagePoint = shadow.marking && tab === 'inspect' ? shadow.addPoint : null;
  const clean = useClean(ready?.asset.id ?? null, ready?.asset.sha256 ?? null, ready?.bitmap ?? null);
  const [fillMethod, setFillMethod] = useState<FillMethod>('migan_inpaint');
  const [showAfter, setShowAfter] = useState(true);
  const cs = clean.state;
  const cleanCandidates =
    cs.status === 'review' || cs.status === 'cleaning' || (cs.status === 'done' && !showAfter) ? cs.candidates : null;
  const boxes = useMemo(
    () =>
      tab === 'clean' && cleanCandidates
        ? cleanCandidates.map((c) => ({ id: c.id, x: c.region.x, y: c.region.y, w: c.region.w, h: c.region.h, selected: c.selected }))
        : null,
    [tab, cleanCandidates],
  );
  const protectHook = useProtect(ready?.asset.id ?? null, ready?.asset.sha256 ?? null, ready?.bitmap ?? null);
  const ps = protectHook.state;
  const [showProtected, setShowProtected] = useState(true);
  const displayBitmap =
    tab === 'clean' && cs.status === 'done' && showAfter
      ? cs.preview
      : tab === 'protect' && ps.status === 'done' && showProtected
        ? ps.preview
        : null;
  // Protect: the model downloads by itself as soon as the tab opens.
  useEffect(() => {
    if (tab === 'protect' && ready && ps.status === 'idle') void protectHook.load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ready?.asset.id, ps.status]);
  // Clean: opening the tab finds private text and removes the confidently found high-risk items straight away.
  useEffect(() => {
    if (tab === 'clean' && ready && cs.status === 'idle') {
      setShowAfter(true);
      void clean.scan({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ready?.asset.id]);
  const overlay = useMemo<HeatOverlay | null>(
    () =>
      focus.state.status === 'done' && showOverlay
        ? { rect: focus.state.result.crop, grid: focus.state.result.grid, values: focus.state.magnitudes, rgba: focus.state.overlay }
        : null,
    [focus.state, showOverlay],
  );
  const modelCard = (
    <ModelFocusCard
      state={focus.state}
      onRun={() => {
        setShowOverlay(true);
        void focus.run();
      }}
      onCancel={focus.cancel}
      showOverlay={showOverlay}
      onToggleOverlay={() => setShowOverlay((v) => !v)}
    />
  );

  // Keep the mode in step with what was actually opened (a PDF dropped on "Check a photo", etc.).
  useEffect(() => {
    if (session.status === 'document' && mode === 'photo') setMode('document');
    if (session.status === 'ready' && mode === 'document') setMode('photo');
  }, [session.status, mode]);
  useEffect(() => setShowReport(false), [ready?.asset.id, doc?.sha256]);
  // Step 2: the automatic checks start as soon as a photo opens for checking.
  useEffect(() => {
    if (mode === 'photo' && ready && focus.state.status === 'idle') {
      setShowOverlay(true);
      void focus.run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready?.asset.id]);

  const shadowFinding: Finding = (() => {
    const r = shadow.result;
    const base = { id: 'shadows', title: 'Shadow geometry', layer: 'shadow' as const };
    if (!r) return { ...base, tone: 'idle', headline: 'Optional: mark objects and their shadows.' };
    if (r.execution !== 'complete' || r.finding === 'inconclusive' || r.finding === 'not_applicable')
      return { ...base, tone: 'idle', headline: r.reason ? `Needs more: ${r.reason}` : 'Not enough marks yet.' };
    return r.finding === 'inconsistent'
      ? { ...base, tone: 'notice', headline: 'Some marked shadows disagree with one light source.' }
      : { ...base, tone: 'clear', headline: 'The marked shadows fit one light source.' };
  })();
  // When a map is switched on but has nothing above its threshold, say so on the photo.
  const aiMapEmpty =
    showOverlay && focus.state.status === 'done' && !Array.from(focus.state.overlay).some((v, i) => i % 4 === 3 && v > 0);
  const warpMapEmpty =
    showWarp && warp.state.status === 'done' && warp.state.result.maxMagnitude < WARP_LOW;
  const findings: Finding[] = [provenanceFinding(provenance), aiSignalFinding(focus.state), warpFinding(warp.state), shadowFinding];
  const checking = provenance.status !== 'done' || focus.state.status === 'loading' || focus.state.status === 'running';
  const report = useMemo(() => {
    if (!showReport || !ready) return null;
    const checks: CheckResult[] = [];
    if (provenance.status === 'done') checks.push(provenance.checkResult);
    if (focus.state.status === 'done') checks.push(focus.state.checkResult);
    if (warp.state.status === 'done') checks.push(warp.state.checkResult);
    if (shadow.result) checks.push({ ...(shadow.result as unknown as CheckResult), overlays: [] });
    return buildReport({
      appVersion: '0.1.0',
      commit: 'local',
      generatedAt: new Date().toISOString(),
      original: ready.asset,
      checks,
      candidates: [],
      transforms: [],
    });
  }, [showReport, ready, provenance, focus.state, warp.state, shadow.result]);
  const startOver = () => {
    setShowReport(false);
    closeImage();
  };

  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Evidence rows: one view model shared by the rail, the phone sheet, the overlays and the report.
  const regions = useMemo(() => {
    if (!ready) return {};
    const W = ready.asset.width;
    const H = ready.asset.height;
    const crop = focus.state.status === 'done' ? focus.state.result.crop : null;
    const pairs = shadow.drawing?.pairs ?? [];
    const pts = pairs.flatMap((p) => [p.object, p.shadow]);
    const pad = 0.03;
    const shadowBox =
      pts.length >= 2
        ? (() => {
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            const x = Math.max(0, Math.min(...xs) - pad);
            const y = Math.max(0, Math.min(...ys) - pad);
            return { x, y, w: Math.min(1, Math.max(...xs) + pad) - x, h: Math.min(1, Math.max(...ys) + pad) - y };
          })()
        : null;
    return {
      provenance: { x: 0, y: 0, w: 1, h: 1 },
      'ai-signal': crop ? { x: crop.x / W, y: crop.y / H, w: crop.width / W, h: crop.height / H } : null,
      'face-warp': faceBox,
      shadows: shadowBox,
    };
  }, [ready, focus.state, shadow.drawing, faceBox]);
  const checksById = {
    provenance: provenance.status === 'done' ? provenance.checkResult : undefined,
    'ai-signal': focus.state.status === 'done' ? focus.state.checkResult : undefined,
    'face-warp': warp.state.status === 'done' ? warp.state.checkResult : undefined,
    shadows: shadow.result ? (shadow.result as unknown as CheckResult) : undefined,
  };
  const items = toEvidence(findings, checksById, regions, {
    ai: { visible: showOverlay, available: focus.state.status === 'done', toggle: () => setShowOverlay((v) => !v) },
    face: { visible: showWarp, available: warp.state.status === 'done', toggle: () => setShowWarp((v) => !v) },
  });
  const pendingTitles = findings.filter((f) => f.tone === 'pending').map((f) => f.title);
  const flagged = findings.filter((f) => f.tone === 'alert').length;
  const toggleRow = (id: string) => setSelectedCheck((cur) => (cur === id ? null : id));

  const goTab = (next: TabId) => {
    if (next === 'clean') setMode('clean');
    else if (next === 'protect') setMode('protect');
    else setMode(doc ? 'document' : 'photo');
  };

  const fileName = ready?.fileName ?? doc?.fileName ?? '';

  const inspectPanel = ready ? (
    <div className="flex flex-col gap-6">
      <header className="hidden px-1 lg:block">
        <h2 className="text-xl font-semibold tracking-[-0.015em]">
          {checking ? 'Checking your photo…' : flagged ? `${flagged} thing${flagged === 1 ? '' : 's'} worth a closer look` : 'What we found'}
        </h2>
        <p className="mt-1 text-sm text-muted text-pretty">
          Each result says how it was checked and what it can’t tell you. Veil never gives a single verdict.
        </p>
      </header>
      <div data-testid="evidence-rail" className="flex flex-col gap-1" aria-label="Evidence">
        {items.map((item) => (
          <EvidenceRow key={item.id} item={item} open={selectedCheck === item.id} onToggle={() => toggleRow(item.id)} />
        ))}
      </div>
      <section className="card p-2" aria-labelledby="deeper-h">
        <div className="px-3 pb-1 pt-3">
          <h3 id="deeper-h" className="font-semibold">Look closer yourself</h3>
          <p className="mt-0.5 text-sm text-muted">These checks need you to mark something on the photo.</p>
        </div>
        <div className="divide-y divide-line px-3">
          <FaceWarpCard
            state={warp.state}
            marking={faceMarking}
            onMark={startFaceMarking}
            onStopMarking={() => setFaceMarking(false)}
            onRetry={() => (faceBox ? void warp.run(faceBox) : startFaceMarking())}
            onCancel={warp.cancel}
            showOverlay={showWarp}
            onToggleOverlay={() => setShowWarp((v) => !v)}
          />
          <ShadowCard a={shadow} />
        </div>
      </section>
      <details className="group card px-4 py-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold">
          Full details of each check
          <CaretDown size={18} className="text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="divide-y divide-line pb-2">
          <ProvenanceCard state={provenance} />
          {modelCard}
        </div>
      </details>
      <div className="flex flex-wrap gap-2 px-1">
        <button type="button" onClick={() => setShowReport(true)} className="btn btn-primary">
          <FileText size={18} weight="bold" aria-hidden />
          Create report
        </button>
        <button type="button" onClick={startOver} className="btn btn-tonal">
          <ArrowCounterClockwise size={18} aria-hidden />
          Check another photo
        </button>
      </div>
    </div>
  ) : null;

  const documentPanel = doc ? (
    <div className="flex flex-col gap-4">
      <header className="px-1">
        <h2 className="truncate text-xl font-semibold tracking-[-0.015em]" title={doc.fileName}>{doc.fileName}</h2>
        <p className="mt-1 truncate font-mono text-xs text-faint" title={doc.sha256}>SHA-256 {doc.sha256}</p>
      </header>
      <div className="card px-4">
        <div data-check="provenance"><ProvenanceCard state={provenance} /></div>
      </div>
      <div className="card p-4" data-check="document">
        {docAnalysis.status === 'done' ? (
          <DocumentPanel fileName={doc.fileName} sha256={doc.sha256} byteLength={doc.bytes.length} analysis={docAnalysis.analysis} assetId={doc.sha256} />
        ) : docAnalysis.status === 'failed' ? (
          <p className="text-sm text-danger" role="alert">{docAnalysis.message}</p>
        ) : (
          <p className="text-sm text-muted" role="status">Reading the document structure…</p>
        )}
      </div>
      <div className="px-1"><OpenAnotherButton onFile={onFile} /></div>
    </div>
  ) : null;

  const cleanPanel = (
    <div data-testid="clean-panel" className="flex flex-col gap-4">
      {ready ? (
        <>
          <PhotoSummary session={ready} />
          <div className="card p-4">
            <CleanFlow
              state={cs}
              fileName={ready.fileName}
              method={fillMethod}
              onMethod={setFillMethod}
              onScan={() => void clean.scan()}
              onCancel={clean.cancel}
              onToggle={clean.toggle}
              onAll={clean.setAll}
              onClean={() => {
                setShowAfter(true);
                void clean.clean(fillMethod);
              }}
              onBack={clean.backToReview}
              showAfter={showAfter}
              onShowAfter={setShowAfter}
            />
          </div>
        </>
      ) : (
        <div className="card p-5">
          <h2 className="text-lg font-semibold">Clean works on photos</h2>
          <p className="mt-1 text-sm text-muted">Open a JPEG or PNG to find and remove private text before you share it.</p>
          <div className="mt-4"><OpenAnotherButton onFile={onFile} /></div>
        </div>
      )}
    </div>
  );

  const protectPanel = ready ? (
    <ProtectPanel
      state={ps}
      fileName={ready.fileName}
      onProtect={() => {
        setShowProtected(true);
        void protectHook.protect();
      }}
      onReset={protectHook.reset}
      showAfter={showProtected}
      onShowAfter={setShowProtected}
    />
  ) : (
    <div data-testid="protect-panel" className="card p-5">
      <h2 className="text-lg font-semibold">Protect works on photos</h2>
      <p className="mt-1 text-sm text-muted">Open a JPEG or PNG to protect it from AI edits.</p>
    </div>
  );

  const panel =
    tab === 'clean' ? cleanPanel : tab === 'protect' ? protectPanel : doc ? documentPanel : inspectPanel;
  const sheetTitle = tab === 'clean' ? 'Clean' : tab === 'protect' ? 'Protect' : doc ? 'Document' : 'Evidence';
  const sheetSubtitle = tab === 'inspect' && ready ? (checking ? 'Checking…' : `${items.length} checks`) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full flex-col">
        <header
          className="relative z-20 flex h-14 shrink-0 items-center gap-2 px-2 lg:h-16 lg:px-4"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <button type="button" onClick={startOver} aria-label="Close and open another file" className="icon-btn lg:hidden">
            <X size={22} aria-hidden />
          </button>
          <div className="hidden items-center gap-2.5 pr-4 lg:flex lg:w-[88px] lg:justify-center lg:pr-0">
            <img src="/brand/veil-64.png" alt="" width={32} height={32} className="size-8" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="hidden text-xs font-medium text-faint lg:block">Veil</p>
            <h1 className="truncate text-base font-semibold leading-tight lg:text-[15px]" title={fileName}>{fileName || 'Veil'}</h1>
          </div>
          <p
            className="hidden items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-sm font-medium text-muted sm:inline-flex"
            title="Photos are processed on this device and never uploaded."
          >
            <LockSimple size={15} weight="bold" aria-hidden />
            On this device
          </p>
          {ready && (
            <button type="button" data-testid="open-report" onClick={() => setShowReport(true)} aria-label="Create report" className="icon-btn sm:h-12 sm:w-auto sm:gap-2 sm:rounded-control sm:bg-raised sm:px-4 sm:font-semibold sm:text-ink">
              <FileText size={20} aria-hidden />
              <span className="hidden sm:inline">Report</span>
            </button>
          )}
          <div className="hidden lg:block">
            <OpenAnotherButton onFile={onFile} />
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <nav data-testid="tools-rail" aria-label="Tools" className="hidden w-[88px] shrink-0 flex-col items-center gap-2.5 pt-2 lg:flex">
            {NAV.map((n) => (
              <NavItem key={n.id} item={n} active={tab === n.id} onClick={() => goTab(n.id)} vertical />
            ))}
          </nav>

          <main data-testid="workspace" id="workspace-panel" className="relative flex min-h-0 min-w-0 flex-1 lg:gap-3 lg:pb-3 lg:pr-3">
            <section data-testid="canvas-well" aria-label="Photo" className="lightbox relative min-h-0 min-w-0 flex-1 overflow-hidden lg:rounded-panel">
              <PhotoStage
                session={session}
                sheetInset={!isDesktop}
                overlay={tab === 'inspect' ? overlay : null}
                marks={tab === 'inspect' ? shadow.drawing : null}
                boxes={boxes}
                displayBitmap={displayBitmap}
                onImagePoint={onImagePoint}
                onImageRect={onImageRect}
                focusBox={tab === 'inspect' && faceBox && !(warpHeat && showWarp) ? faceBox : null}
                heatImage={tab === 'inspect' && warpHeat && showWarp ? warpHeat : null}
                layer={(photo) =>
                  tab === 'inspect' && ready && !faceMarking && !shadow.marking ? (
                    <OverlayLayer items={items} photo={photo} selected={selectedCheck} onSelect={(id) => setSelectedCheck(id)} />
                  ) : null
                }
              />
              {tab === 'inspect' && ready && (aiMapEmpty || warpMapEmpty) && (
                <div role="status" className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
                  <p className="max-w-md rounded-full bg-panel/95 px-4 py-2 text-center text-sm text-muted shadow-[var(--shadow-card)]">
                    {aiMapEmpty ? 'AI signal map: no area raised the signal, so nothing is coloured.' : 'Face warp map: no notable warp in the marked face.'}
                  </p>
                </div>
              )}
              {!isDesktop && (
                <EvidenceSheet bottomInset={84} accent={NAV.find((n) => n.id === tab)?.color} title={sheetTitle} subtitle={sheetSubtitle} resetKey={`${tab}:${ready?.asset.id ?? doc?.sha256 ?? ''}`}>
                  {panel}
                </EvidenceSheet>
              )}
            </section>
            {isDesktop && (
              <aside aria-label={sheetTitle} className="w-[400px] shrink-0 overflow-y-auto overscroll-contain pb-6 pr-1 pt-1">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } }}>
                  {panel}
                </motion.div>
              </aside>
            )}
          </main>
        </div>

        <nav
          aria-label="Tools"
          className="glass-dock absolute inset-x-3 z-40 flex gap-1.5 rounded-[24px] p-1.5 lg:hidden"
          style={{ bottom: 'max(10px, env(safe-area-inset-bottom))' }}
        >
          {NAV.map((n) => (
            <NavItem key={n.id} item={n} active={tab === n.id} onClick={() => goTab(n.id)} />
          ))}
        </nav>

        {showReport && report && <ReportSheet report={report} pending={pendingTitles} onClose={() => setShowReport(false)} />}
      </div>
    </MotionConfig>
  );
}

const NAV: Array<{ id: TabId; label: string; icon: ComponentType<IconProps>; color: string }> = [
  { id: 'inspect', label: 'Inspect', icon: MagnifyingGlass, color: '#2b44d6' },
  { id: 'clean', label: 'Clean', icon: Broom, color: '#0b8a77' },
  { id: 'protect', label: 'Protect', icon: ShieldCheck, color: '#7a3fe0' },
];

/** A real, pressable glass button per destination; the active one fills with its tool colour. */
function NavItem({ item, active, onClick, vertical }: { item: (typeof NAV)[number]; active: boolean; onClick: () => void; vertical?: boolean }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`glass-btn flex flex-col items-center justify-center gap-0.5 rounded-[18px] font-semibold transition-[transform,background-color,box-shadow,color] duration-200 active:scale-[0.95] ${
        vertical ? 'size-[68px] text-[11px]' : 'h-[58px] flex-1 text-xs'
      } ${active ? 'is-active text-white' : 'text-ink'}`}
      style={active ? ({ '--tool': item.color } as React.CSSProperties) : undefined}
    >
      <Icon size={24} weight={active ? 'fill' : 'duotone'} aria-hidden style={active ? undefined : { color: item.color }} />
      {item.label}
    </button>
  );
}

function useMediaQuery(query: string) {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function PhotoStage({
  session,
  sheetInset,
  overlay,
  marks,
  boxes,
  displayBitmap,
  onImagePoint,
  onImageRect,
  focusBox,
  heatImage,
  layer,
}: {
  session: ImageSessionState;
  sheetInset: boolean;
  overlay: HeatOverlay | null;
  marks: MarkOverlay | null;
  boxes: ComponentProps<typeof ImageCanvas>['boxes'];
  onImageRect: ComponentProps<typeof ImageCanvas>['onImageRect'];
  focusBox: ComponentProps<typeof ImageCanvas>['focusBox'];
  heatImage: ComponentProps<typeof ImageCanvas>['heatImage'];
  displayBitmap: ImageBitmap | null;
  onImagePoint: ((p: { x: number; y: number }) => void) | null;
  layer: (photo: Rect | null) => ReactNode;
}) {
  const [photoRect, setPhotoRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (session.status !== 'ready') setPhotoRect(null);
  }, [session.status]);

  return (
    <div className="absolute inset-x-0 top-0" style={{ bottom: sheetInset ? 168 + 84 : 0 }}>
      {session.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center" role="status">
          <span className="skeleton px-4 text-center text-sm text-white/75">Opening {session.fileName}</span>
        </div>
      )}
      {session.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div role="alert" className="card flex max-w-md flex-col items-center p-8 text-center">
            <WarningOctagon size={40} className="text-danger" aria-hidden />
            <h2 className="mt-4 text-xl font-semibold text-balance">
              Couldn’t open <span className="break-all">{session.fileName}</span>
            </h2>
            <p className="mt-2 text-muted text-pretty">{session.reason}</p>
            <div className="mt-6">
              <ChoosePhotoButton onFile={onFile} label="Choose another file" />
            </div>
          </div>
        </div>
      )}
      {session.status === 'document' && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="card flex max-w-sm flex-col items-center px-8 py-10 text-center">
            <FilePdf size={48} className="text-muted" aria-hidden />
            <p className="mt-4 break-all text-lg font-semibold">{session.fileName}</p>
            <p className="tabular mt-1 text-sm text-muted">PDF, {Math.round(session.bytes.length / 1024).toLocaleString()} KiB</p>
          </div>
        </div>
      )}
      {session.status === 'ready' && (
        <div key={session.asset.id} className="absolute inset-0">
          <ImageCanvas
            bitmap={displayBitmap ?? session.bitmap}
            label={`Photo: ${session.fileName}`}
            onFit={setPhotoRect}
            overlay={overlay}
            marks={marks}
            boxes={boxes}
            onImagePoint={onImagePoint}
            onImageRect={onImageRect}
            focusBox={focusBox}
            heatImage={heatImage}
          />
          {layer(photoRect)}
        </div>
      )}
    </div>
  );
}

function CopyHash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="icon-btn shrink-0"
      aria-label={copied ? 'Hash copied' : 'Copy SHA-256 hash'}
    >
      {copied ? <Check size={18} weight="bold" className="text-fit" aria-hidden /> : <Copy size={18} aria-hidden />}
    </button>
  );
}

function PhotoSummary({ session }: { session: Ready }) {
  const { asset } = session;
  const sizeKiB = Math.round(asset.byteLength / 1024).toLocaleString();
  return (
    <section aria-label="Open photo" className="card p-4">
      <p className="font-semibold">{session.fileName}</p>
      <p className="tabular mt-0.5 text-sm text-muted">
        {asset.width} × {asset.height} px · {sizeKiB} KiB · {asset.mimeType === 'image/png' ? 'PNG' : 'JPEG'}
      </p>
      <div className="mt-3 flex items-center gap-1 rounded-control bg-raised py-1 pl-3 pr-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">SHA-256 of the original</p>
          <p className="truncate font-mono text-xs" title={asset.sha256}>{asset.sha256}</p>
        </div>
        <CopyHash value={asset.sha256} />
      </div>
    </section>
  );
}
