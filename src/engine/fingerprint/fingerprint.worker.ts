/// <reference lib="webworker" />
import { pdqHash } from './index';
self.onmessage = (event: MessageEvent<{ id: number; image: ImageData }>) => {
  try {
    self.postMessage({ id: event.data.id, value: pdqHash(event.data.image) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Hash failed.' });
  }
};
