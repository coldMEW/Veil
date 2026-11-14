import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { HeroStage } from './HeroStage';
import { Broom, ImageSquare, MagnifyingGlass, ShieldCheck, UploadSimple } from '@phosphor-icons/react';

function useFilePicker(onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input: ReactNode = (
    <input
      data-testid="file-input"
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,application/pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onFile(file);
        event.target.value = ''; // allow reopening the same file
      }}
    />
  );
  return { open: () => inputRef.current?.click(), input };
}

export const primaryButton = 'btn btn-primary';

/** Secondary action used beside an open photo. */
export function OpenAnotherButton({ onFile }: { onFile: (file: File) => void }) {
  const { open, input } = useFilePicker(onFile);
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="btn btn-tonal"
      >
        <UploadSimple size={16} aria-hidden />
        Open another
      </button>
      {input}
    </>
  );
}

/** Primary button for error states. */
export function ChoosePhotoButton({ onFile, label = 'Choose photo' }: { onFile: (file: File) => void; label?: string }) {
  const { open, input } = useFilePicker(onFile);
  return (
    <>
      <button type="button" onClick={open} className="btn btn-primary">
        <UploadSimple size={18} weight="bold" aria-hidden />
        {label}
      </button>
      {input}
    </>
  );
}

/** The empty screen: the whole area takes a dropped file; the card says what to do. */
export function DropStage({ onFile, onDragChange }: { onFile: (file: File) => void; onDragChange: (dragging: boolean) => void }) {
  const { open, input } = useFilePicker(onFile);
  const [dragging, setDragging] = useState(false);
  const setDrag = (value: boolean) => {
    setDragging(value);
    onDragChange(value);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDrag(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragging) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      data-testid="drop-zone"
      className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-2 sm:px-6 lg:pt-6"
    >
      <div className="mx-auto grid w-full max-w-[1240px] gap-8 lg:min-h-full lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-12">
      <div className="lg:hidden" data-enter><HeroStage compact /></div>
      <div className="flex flex-col lg:justify-center lg:py-6">
        <h1 data-enter className="text-[2.25rem] font-bold leading-[1.05] tracking-[-0.03em] text-balance sm:text-[3.25rem]">
          Check a photo before you share it
        </h1>
        <p data-enter className="mt-3 max-w-[30rem] text-[1.0625rem] text-muted text-pretty">
          See what can be learned from it, remove private details like house numbers and plates, and keep a record. All on this device.
        </p>

        <div
          data-enter
          className={`mt-8 flex flex-col items-center rounded-[20px] border-2 border-dashed px-6 py-10 text-center transition-[border-color,background-color,transform] duration-200 sm:py-14 ${
            dragging ? 'scale-[1.01] border-gold bg-gold-soft' : 'border-line-strong bg-panel'
          }`}
        >
          <span className={`flex size-14 items-center justify-center rounded-full ${dragging ? 'bg-gold text-gold-ink' : 'bg-raised text-ink'}`}>
            <ImageSquare size={26} aria-hidden />
          </span>
          <p className="mt-4 text-xl font-semibold">{dragging ? 'Drop it here' : 'Drop a photo here'}</p>
          <p className="mt-1 text-sm text-muted">or choose one from this device</p>
          <button type="button" onClick={open} className="btn btn-primary mt-6 px-7">
            <UploadSimple size={18} weight="bold" aria-hidden />
            Choose photo
          </button>
          <p className="mt-5 text-xs text-faint">JPEG, PNG or PDF</p>
        </div>

        <ul data-enter className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-3">
          {WHAT.map(({ icon: Icon, title, body, color, tint }) => (
            <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: tint, color }}>
                <Icon size={22} weight="duotone" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted text-pretty">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden py-2 lg:block" data-enter><HeroStage /></div>
      </div>
      {input}
    </div>
  );
}

const WHAT = [
  { icon: MagnifyingGlass, title: 'Inspect', body: 'Evidence about how the photo was made, with the limits of each check.', color: '#2b44d6', tint: '#e7eafc' },
  { icon: Broom, title: 'Clean', body: 'Find and remove private text, then save a fresh copy.', color: '#0b8a77', tint: '#dcf5ef' },
  { icon: ShieldCheck, title: 'Protect', body: 'Make AI photo editors fail on your picture.', color: '#7a3fe0', tint: '#efe7fd' },
] as const;
