import type { Face } from '../../services/engines';

/** A face handed from Check to Trace, in memory only. */
let value: { bitmap: ImageBitmap; face: Face } | null = null;
export const pendingTrace = {
  set(v: { bitmap: ImageBitmap; face: Face }) {
    value = v;
  },
  take() {
    const v = value;
    value = null;
    return v;
  },
};
