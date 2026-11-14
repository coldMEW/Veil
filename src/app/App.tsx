import { lazy, Suspense, useState } from 'react';
import { DropStage } from '../components/ImagePicker';
import { openImageFile, useImageSession } from '../lib/runtime/imageSession';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { MotionEntrance } from '../components/MotionEntrance';
const Workspace = lazy(() =>
  import('./AppWorkspace').then(({ AppWorkspace }) => ({ default: AppWorkspace })),
);
export function App() {
  const session = useImageSession();
  const [mode, setMode] = useState<'photo' | 'clean'>('photo');
  if (session.status !== 'empty')
    return (
      <Suspense fallback={<main className="lightbox h-full" aria-label="Opening workspace" />}>
        <Workspace initialMode={mode} />
      </Suspense>
    );
  return (
    <div className="app-shell">
      <WorkspaceHeader />
      <main className="empty-workspace lightbox">
        <MotionEntrance>
          <DropStage onFile={(file) => void openImageFile(file)} onDragChange={() => undefined} />
          <nav className="empty-modes" aria-label="Choose a task" data-enter>
            <button aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}>
              Inspect evidence
            </button>
            <span aria-hidden>/</span>
            <button aria-pressed={mode === 'clean'} onClick={() => setMode('clean')}>
              Remove private details
            </button>
          </nav>
        </MotionEntrance>
      </main>
    </div>
  );
}
