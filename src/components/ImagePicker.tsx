import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { UploadSimple } from '@phosphor-icons/react';
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS } from '../lib/runtime/imageIntake';

const LIMITS = `JPEG or PNG, up to ${MAX_INPUT_BYTES / (1024 * 1024)} MiB and ${MAX_INPUT_PIXELS / 1e6} megapixels.`;

function useFilePicker(onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input: ReactNode = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png"
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

export const primaryButton =
  'lift inline-flex h-12 items-center gap-2.5 rounded-full bg-gold px-7 text-[15px] font-semibold text-gold-ink transition-[filter,transform,box-shadow] duration-200 hover:brightness-105 active:scale-[0.97]';

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
export function ChoosePhotoButton({ onFile, label = 'Choose photo' }: { onFile: (file: File) => void; label?: string }) {
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
      className="absolute inset-0 flex items-center justify-center px-6 py-10"
    >
      <motion.div
        className="flex max-w-md flex-col items-center text-center"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
      >
        <motion.h1
          variants={rise}
          className="text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-balance sm:text-5xl"
        >
          {dragging ? 'Drop to open' : 'Open a photo'}
        </motion.h1>
        <motion.p variants={rise} className="mt-4 max-w-sm text-base text-muted text-pretty sm:text-lg">
          See what can be observed about it, then choose what to remove before you share it.
        </motion.p>
        <motion.div variants={rise} className="mt-8">
          <button type="button" onClick={open} className={primaryButton}>
            <UploadSimple size={18} weight="bold" aria-hidden />
            Choose photo
          </button>
        </motion.div>
        <motion.p variants={rise} className="mt-5 text-sm text-faint">
          {LIMITS} <span className="hidden sm:inline">Or drop it anywhere here.</span>
        </motion.p>
      </motion.div>
      {input}
    </div>
  );
}
