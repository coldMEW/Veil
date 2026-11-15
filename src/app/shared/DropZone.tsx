import { useRef, useState, type ReactNode } from 'react';

export function DropZone({
  title,
  line,
  busy,
  error,
  onFile,
  cta = 'Choose a picture',
  art,
  accept = 'image/jpeg,image/png',
  children,
}: {
  art?: ReactNode;
  title: string;
  line: string;
  busy?: boolean;
  error?: string | null;
  onFile: (file: File) => void;
  cta?: string;
  /** File types the picker offers. */
  accept?: string;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className="dropzone"
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      {art && <div className="empty-art">{art}</div>}
      <h1>{title}</h1>
      <p className="dropzone-line">{line}</p>
      <button className="btn btn-lime" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Opening…' : cta}
      </button>
      {error && (
        <p className="dropzone-error" role="alert">
          {error}
        </p>
      )}
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
