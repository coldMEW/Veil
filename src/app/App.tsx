import { lazy, Suspense } from 'react';
import { DropStage } from '../components/ImagePicker';
import { openImageFile, useImageSession } from '../lib/runtime/imageSession';
import { MotionEntrance } from '../components/MotionEntrance';
import { LockSimple } from '@phosphor-icons/react';

const Workspace = lazy(() => import('./AppWorkspace').then(({ AppWorkspace }) => ({ default: AppWorkspace })));

/** Keep the empty workspace lean: feature and runtime modules load only after a file opens. */
export function App() {
  const session = useImageSession();
  if (session.status !== 'empty') {
    return <Suspense fallback={<main className="h-full bg-night" aria-label="Opening workspace" />}><Workspace /></Suspense>;
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:h-16 sm:px-6" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <span className="flex items-center gap-2.5">
          <img src="/brand/veil-64.png" alt="" width={32} height={32} className="size-8" />
          <span className="text-lg font-bold tracking-[-0.02em]">Veil</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-sm font-medium text-muted">
          <LockSimple size={15} weight="bold" aria-hidden />
          Nothing leaves this device
        </span>
      </header>
      <main className="relative min-h-0 flex-1">
        <MotionEntrance>
          <DropStage onFile={(file) => void openImageFile(file)} onDragChange={() => undefined} />
        </MotionEntrance>
      </main>
    </div>
  );
}
