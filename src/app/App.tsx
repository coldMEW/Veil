import { lazy, Suspense } from 'react';
import { DropStage } from '../components/ImagePicker';
import { openImageFile, useImageSession } from '../lib/runtime/imageSession';
import { MotionEntrance } from '../components/MotionEntrance';

const Workspace = lazy(() => import('./AppWorkspace').then(({ AppWorkspace }) => ({ default: AppWorkspace })));

/** Keep the empty workspace lean: feature and runtime modules load only after a file opens. */
export function App() {
  const session = useImageSession();
  if (session.status !== 'empty') {
    return <Suspense fallback={<main className="lightbox h-full" aria-label="Opening workspace" />}><Workspace /></Suspense>;
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between bg-night px-4"><span className="text-base font-semibold">Veil</span><span className="text-sm text-muted">On this device</span></header>
      <main className="relative min-h-0 flex-1 overflow-hidden lightbox m-2 rounded-panel"><MotionEntrance>
        <DropStage onFile={(file) => void openImageFile(file)} onDragChange={() => undefined} />
        <p data-enter className="absolute inset-x-0 bottom-10 text-center text-sm text-muted">Check a photo <span aria-hidden>·</span> Check a PDF <span aria-hidden>·</span> Remove private details</p>
      </MotionEntrance></main>
    </div>
  );
}
