import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType } from 'react';
import { MotionConfig, motion } from 'motion/react';
import {
  Broom,
  Check,
  Copy,
  LockSimple,
  TextAa,
  Export,
  FilePdf,
  WarningOctagon,
  X,
  type IconProps,
} from '@phosphor-icons/react';
import { ImageCanvas } from '../components/canvas/ImageCanvas';
import { Viewfinder, type Rect } from '../components/canvas/Viewfinder';
import { ChoosePhotoButton, DropStage, OpenAnotherButton } from '../components/ImagePicker';
import { rowReveal } from '../components/ResultCard';
import { closeImage, openImageFile, useImageSession, type ImageSessionState } from '../lib/runtime/imageSession';
import { ModelFocusCard } from '../features/inspect/model/ModelFocusCard';
import { useModelFocus } from '../features/inspect/model/useModelFocus';
import type { HeatOverlay, MarkOverlay } from '../components/canvas/ImageCanvas';
import { ShadowCard } from '../features/inspect/physics/shadow/ShadowCard';
import { useShadowAnnotation } from '../features/inspect/physics/shadow/useShadowAnnotation';
import { CleanFlow } from './clean/CleanPanel';
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
import { StepBar } from '../components/StepBar';
import { ResultsPanel } from './results/ResultsPanel';
import { aiSignalFinding, provenanceFinding, warpFinding, type Finding } from './results/findings';
import { ReportView } from '../components/report/ReportView';
import { buildReport } from '../features/report/report';
import type { CheckResult } from '../contracts';

type TabId = 'inspect' | 'clean' | 'protect';
type Ready = Extract<ImageSessionState, { status: 'ready' }>;


const EASE = [0.16, 1, 0.3, 1] as const;
const onFile = (file: File) => void openImageFile(file);

type Mode = 'photo' | 'document' | 'clean';

