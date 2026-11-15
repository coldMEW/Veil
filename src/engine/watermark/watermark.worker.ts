/// <reference lib="webworker" />
import { embedMark, detectMark } from './index';
self.onmessage = (
  event: MessageEvent<{
    id: number;
    kind: 'embed' | 'detect';
    image: ImageData;
    key: Uint8Array;
    payload?: string;
  }>,
) => {
  const { id, kind, image, key, payload } = event.data;
  try {
    if (kind === 'embed') {
      if (payload === undefined) throw Error('Payload required.');
      const value = embedMark(image, key, payload);
      self.postMessage({ id, value }, [value.data.buffer]);
    } else self.postMessage({ id, value: detectMark(image, key) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Watermark failed.' });
  }
};
