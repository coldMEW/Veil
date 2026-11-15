/// <reference lib="webworker" />
// Runs the removal off the main thread: the fill model, the repair passes, writing the fresh PNG and
// checking it. On a phone the fill model alone takes seconds; done on the page's own thread it froze
// the screen for that long. The page only builds the mask and shows progress.
import { MiganInpainter } from './inpaint';
import { runClean } from './session';

export type CleanRequest =
  | { id: number; kind: 'load'; url: string }
  | { id: number; kind: 'run'; opts: Omit<Parameters<typeof runClean>[0], 'inpainter'> };
export type CleanReply = { id: number; value?: unknown; error?: string };

let inpainter: MiganInpainter | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<CleanRequest>) => {
  const msg = event.data;
  try {
    if (msg.kind === 'load') {
      if (!inpainter || inpainter.state !== 'ready') {
        const m = new MiganInpainter();
        await m.load(msg.url, 'wasm');
        inpainter = m;
      }
      scope.postMessage({ id: msg.id, value: true } satisfies CleanReply);
      return;
    }
    const out = await runClean({ ...msg.opts, inpainter: inpainter ?? undefined });
    const buffers = new Set<ArrayBufferLike>([out.pixels.data.buffer, out.bytes.buffer, out.verification.decoded.data.buffer]);
    scope.postMessage({ id: msg.id, value: out } satisfies CleanReply, [...buffers] as Transferable[]);
  } catch (error) {
    scope.postMessage({ id: msg.id, error: error instanceof Error ? error.message : String(error) } satisfies CleanReply);
  }
};
