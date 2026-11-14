import type { PixelRect, RgbaImage } from './types';

export function validateImage(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      image.width * image.height > 24_000_000 || image.data.length !== image.width * image.height * 4) {
    throw new Error('OCR requires valid RGBA pixels, up to 24 megapixels.');
  }
}

export function clipRect(r: PixelRect, width: number, height: number): PixelRect {
  if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) throw new Error('Invalid OCR crop.');
  const x = Math.max(0, Math.min(width, r.x));
  const y = Math.max(0, Math.min(height, r.y));
  const right = Math.max(x, Math.min(width, r.x + r.w));
  const bottom = Math.max(y, Math.min(height, r.y + r.h));
  if (right <= x || bottom <= y) throw new Error('OCR crop is outside the image.');
  return { x, y, w: right - x, h: bottom - y };
}

/** Bilinear channel sampling; transparency is composited on white, never treated as hidden text. */
export function sample(image: RgbaImage, x: number, y: number, channel: number): number {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
  const read = (xx: number, yy: number) => {
    const i = (yy * image.width + xx) * 4;
    const alpha = image.data[i + 3]!  / 255;
    return image.data[i + channel]!  * alpha + 255 * (1 - alpha);
  };
  const dx = x - x0, dy = y - y0;
  return (read(x0, y0) * (1 - dx) + read(x1, y0) * dx) * (1 - dy) +
    (read(x0, y1) * (1 - dx) + read(x1, y1) * dx) * dy;
}

/** Interleaved BGR bilinear resize/affine warp. Compute geometry and alpha once per pixel. */
export function resizeBgr(image: RgbaImage, r: PixelRect, width: number, height: number, quad?: [number,number][]): Float32Array {
  const output = new Float32Array(width*height*3), src = image.data, iw=image.width, ih=image.height;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const u=(x+0.5)/width,v=(y+0.5)/height;
    let sx=quad ? quad[0]! [0]! +u*(quad[1]! [0]! -quad[0]! [0]! )+v*(quad[3]! [0]! -quad[0]! [0]! ) : r.x+u*r.w-0.5;
    let sy=quad ? quad[0]! [1]! +u*(quad[1]! [1]! -quad[0]! [1]! )+v*(quad[3]! [1]! -quad[0]! [1]! ) : r.y+v*r.h-0.5;
    sx=Math.max(0,Math.min(iw-1,sx));sy=Math.max(0,Math.min(ih-1,sy));
    const xx=Math.floor(sx),yy=Math.floor(sy),dx=sx-xx,dy=sy-yy;
    const i0=(yy*iw+xx)*4,i1=(yy*iw+Math.min(xx+1,iw-1))*4,i2=(Math.min(yy+1,ih-1)*iw+xx)*4,i3=(Math.min(yy+1,ih-1)*iw+Math.min(xx+1,iw-1))*4;
    const w0=(1-dx)*(1-dy),w1=dx*(1-dy),w2=(1-dx)*dy,w3=dx*dy;
    const a0=src[i0+3]! /255,a1=src[i1+3]! /255,a2=src[i2+3]! /255,a3=src[i3+3]! /255;
    for(let c=0;c<3;c++){const channel=2-c;output[(y*width+x)*3+c]! =(src[i0+channel]! *a0+255*(1-a0))*w0+(src[i1+channel]! *a1+255*(1-a1))*w1+(src[i2+channel]! *a2+255*(1-a2))*w2+(src[i3+channel]! *a3+255*(1-a3))*w3;}
  }
  return output;
}
