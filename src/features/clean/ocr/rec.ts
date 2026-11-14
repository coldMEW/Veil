import { clipRect, resizeBgr, validateImage } from './image';
import type { PixelRect, RgbaImage, TensorData, Profile } from './types';

export function parseDictionary(text: string): string[] {
  const entries = text.replace(/^\uFEFF/, '').split('\n').map(line => line.replace(/\r$/, ''));
  while (entries[entries.length - 1]!  === '') entries.pop();
  if (!entries.length || entries.some(char => char.length === 0)) throw new Error('Empty/invalid OCR dictionary.');
  // Paddle CTCLabelDecode inserts blank at zero; use_space_char appends a space.
  return ['', ...entries, ...(entries.includes(' ') ? [] : [' '])];
}

export function decodeCtc(values: Float32Array, dims: readonly number[], dictionary: string[], mode: 'probabilities' | 'logits' = 'probabilities') {
  if (dims.length !== 3 || dims[0]!  !== 1 || dims[2]!  !== dictionary.length) throw new Error('Recognition shape/dictionary mismatch.');
  const steps=dims[1]!,classes=dims[2]!;
  if (values.length !== steps * classes) throw new Error('Invalid CTC tensor length.');
  let previous = -1, text = '', total = 0, count = 0;
  for (let t = 0; t < steps; t++) {
    let index = 0, best = -Infinity;
    for (let c = 0; c < classes; c++) {
      const value = values[t * classes + c]! ;
      if (!Number.isFinite(value)) throw new Error('Non-finite CTC output.');
      if (value > best) { best = value; index = c; }
    }
    if (index !== 0 && index !== previous) {
      let score = best;
      if (mode === 'logits') {
        let sum = 0;
        for (let c = 0; c < classes; c++) sum += Math.exp(values[t * classes + c]!  - best);
        score = 1 / sum;
      } else if (score < 0 || score > 1.00001) throw new Error('Expected CTC probabilities, got logits.');
      text += dictionary[index]! ; total += score; count++;
    }
    previous = index;
  }
  return { text, recScore: count ? total / count : 0 };
}

export function preprocessRecognition(image: RgbaImage, crop: PixelRect, height: number, quad?: [number, number][], profile?: Profile): TensorData & { rotated: boolean; resizedWidth: number } {
  validateImage(image);
  if (!Number.isInteger(height) || height < 1 || height > 128) throw new Error('Invalid model recognition height.');
  const r = clipRect(crop, image.width, image.height);
  if (quad && quad.length !== 4) throw new Error('OCR quad needs four corners.');
  const qw = quad ? Math.hypot(quad[1]! [0]! -quad[0]! [0]! , quad[1]! [1]! -quad[0]! [1]! ) : r.w;
  const qh = quad ? Math.hypot(quad[3]! [0]! -quad[0]! [0]! , quad[3]! [1]! -quad[0]! [1]! ) : r.h;
  const rotated = !quad && r.h / r.w >= 1.5;
  const aspect = rotated ? r.h / r.w : qw / qh;
  const resizedWidth = Math.max(1, Math.ceil(height * aspect));
  if (resizedWidth > 4096) throw new Error('Text line exceeds recognition width budget; use a smaller crop.');
  const width = Math.max(320, resizedWidth);
  // Paddle pads the normalized tensor with zeros (not normalized black pixels).
  const data = new Float32Array(3 * width * height);
  const warpQuad = quad ?? (rotated ? [[r.x+r.w-0.5,r.y-0.5],[r.x+r.w-0.5,r.y+r.h-0.5],[r.x-0.5,r.y+r.h-0.5],[r.x-0.5,r.y-0.5]] as [number,number][] : undefined);
  const warpStart=performance.now();
  const pixels=resizeBgr(image,r,resizedWidth,height,warpQuad);
  profile?.('rec_affine_resize',performance.now()-warpStart);
  const normStart=performance.now();
  for(let y=0;y<height;y++) for(let x=0;x<resizedWidth;x++) {
    const i=(y*resizedWidth+x)*3,j=y*width+x;
    data[j]! =pixels[i]! /127.5-1;data[width*height+j]! =pixels[i+1]! /127.5-1;data[2*width*height+j]! =pixels[i+2]! /127.5-1;
  }
  profile?.('rec_normalize',performance.now()-normStart);
  return { data, dims: [1, 3, height, width], rotated, resizedWidth };
}
