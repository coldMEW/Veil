import { registerPlugin } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { openImageFile } from '../lib/runtime/imageSession';

import { isAndroid } from './environment';
export { isAndroid } from './environment';
interface SharedImage {
  base64?: string;
  name?: string;
  mime?: string;
}
const intake = registerPlugin<{
  takeSharedImage(): Promise<SharedImage>;
  capturePhoto(): Promise<SharedImage>;
  saveCleanPng(options: { base64: string; name: string }): Promise<{ uri: string }>;
  addListener(event: 'sharedImage', callback: () => void): Promise<unknown>;
}>('VeilIntake');

let backFallback: () => boolean = () => false;
/** Called by the platform React bridge; shared UI gets first refusal through veil-back. */
export function setNativeBackFallback(handler: () => boolean): () => void {
  backFallback = handler;
  return () => {
    if (backFallback === handler) backFallback = () => false;
  };
}

/** Native intake stays in memory and uses the same validation as the web picker. */
export async function initializeNative(): Promise<void> {
  if (!isAndroid()) return;
  document.documentElement.classList.add('veil-android');
  window.addEventListener('veil-camera', () => {
    void takePhoto().catch((error) => {
      if (!/cancel/i.test(String(error))) window.dispatchEvent(new CustomEvent('veil-toast', { detail: String(error) }));
    });
  });
  const consume = async () => {
    try {
      const image = await intake.takeSharedImage();
      if (!image.base64) return;
      const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
      await openImageFile(new File([bytes], image.name ?? 'Shared image', { type: image.mime }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('veil-toast', {
        detail: error instanceof Error ? error.message : 'Could not open the shared image.',
      }));
    }
  };
  await intake.addListener('sharedImage', () => void consume());
  await consume();
  await NativeApp.addListener('appRestoredResult', (result) => {
    if (result.pluginId === 'VeilIntake' && result.methodName === 'capturePhoto' && result.success)
      void openCapture(result.data as SharedImage);
  });
  await NativeApp.addListener('backButton', () => {
    const event = new Event('veil-back', { cancelable: true });
    if (window.dispatchEvent(event) && !backFallback()) void NativeApp.exitApp();
  });
  await StatusBar.setStyle({ style: Style.Light });
  await SplashScreen.hide();
}

/** Only an explicit export writes a temporary file, then opens Android's save/share chooser. */
export async function saveCleanCopy(bytes: Uint8Array, name: string): Promise<void> {
  if (!isAndroid()) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const path = `veil-export-${Date.now()}.png`;
  let base64 = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    base64 += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  // Native MediaStore is scoped Pictures/Veil on Android 10+; older devices use the share chooser.
  try {
    await intake.saveCleanPng({ base64: btoa(base64), name });
    window.dispatchEvent(new CustomEvent('veil-toast', { detail: 'Saved to Pictures/Veil' }));
    return;
  } catch (error) {
    if (!String(error).includes('older Android')) throw error;
  }
  const file = await Filesystem.writeFile({ path, data: btoa(base64), directory: Directory.Cache });
  try {
    await Share.share({ title: 'Save clean copy', files: [file.uri], dialogTitle: 'Save clean copy' });
  } finally {
    /* Older Android share recipients may read the explicitly exported cache file later. */
  }
}

/** CameraX returns bytes from a temporary private file, deleted by the native plugin. */
async function openCapture(photo: SharedImage): Promise<void> {
  if (!photo.base64) throw Error('Camera returned no photo.');
  const bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0));
  await openImageFile(new File([bytes], photo.name ?? 'Camera photo.jpg', { type: 'image/jpeg' }));
}
/** Open Veil's own camera surface, rather than leaving the app for a system camera. */
let captureInFlight: Promise<void> | undefined;
export function takePhoto(): Promise<void> {
  if (!isAndroid()) return Promise.reject(Error('Camera capture is available in the Android app.'));
  captureInFlight ??= intake.capturePhoto().then(openCapture).finally(() => { captureInFlight = undefined; });
  return captureInFlight;
}
