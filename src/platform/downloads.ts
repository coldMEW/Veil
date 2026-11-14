/** Compatibility for shared web Clean exports inside Android's WebView (which cannot save blob URLs). */
export function installCleanDownloadBridge(save: (bytes: Uint8Array, name: string) => Promise<void>): void {
  const blobs = new Map<string, Blob>();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  const click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (value: Blob | MediaSource) => {
    const url = create(value);
    if (value instanceof Blob && value.type === 'image/png') blobs.set(url, value);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
    revoke(url);
  };
  HTMLAnchorElement.prototype.click = function () {
    const blob = /-(clean|protected)\.png$/i.test(this.download) ? blobs.get(this.href) : undefined;
    if (!blob) {
      click.call(this);
      return;
    }
    const name = this.download;
    // Retain this Blob reference even when the web handler immediately revokes its URL.
    void blob
      .arrayBuffer()
      .then((buffer) => save(new Uint8Array(buffer), name))
      .catch((error) => {
        window.dispatchEvent(new CustomEvent('veil-toast', { detail: String(error) }));
      });
  };
}
