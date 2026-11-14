/** Native Back adapts to the shared UI through its existing semantic keyboard controls. */
export async function consumeUiBack(): Promise<boolean> {
  if (document.querySelector('[role="dialog"][aria-labelledby="report-title"]')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  if (!window.dispatchEvent(new Event('veil-back', { cancelable: true }))) return true;
  const sheet = document.querySelector<HTMLElement>('[data-testid="evidence-sheet"][data-snap]');
  if (sheet && sheet.getBoundingClientRect().width > 0 && sheet.dataset.snap !== 'peek') {
    const slider = sheet.querySelector<HTMLElement>('[role="slider"]');
    if (!slider) return false;
    // Full -> half -> peek: let React commit between the semantic key events.
    for (let i = 0; i < 2 && sheet.dataset.snap !== 'peek'; i++) {
      slider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return true;
  }
  return false;
}