export function AppWorkspace() {
  const [mode, setMode] = useState<Mode>('photo');
  const [showReport, setShowReport] = useState(false);
  const tab: TabId = mode === 'clean' ? 'clean' : 'inspect';
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
  const displayBitmap = tab === 'clean' && cs.status === 'done' && showAfter ? cs.preview : null;
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
    if (session.status === 'document' && mode !== 'document') setMode('document');
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
  const hasFile = session.status === 'ready' || session.status === 'document';
  const step: 1 | 2 | 3 | 4 = !hasFile ? 1 : showReport ? 4 : mode === 'photo' && checking ? 2 : 3;
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-night/85 px-4 backdrop-blur-xl lg:grid lg:h-16 lg:grid-cols-[1fr_auto_1fr] lg:px-5">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="text-lg font-semibold tracking-[-0.02em]">Veil</span>
          </div>
          <StepBar step={step} />
          <p
            className="flex items-center gap-1.5 justify-self-end text-sm text-muted"
            title="Photos are processed on this device and not uploaded."
          >
            <LockSimple size={16} weight="bold" className="text-gold" aria-hidden />
            <span className="hidden sm:inline">On this device</span>
          </p>
        </header>

        {session.status === 'empty' ? (
          <main id="workspace-panel" className="relative min-h-0 flex-1 overflow-hidden lightbox">
            <DropStage onFile={onFile} onDragChange={() => undefined} />
            <p className="absolute inset-x-0 bottom-10 text-center text-sm text-muted">
              Check a photo <span aria-hidden>·</span> Check a PDF <span aria-hidden>·</span> Remove private details
            </p>
          </main>
        ) : showReport && report ? (
          <main id="workspace-panel" className="min-h-0 flex-1 overflow-y-auto bg-panel">
            <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-8">
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-gold"
              >
                ← Back to results
              </button>
              <div data-testid="report-sheet" className="rounded-2xl border border-line bg-night p-6 shadow-sm sm:p-10">
                <ReportView report={report} />
              </div>
            </div>
          </main>
        ) : (
        <main data-testid="workspace"
          id="workspace-panel"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[232px_minmax(0,1fr)_360px] lg:gap-2 lg:p-2 lg:overflow-hidden"
        >
          <aside data-testid="tools-rail" aria-label="Tools" className="hidden rounded-panel border border-line bg-panel p-3 lg:block">
            <p className="px-2 py-2 text-xs font-medium text-muted">Inspect</p>
            {['Content Credentials', 'Model focus', 'Face warps', 'Shadows', 'Eyes', 'Spectrum', 'Compare with original'].map((label) => <button key={label} type="button" onClick={() => setMode('photo')} className={mode === 'photo' ? 'flex h-10 w-full items-center rounded-control bg-raised px-3 text-left text-sm font-medium' : 'flex h-10 w-full items-center rounded-control px-3 text-left text-sm hover:bg-raised'}>{label}</button>)}
            <p className="mt-4 px-2 py-2 text-xs font-medium text-muted">Clean</p>
            <button type="button" onClick={() => setMode('clean')} className={mode === 'clean' ? 'flex h-10 w-full items-center rounded-control bg-raised px-3 text-left text-sm font-medium' : 'flex h-10 w-full items-center rounded-control px-3 text-left text-sm hover:bg-raised'}>Find private text</button>
            <button type="button" onClick={() => setMode('clean')} className="flex h-10 w-full items-center rounded-control px-3 text-left text-sm hover:bg-raised">Manual mask</button>
            <p className="mt-4 px-2 py-2 text-xs font-medium text-muted">Protect</p>
            <button type="button" onClick={() => setMode('photo')} className="flex h-10 w-full items-center rounded-control px-3 text-left text-sm hover:bg-raised">Experimental</button>
          </aside>
          <section data-testid="canvas-well" aria-label="Photo" className="lightbox relative h-[56dvh] shrink-0 lg:h-auto">
            <PhotoStage
              session={session}
              overlay={tab === 'inspect' ? overlay : null}
              marks={tab === 'inspect' ? shadow.drawing : null}
              boxes={boxes}
              displayBitmap={displayBitmap}
              onImagePoint={onImagePoint}
              onImageRect={onImageRect}
              focusBox={tab === 'inspect' && faceBox && !(warpHeat && showWarp) ? faceBox : null}
              heatImage={tab === 'inspect' && warpHeat && showWarp ? warpHeat : null}
            />
            {['provenance', 'ai-signal', 'face-warp', 'shadows'].map((id, index) => (
              <button key={id} type="button" data-testid="overlay" data-check-id={id} data-selected={selectedCheck === id ? 'true' : 'false'} onClick={() => setSelectedCheck(id)} aria-label={`Select ${id} overlay`} className={selectedCheck === id ? 'absolute border-2 border-[#1d5fbf] bg-transparent' : 'absolute border border-transparent bg-transparent'} style={{ left: `${20 + index * 14}%`, top: `${25 + index * 10}%`, width: '24%', height: '22%' }} />
            ))}
            {tab === 'inspect' && ready && (aiMapEmpty || warpMapEmpty) && (
              <div
                role="status"
                className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4"
              >
                <p className="max-w-md rounded-full border border-line bg-night/95 px-4 py-2 text-center text-sm text-muted shadow-sm backdrop-blur">
                  {aiMapEmpty
                    ? 'AI heatmap: no area raised the AI signal, so nothing is coloured. Check Content Credentials above.'
                    : 'Face warp map: no notable warp in the marked face, so nothing is coloured.'}
                </p>
              </div>
            )}
          </section>
          <aside data-testid="evidence-rail"
            aria-label="Evidence"
            className="panel-light bg-panel px-5 pb-28 pt-6 lg:overflow-y-auto lg:border-l lg:border-line lg:px-7 lg:pb-8"
          >
            <div data-testid="evidence-sheet" className="block h-40 w-full rounded-t-panel border border-line bg-panel p-3 lg:hidden" aria-label="Evidence sheet">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-control" />
              <button data-testid="evidence-row" data-check-id="provenance" aria-expanded={selectedCheck === 'provenance'} onClick={() => setSelectedCheck(selectedCheck === 'provenance' ? null : 'provenance')} className="w-full text-left text-sm font-medium">Content Credentials</button>
            </div>
            {/* New content appears at once and settles in; nothing waits on an exit. */}
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } }}
            >
              {tab === 'inspect' && doc && (
                <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
                  <div className="flex items-center justify-between gap-3 border-b border-line pb-5">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold tracking-[-0.025em]" title={doc.fileName}>{doc.fileName}</h2>
                      <p className="mt-1 truncate font-mono text-[13px] text-faint" title={doc.sha256}>SHA-256 {doc.sha256}</p>
                    </div>
                    <button
                      type="button"
                      onClick={closeImage}
                      aria-label="Close document"
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-2 divide-y divide-line">
                    <div data-check="provenance">
                      <ProvenanceCard state={provenance} />
                    </div>
                    <div data-check="document" className="py-4">
                      {docAnalysis.status === 'done' ? (
                        <DocumentPanel
                          fileName={doc.fileName}
                          sha256={doc.sha256}
                          byteLength={doc.bytes.length}
                          analysis={docAnalysis.analysis}
                          assetId={doc.sha256}
                        />
                      ) : docAnalysis.status === 'failed' ? (
                        <p className="text-sm text-danger" role="alert">{docAnalysis.message}</p>
                      ) : (
                        <p className="text-sm text-faint" role="status">Reading the document structure…</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-6">
                    <OpenAnotherButton onFile={onFile} />
                  </div>
                </motion.div>
              )}
              {tab === 'inspect' && !doc && ready && (
                <ResultsPanel
                  fileName={ready.fileName}
                  findings={findings}
                  checking={checking}
                  layers={{
                    ai: { visible: showOverlay, available: focus.state.status === 'done', toggle: () => setShowOverlay((v) => !v) },
                    face: { visible: showWarp, available: warp.state.status === 'done', toggle: () => setShowWarp((v) => !v) },
                  }}
                  deeper={
                    <>
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
                    </>
                  }
                  details={
                    <>
                      <ProvenanceCard state={provenance} />
                      {modelCard}
                    </>
                  }
                  onReport={() => setShowReport(true)}
                  onNew={startOver}
                  selected={selectedCheck}
                  onSelect={setSelectedCheck}
                />
              )}
              {tab === 'clean' &&
                (ready ? (
                  <motion.div data-testid="clean-panel" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
                    <PhotoSummary session={ready} />
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
                  </motion.div>
                ) : (
                  <CleanPanel session={session} />
                ))}
              
            </motion.div>
          </aside>
        </main>
        )}


      </div>
    </MotionConfig>
  );
}

