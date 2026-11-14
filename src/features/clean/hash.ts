/** Lower-case hex SHA-256 of exact bytes (WebCrypto; works in browsers, workers and Node 20+). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash a binary mask deterministically: width, height (u32 BE) then one byte per pixel. */
export async function maskSha256(mask: { width: number; height: number; data: Uint8Array }): Promise<string> {
  const all = new Uint8Array(8 + mask.data.length);
  const dv = new DataView(all.buffer);
  dv.setUint32(0, mask.width);
  dv.setUint32(4, mask.height);
  all.set(mask.data, 8);
  return sha256Hex(all);
}
