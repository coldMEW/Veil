import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { UploadSimple } from '@phosphor-icons/react';

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

export const primaryButton = 'primary-action';

/** Secondary action used beside an open photo. */
export function OpenAnotherButton({ onFile }: { onFile: (file: File) => void }) {
  const { open, input } = useFilePicker(onFile);
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium text-ink transition-[color,border-color,transform] duration-200 hover:border-gold/60 hover:text-gold active:scale-[0.97]"
      >
        <UploadSimple size={16} aria-hidden />
        Open another
      </button>
      {input}
    </>
  );
}

/** Primary button for error states. */
export function ChoosePhotoButton({
  onFile,
  label = 'Choose photo',
}: {
  onFile: (file: File) => void;
  label?: string;
}) {
  const { open, input } = useFilePicker(onFile);
  return (
    <>
      <button type="button" onClick={open} className={primaryButton}>
        <UploadSimple size={18} weight="bold" aria-hidden />
        {label}
      </button>
      {input}
    </>
  );
}

const rise = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
} as const;

/** The empty stage: the whole area is a drop target with one clear action. */
export function DropStage({
  onFile,
  onDragChange,
}: {
  onFile: (file: File) => void;
  onDragChange: (dragging: boolean) => void;
}) {
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
      className="empty-drop-zone"
    >
      <motion.div
        className="flex max-w-md flex-col items-center text-center"
        initial={false}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
      >
        <motion.h1 variants={rise} className="empty-heading">
          {dragging ? 'Drop a photo here' : 'Open a photo.'}
        </motion.h1>
        <motion.p data-enter variants={rise} className="empty-description">
          Inspect the evidence. Remove private details. Everything stays on this device.
        </motion.p>
        <motion.div data-enter variants={rise} className="mt-8">
          <button type="button" onClick={open} className={primaryButton}>
            <UploadSimple size={18} weight="bold" aria-hidden />
            Choose file
          </button>
        </motion.div>
        <motion.p variants={rise} className="mt-5 text-sm text-faint">
          <span className="hidden sm:inline">Drop a photo or a PDF here. </span>JPEG, PNG or PDF ? up to 10
          MiB
        </motion.p>
      </motion.div>
      {input}
    </div>
  );
}
