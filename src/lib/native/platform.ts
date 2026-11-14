import { Capacitor } from '@capacitor/core';
import { Camera, EncodingType, type MediaResult } from '@capacitor/camera';
import { registerPlugin } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { openImageFile } from '../runtime/imageSession';

import { isAndroid } from './environment';
export { isAndroid } from './environment';
interface SharedImage {
  base64?: string;
  name?: string;
  mime?: string;
}
const intake = registerPlugin<{
  takeSharedImage(): Promise<SharedImage>;
  saveCleanPng(options: { base64: string; name: string }): Promise<{ uri: string }>;
  addListener(event: 'sharedImage', callback: () => void): Promise<unknown>;
}>('VeilIntake');

/** Native intake stays in memory and uses the same validation as the web picker. */
export async function initializeNative(): Promise<void> {
  if (!isAndroid()) return;
  document.documentElement.classList.add('veil-android');
  const consume = async () => {
    try {
      const image = await intake.takeSharedImage();
      if (!image.base64) return;
      const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
      await openImageFile(new File([bytes], image.name ?? 'Shared image', { type: image.mime }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not open the shared image.');
    }
  };
  await intake.addListener('sharedImage', () => void consume());
  await consume();
  await NativeApp.addListener('appRestoredResult', (result) => {
    if (result.pluginId === 'Camera' && result.success) void openCapture(result.data as MediaResult);
  });
  await NativeApp.addListener('backButton', () => {
    const event = new Event('veil-back', { cancelable: true });
    if (window.dispatchEvent(event)) void NativeApp.exitApp();
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
    alert('Clean copy saved to Pictures/Veil.');
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

/** Explicit camera capture; same local intake, no gallery copy and no remote request. */
async function openCapture(photo: MediaResult): Promise<void> {
  const path = photo.webPath ?? (photo.uri ? Capacitor.convertFileSrc(photo.uri) : null);
  if (!path) throw Error('Camera returned no photo.');
  try {
    const response = await fetch(path);
    const blob = await response.blob();
    await openImageFile(new File([blob], 'Camera photo.jpg', { type: 'image/jpeg' }));
  } finally {
    if (photo.uri?.startsWith('file://'))
      await Filesystem.deleteFile({ path: photo.uri }).catch(() => undefined);
  }
}
export async function takePhoto(): Promise<void> {
  const photo = await Camera.takePhoto({
    quality: 95,
    saveToGallery: false,
    encodingType: EncodingType.JPEG,
    correctOrientation: true,
    editable: 'no',
  });
  await openCapture(photo);
}
