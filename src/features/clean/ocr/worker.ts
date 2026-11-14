import type * as Ort from 'onnxruntime-web';
import {getOrt} from '../ortEnv';
let ort: typeof Ort;
import { scanImage } from './pipeline';
import { parseDictionary } from './rec';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { OcrModels, TensorData } from './types';

const scope = self as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerResponse): void };
let detector: Ort.InferenceSession | undefined;
let recognizer: Ort.InferenceSession | undefined;
let models: OcrModels | undefined;
let busy = false;

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OCR artifact request failed (${response.status}). Run the model fetch script.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function run(session: Ort.InferenceSession, input: TensorData): Promise<TensorData> {
  const tensor = new ort.Tensor('float32', input.data, input.dims);
  let outputs: Ort.InferenceSession.ReturnType | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]! ]: tensor });
    const out = outputs[session.outputNames[0]! ]! ;
    if (out.type !== 'float32') throw new Error('Unsupported OCR output dtype.');
    return { data: new Float32Array(out.data as Float32Array), dims: [...out.dims] };
  } finally {
    tensor.dispose();
    if (outputs) Object.values(outputs).forEach(out => out.dispose());
  }
}

scope.onmessage = async (event) => {
  if (busy) { scope.postMessage({ type: 'error', message: 'OCR worker is busy.' }); return; }
  busy = true;
  try {
    const message = event.data;
    if (message.type === 'load') {
      ort = await getOrt('wasm');
      const base = new URL(message.baseUrl);
      const dictionary = parseDictionary(new TextDecoder('utf-8', { fatal: true }).decode(await fetchBytes(new URL('dict.txt', base))));
      detector = await ort.InferenceSession.create(await fetchBytes(new URL(`det-${message.detVariant}.onnx`, base)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      recognizer = await ort.InferenceSession.create(await fetchBytes(new URL('rec.onnx', base)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      // Pinned recognizer graph is [batch,3,48,width], output438classes. ORT1.20 lacks metadata APIs.
      const recognitionHeight = 48;
      if(dictionary.length !== 438) throw new Error('OCR dictionary mismatch.');
      const det = detector, rec = recognizer;
      models = { dictionary, recognitionHeight, detect: input => run(det, input), recognize: input => run(rec, input) };
      scope.postMessage({ type: 'loaded' });
    } else {
      if (!models) throw new Error('OCR models are not loaded.');
      const boxes = await scanImage(message.image, models, message.options, progress => scope.postMessage({ type: 'progress', progress }));
      scope.postMessage({ type: 'result', boxes });
    }
  } catch (error) {
    models = undefined;
    await Promise.allSettled([detector?.release(), recognizer?.release()]);
    detector = undefined; recognizer = undefined;
    // No image pixels or OCR text are logged or persisted, including on failure.
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'OCR operation failed.' });
  } finally { busy = false; }
};
