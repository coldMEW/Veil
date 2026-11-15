// Google returns the token in the URL fragment; hand it to the Veil tab that opened this window, then close.
if (window.opener && window.opener !== window) {
  window.opener.postMessage({ type: 'veil-oauth', hash: window.location.hash }, window.location.origin);
  window.close();
} else {
  document.body.textContent = 'You can close this window.';
}
