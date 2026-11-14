// The one open image. Held in memory only: nothing here is written to storage.
// Opening a new image bumps the generation, which makes any pending load or
// run for the old image stale (AGENTS.md product rule 7).

import { useSyncExternalStore } from 'react';
import type { ImageAsset } from '../../contracts';
import { checkIntake, isPdf, MAX_INPUT_BYTES, sha256Hex } from './imageIntake';

export type ImageSessionState =
  | { status: 'empty' }
  | { status: 'loading'; fileName: string }
  | {
      status: 'ready';
      fileName: string;
      asset: ImageAsset;
      bitmap: ImageBitmap;
      /** The original file bytes, in memory only (C2PA and metadata are read from these, never stored). */
      bytes: Uint8Array;
    }
  | {
      status: 'document';
      fileName: string;
      /** PDF bytes, in memory only. Analysed for structure and Content Credentials; never stored or sent. */
      bytes: Uint8Array;
      sha256: string;
    }
  | { status: 'error'; fileName: string; reason: string };

let state: ImageSessionState = { status: 'empty' };
let generation = 0;
const listeners = new Set<() => void>();

function setState(next: ImageSessionState) {
  if (state.status === 'ready' && (next.status !== 'ready' || next.bitmap !== state.bitmap)) {
    state.bitmap.close(); // free decoded pixels of the image being replaced
  }
  state = next;
  listeners.forEach((listener) => listener());
}

/** Current generation. A run that started under an older value must discard its result. */
export function imageGeneration(): number {
  return generation;
}

export async function openImageFile(file: File): Promise<void> {
  const myGeneration = ++generation;
  const fileName = file.name || 'Untitled image';
  setState({ status: 'loading', fileName });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (myGeneration !== generation) return;

    if (isPdf(bytes)) {
      if (bytes.length > MAX_INPUT_BYTES) {
        setState({ status: 'error', fileName, reason: 'This PDF is larger than 10 MiB. Veil opens documents up to 10 MiB.' });
        return;
      }
      const sha256 = await sha256Hex(bytes);
      if (myGeneration !== generation) return;
      setState({ status: 'document', fileName, bytes, sha256 });
      return;
    }

    const intake = checkIntake(bytes);
    if (!intake.ok) {
      setState({ status: 'error', fileName, reason: intake.reason });
      return;
    }

    const sha256 = await sha256Hex(bytes);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: intake.mimeType }), {
      imageOrientation: 'from-image',
    });
    if (myGeneration !== generation) {
      bitmap.close();
      return;
    }

    const asset: ImageAsset = {
      id: sha256,
      sha256,
      mimeType: intake.mimeType,
      byteLength: bytes.length,
      encodedWidth: intake.width,
      encodedHeight: intake.height,
      width: bitmap.width,
      height: bitmap.height,
      parentId: null,
    };
    setState({ status: 'ready', fileName, asset, bitmap, bytes });
  } catch {
    if (myGeneration !== generation) return;
    setState({ status: 'error', fileName, reason: 'This browser could not decode the image. The file may be damaged.' });
  }
}

export function closeImage(): void {
  generation++;
  setState({ status: 'empty' });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useImageSession(): ImageSessionState {
  return useSyncExternalStore(subscribe, () => state);
}
