import type { TransformRecord } from '../../contracts';
import { encodePng } from '../clean/export';
import { sha256Hex } from '../clean/hash';
import type { Mask, Pixels } from '../clean/mask';
import { DIFFVAX_REVISION, DIFFVAX_SHA256, DiffVaxImmunizer } from './diffvax';
import { applyJitter, psnr, ssim } from './jitter';

export const PROTECT_LABEL = 'Experimental. Protection is not established.';
export type ProtectArm = 'jitter' | 'diffvax' | 'combined';

export interface ProtectRequest {
  src: Pixels;
  srcSha256: string;
  arms: readonly ProtectArm[];
  seed: number;
  /** 1 = an editor would repaint this area, so DiffVax leaves it unchanged. */
  editorMask?: Mask;
  immunizer?: DiffVaxImmunizer;
  /** Test-only encoder; production writes a new PNG with no inherited metadata. */
  encode?: (pixels: Pixels) => Promise<Uint8Array>;
  now?: () => string;
}

export interface ProtectOutput {
  arm: ProtectArm;
  pixels: Pixels;
  bytes: Uint8Array;
  transforms: TransformRecord[];
  fidelity: { psnr: number; ssim: number };
  label: typeof PROTECT_LABEL;
}

function record(arm: ProtectArm, inputSha256: string, outputSha256: string, px: Pixels, seed: number, now: string): TransformRecord {
  return {
    id: `protect-${arm}-${outputSha256.slice(0, 12)}`,
    method: arm === 'jitter' ? 'jitter_experimental' : 'diffvax',
    inputSha256,
    outputSha256,
    modelSha256: arm === 'jitter' ? undefined : DIFFVAX_SHA256,
    seed,
    parameters: arm === 'jitter'
      ? { arm, amplitude: 2, label: PROTECT_LABEL }
      : { arm, revision: DIFFVAX_REVISION, network: 'RGB 512x512 [-1,1]', label: PROTECT_LABEL },
    outputFormat: 'image/png', outputWidth: px.width, outputHeight: px.height,
    synthetic: false, createdAt: now,
  };
}

/** Applies explicitly requested experimental arms. A caller must load DiffVax before requesting it. */
export async function runProtect(request: ProtectRequest): Promise<ProtectOutput[]> {
  if (!request.arms.length) throw new Error('select at least one Protect arm');
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) throw new Error('seed must be a uint32');
  const encode = request.encode ?? encodePng;
  const now = (request.now ?? (() => new Date().toISOString()))();
  const unique = [...new Set(request.arms)];
  const outputs: ProtectOutput[] = [];
  for (const arm of unique) {
    let pixels: Pixels;
    if (arm === 'jitter') pixels = applyJitter(request.src, { seed: request.seed, amplitude: 2 });
    else if (arm === 'diffvax') {
      if (!request.immunizer) throw new Error('DiffVax arm requires a loaded immunizer');
      pixels = (await request.immunizer.immunize(request.src, request.editorMask)).pixels;
    } else {
      if (!request.immunizer) throw new Error('Combined arm requires a loaded immunizer');
      const jittered = applyJitter(request.src, { seed: request.seed, amplitude: 2 });
      pixels = (await request.immunizer.immunize(jittered, request.editorMask)).pixels;
    }
    const bytes = await encode(pixels);
    const outputSha256 = await sha256Hex(bytes);
    outputs.push({ arm, pixels, bytes, transforms: [record(arm, request.srcSha256, outputSha256, pixels, request.seed, now)], fidelity: { psnr: psnr(request.src, pixels), ssim: ssim(request.src, pixels) }, label: PROTECT_LABEL });
  }
  return outputs;
}
