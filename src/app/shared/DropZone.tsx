import { useRef, useState, type ReactNode } from 'react';

export function DropZone({
  title,
  line,
  busy,
  error,
  onFile,
  cta = 'Choose a picture',
  children,
}: {
  title: string;
  line: string;
  busy?: boolean;
  error?: string | null;
  onFile: (file: File) => void;
  cta?: string;
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
        accept="image/jpeg,image/png"
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
