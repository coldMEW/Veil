/** Native Back: close what is open in the page first, then go back through the app's screens. */
export async function consumeUiBack(): Promise<boolean> {
  if (!window.dispatchEvent(new Event('veil-back', { cancelable: true }))) return true;
  if (window.location.hash && window.location.hash !== '#/') {
    window.history.back();
    return true;
  }
  return false;
}
