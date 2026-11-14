import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { MotionConfig, motion } from 'motion/react';
import {
  Broom,
  Check,
  Copy,
  Eye,
  Flask,
  LockSimple,
  MagnifyingGlass,
  Scan,
  ShieldWarning,
  Sun,
  TextAa,
  Export,
  ChartLineUp,
  WarningOctagon,
  X,
  type IconProps,
} from '@phosphor-icons/react';
import { ImageCanvas } from '../components/canvas/ImageCanvas';
import { Viewfinder, type Rect } from '../components/canvas/Viewfinder';
import { ChoosePhotoButton, DropStage, OpenAnotherButton } from '../components/ImagePicker';
import { ResultCard, rowReveal } from '../components/ResultCard';
import { TabBar, type TabDef } from '../components/TabBar';
import { closeImage, openImageFile, useImageSession, type ImageSessionState } from '../lib/runtime/imageSession';
import { plannedInspectChecks } from './plannedChecks';
import { ModelFocusCard } from '../features/inspect/model/ModelFocusCard';
import { useModelFocus, type FocusState } from '../features/inspect/model/useModelFocus';
import type { HeatOverlay } from '../components/canvas/ImageCanvas';

type TabId = 'inspect' | 'clean' | 'protect';
type Ready = Extract<ImageSessionState, { status: 'ready' }>;

const TABS: ReadonlyArray<TabDef<TabId>> = [
  { id: 'inspect', label: 'Inspect', icon: MagnifyingGlass },
  { id: 'clean', label: 'Clean', icon: Broom },
  { id: 'protect', label: 'Protect Lab', icon: Flask },
];

const EASE = [0.16, 1, 0.3, 1] as const;
const onFile = (file: File) => void openImageFile(file);

export function App() {
  const [tab, setTab] = useState<TabId>('inspect');
  const session = useImageSession();
  const ready = session.status === 'ready' ? session : null;
  const focus = useModelFocus(ready?.asset.id ?? null, ready?.bitmap ?? null);
  const [showOverlay, setShowOverlay] = useState(true);
  const overlay = useMemo<HeatOverlay | null>(
    () =>
      focus.state.status === 'done' && showOverlay
        ? { rect: focus.state.result.crop, grid: focus.state.result.grid, values: focus.state.magnitudes }
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-night/85 px-4 backdrop-blur-xl lg:grid lg:h-16 lg:grid-cols-[1fr_auto_1fr] lg:px-5">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="text-lg font-semibold tracking-[-0.02em]">Veil</span>
          </div>
          <TabBar tabs={TABS} active={tab} onChange={setTab} idPrefix="top" variant="pill" className="hidden lg:flex" />
          <p
            className="flex items-center gap-1.5 justify-self-end text-sm text-muted"
            title="Photos are processed on this device and not uploaded."
          >
            <LockSimple size={16} weight="bold" className="text-gold" aria-hidden />
            <span>On this device</span>
          </p>
        </header>

        <main
          id="workspace-panel"
          role="tabpanel"
          aria-labelledby={`top-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden"
        >
          <section aria-label="Photo" className="lightbox relative h-[56dvh] shrink-0 lg:h-auto">
            <PhotoStage session={session} overlay={overlay} />
          </section>
          <aside
            aria-label="Evidence"
            className="panel-light bg-panel px-5 pb-28 pt-6 lg:overflow-y-auto lg:border-l lg:border-line lg:px-7 lg:pb-8"
          >
            {/* New content appears at once and settles in; nothing waits on an exit. */}
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } }}
            >
              {tab === 'inspect' && <InspectPanel session={session} modelCard={modelCard} focus={focus.state} />}
              {tab === 'clean' && <CleanPanel session={session} />}
              {tab === 'protect' && <ProtectPanel session={session} />}
            </motion.div>
          </aside>
        </main>

        <nav
          aria-label="Workspace"
          className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-night/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
        >
          <TabBar tabs={TABS} active={tab} onChange={setTab} idPrefix="bottom" variant="dock" />
        </nav>
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

function PhotoStage({ session, overlay }: { session: ImageSessionState; overlay: HeatOverlay | null }) {
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
        {session.status === 'ready' && (
          <motion.div key={session.asset.id} className="absolute inset-0">
            <ImageCanvas bitmap={session.bitmap} label={`Photo: ${session.fileName}`} onFit={setPhotoRect} overlay={overlay} />
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

const INSPECT_FEATURES: Feature[] = [
  { icon: Sun, title: 'Shadow and light geometry', body: 'Mark objects and their shadows to test them against one light source.' },
  { icon: Eye, title: 'Eye highlights', body: 'Compare the bright reflections in both eyes side by side.' },
  { icon: Scan, title: 'Model-focus map', body: 'Where one classifier looks. Context, kept apart from physical evidence.' },
];

const CLEAN_FEATURES: Feature[] = [
  { icon: TextAa, title: 'Find private text', body: 'Addresses, plates, emails and phone numbers, found at full resolution.' },
  { icon: Broom, title: 'You choose what goes', body: 'Nothing is removed until you select it. Undo is always there.' },
  { icon: Export, title: 'Fresh export', body: 'New pixels in a new file, with no location or camera metadata copied.' },
];

const PROTECT_FEATURES: Feature[] = [
  { icon: ShieldWarning, title: 'Experimental transforms', body: 'Changes meant to make AI editing harder. Not established to work.' },
  { icon: ChartLineUp, title: 'Measured results', body: 'Every test outcome is shown, including the ones where nothing changed.' },
];

function InspectPanel({ session, modelCard, focus }: { session: ImageSessionState; modelCard: ReactNode; focus: FocusState }) {
  const assetId = session.status === 'ready' ? session.asset.id : null;
  const checks = useMemo(() => (assetId ? plannedInspectChecks(assetId) : []), [assetId]);
  if (session.status !== 'ready') {
    return (
      <TabIntro
        title="Inspect"
        body="Evidence about a photo, each with its method, assumptions and what stays unknown. Never a verdict."
        features={INSPECT_FEATURES}
      />
    );
  }
  return (
    <motion.div
      key={session.asset.id}
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
    >
      <PhotoSummary session={session} />
      <motion.h2 variants={rowReveal} className="mt-7 text-sm font-semibold text-muted">
        Checks
      </motion.h2>
      <div className="divide-y divide-line">
        {checks.map((check) =>
          check.id === 'model-focus' ? (
            <div key={check.id} data-state={focus.status}>
              {modelCard}
            </div>
          ) : (
            <ResultCard key={check.id} result={check} />
          ),
        )}
      </div>
    </motion.div>
  );
}

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

function ProtectPanel({ session }: { session: ImageSessionState }) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
      {session.status === 'ready' && <PhotoSummary session={session} />}
      <div className={session.status === 'ready' ? 'mt-7' : ''}>
        <TabIntro
          title="Protect Lab"
          body="Experimental protection against AI editing. Protection is not established."
          features={PROTECT_FEATURES}
        />
        <NotBuilt />
      </div>
    </motion.div>
  );
}
