import { Camera, DotsThree, LockSimple, ArrowLeft, FileText } from '@phosphor-icons/react';
import { isAndroid, takePhoto } from '../lib/native/platform';
import { closeImage } from '../lib/runtime/imageSession';
export function WorkspaceHeader({ fileName, onReport }: { fileName?: string; onReport?: () => void }) {
  return (
    <header className="workspace-header">
      <div className="workspace-brand">
        {fileName && (
          <button className="icon-control" aria-label="Close photo" onClick={closeImage}>
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="wordmark">
          Veil
          <span className="wordmark-dot" aria-hidden>
            .
          </span>
        </span>
        {fileName && (
          <span className="header-file" title={fileName}>
            {fileName}
          </span>
        )}
      </div>
      <div className="header-actions">
        <span className="local-state">
          <LockSimple size={13} />
          <span>On this device</span>
        </span>
        {onReport && (
          <button className="icon-control" aria-label="Create report" onClick={onReport}>
            <FileText size={18} />
          </button>
        )}
        {isAndroid() && (
          <>
            <button
              className="icon-control"
              aria-label="Take photo"
              onClick={() =>
                void takePhoto().catch((e) => {
                  if (!/cancel/i.test(String(e)))
                    window.dispatchEvent(new CustomEvent('veil-toast', { detail: String(e) }));
                })
              }
            >
              <Camera size={20} />
            </button>
            <button
              className="icon-control"
              aria-label="Offline models"
              onClick={() => window.dispatchEvent(new Event('veil-models-open'))}
            >
              <DotsThree size={22} weight="bold" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