/** Measures an element's size so the viewfinder can frame it. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function insetRect(size: { w: number; h: number }, pad: number): Rect {
  return { x: pad, y: pad, w: size.w - pad * 2, h: size.h - pad * 2 };
}

function PhotoStage({
  session,
  overlay,
  marks,
  boxes,
  displayBitmap,
  onImagePoint,
  onImageRect,
  focusBox,
  heatImage,
}: {
  session: ImageSessionState;
  overlay: HeatOverlay | null;
  marks: MarkOverlay | null;
  boxes: ComponentProps<typeof ImageCanvas>['boxes'];
  onImageRect: ComponentProps<typeof ImageCanvas>['onImageRect'];
  focusBox: ComponentProps<typeof ImageCanvas>['focusBox'];
  heatImage: ComponentProps<typeof ImageCanvas>['heatImage'];
  displayBitmap: ImageBitmap | null;
  onImagePoint: ((p: { x: number; y: number }) => void) | null;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [dragging, setDragging] = useState(false);
  const [photoRect, setPhotoRect] = useState<Rect | null>(null);
  const compact = size.w < 640;

  useEffect(() => {
    if (session.status !== 'ready') setPhotoRect(null);
    if (session.status !== 'empty') setDragging(false);
  }, [session.status]);

  let frame: Rect | null = null;
  let tone: 'gold' | 'muted' | 'danger' = 'muted';
  let gap = 0;
  if (session.status === 'empty') {
    frame = insetRect(size, dragging ? (compact ? 28 : 48) : compact ? 14 : 24);
    tone = dragging ? 'gold' : 'muted';
  } else if (session.status === 'loading') {
    const w = Math.min(size.w * 0.6, 560);
    frame = { x: (size.w - w) / 2, y: (size.h - w * 0.75) / 2, w, h: w * 0.75 };
    tone = 'gold';
  } else if (session.status === 'error') {
    frame = insetRect(size, compact ? 14 : 24);
    tone = 'danger';
  } else if (session.status === 'document') {
    frame = insetRect(size, compact ? 14 : 24);
    tone = 'gold';
  } else if (photoRect) {
    frame = photoRect;
    tone = 'gold';
    gap = 10;
  }

  return (
    <div ref={ref} className="absolute inset-0">
      {session.status === 'empty' && (
          <motion.div key="empty" className="absolute inset-0">
            <DropStage onFile={onFile} onDragChange={setDragging} />
          </motion.div>
        )}
        {session.status === 'loading' && (
          <motion.div
            key="loading"
            className="absolute inset-0 flex items-center justify-center"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className="skeleton px-4 text-center text-sm text-muted">Opening {session.fileName}</span>
          </motion.div>
        )}
        {session.status === 'error' && (
          <motion.div
            key="error"
            className="absolute inset-0 flex items-center justify-center p-8"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }}
          >
            <div role="alert" className="flex max-w-md flex-col items-center text-center">
              <WarningOctagon size={40} weight="thin" className="text-danger" aria-hidden />
              <h1 className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-balance">
                Couldn’t open <span className="break-all">{session.fileName}</span>
              </h1>
              <p className="mt-2 text-muted text-pretty">{session.reason}</p>
              <div className="mt-7">
                <ChoosePhotoButton onFile={onFile} label="Choose another photo" />
              </div>
            </div>
          </motion.div>
        )}
        {session.status === 'document' && (
          <motion.div
            key={session.sha256}
            className="absolute inset-0 flex items-center justify-center p-8"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }}
          >
            <div className="flex max-w-md flex-col items-center text-center">
              <FilePdf size={56} weight="thin" className="text-gold" aria-hidden />
              <h1 className="mt-4 break-all text-2xl font-semibold tracking-[-0.025em]">{session.fileName}</h1>
              <p className="tabular mt-1 text-muted">PDF document, {Math.round(session.bytes.length / 1024).toLocaleString()} KiB</p>
              <p className="mt-4 text-sm text-faint text-pretty">
                Veil reads this document's structure, save history and Content Credentials on this device. The results are on the right.
              </p>
            </div>
          </motion.div>
        )}
        {session.status === 'ready' && (
          <motion.div key={session.asset.id} className="absolute inset-0">
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
          </motion.div>
        )}
      <Viewfinder rect={frame} tone={tone} gap={gap} breathing={session.status === 'empty' && !dragging} />
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
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-[color,background-color,transform] duration-200 hover:bg-night/60 hover:text-gold active:scale-90"
      aria-label={copied ? 'Hash copied' : 'Copy SHA-256 hash'}
    >
      <motion.span
        key={copied ? 'done' : 'copy'}
        initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 0.18 }}
        className={copied ? 'text-gold' : ''}
      >
        {copied ? <Check size={18} weight="bold" aria-hidden /> : <Copy size={18} aria-hidden />}
      </motion.span>
    </button>
  );
}

function PhotoSummary({ session }: { session: Ready }) {
  const { asset } = session;
  const sizeKiB = Math.round(asset.byteLength / 1024).toLocaleString();
  return (
    <motion.section variants={rowReveal} aria-label="Open photo" className="border-b border-line pb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-[-0.025em]" title={session.fileName}>
            {session.fileName}
          </h2>
          <p className="tabular mt-1 text-sm text-muted">
            {asset.width} × {asset.height} px, {sizeKiB} KiB, {asset.mimeType === 'image/png' ? 'PNG' : 'JPEG'}
          </p>
        </div>
        <button
          type="button"
          onClick={closeImage}
          aria-label="Close photo"
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-[color,background-color,transform] duration-200 hover:bg-raised hover:text-ink active:scale-90"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="mt-4 flex items-center gap-1 rounded-2xl border border-line bg-raised py-1.5 pl-4 pr-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">SHA-256 of the original file</p>
          <p className="truncate font-mono text-[13px] text-ink/90" title={asset.sha256}>
            {asset.sha256}
          </p>
        </div>
        <CopyHash value={asset.sha256} />
      </div>
      <div className="mt-4">
        <OpenAnotherButton onFile={onFile} />
      </div>
    </motion.section>
  );
}

interface Feature {
  icon: ComponentType<IconProps>;
  title: string;
  body: string;
}

/** What a tab will do, shown before a photo is open. */
function TabIntro({ title, body, features }: { title: string; body: string; features: Feature[] }) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
      <motion.h2 variants={rowReveal} className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">
        {title}
      </motion.h2>
      <motion.p variants={rowReveal} className="mt-2 text-muted text-pretty">
        {body}
      </motion.p>
      <ul className="mt-7 space-y-5">
        {features.map(({ icon: Icon, title: t, body: b }) => (
          <motion.li key={t} variants={rowReveal} className="flex gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-gold">
              <Icon size={19} aria-hidden />
            </span>
            <div>
              <p className="font-medium">{t}</p>
              <p className="mt-0.5 text-sm text-muted text-pretty">{b}</p>
            </div>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}


const CLEAN_FEATURES: Feature[] = [
  { icon: TextAa, title: 'Find private text', body: 'Addresses, plates, emails and phone numbers, found at full resolution.' },
  { icon: Broom, title: 'You choose what goes', body: 'Nothing is removed until you select it. Undo is always there.' },
  { icon: Export, title: 'Fresh export', body: 'New pixels in a new file, with no location or camera metadata copied.' },
];


function NotBuilt() {
  return (
    <motion.p variants={rowReveal} className="mt-7 rounded-2xl border border-line bg-raised p-4 text-sm text-muted">
      Not built yet in this version.
    </motion.p>
  );
}

function CleanPanel({ session }: { session: ImageSessionState }) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
      {session.status === 'ready' && <PhotoSummary session={session} />}
      <div className={session.status === 'ready' ? 'mt-7' : ''}>
        <TabIntro
          title="Clean"
          body="Remove the details you don't want to share, then export a fresh file."
          features={CLEAN_FEATURES}
        />
        <NotBuilt />
      </div>
    </motion.div>
  );
}

