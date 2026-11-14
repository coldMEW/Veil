// Synthetic-only WebView acceptance. Requires an explicitly selected authorized device.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const adb = 'C:/Users/DSU/Android/Sdk/platform-tools/adb.exe';
const device = process.argv[process.argv.indexOf('--serial') + 1];
if (!process.argv.includes('--serial') || !device)
  throw Error('Pass --serial for the authorized test device.');
const outputDir = '../scratch-eval/android/' + (device.startsWith('emulator-') ? 'emulator' : 'pixel7');
mkdirSync(outputDir, { recursive: true });
const command = (...args) => execFileSync(adb, ['-s', device, ...args], { encoding: 'utf8' }).trim();
const fixture = command(
  'shell',
  `content query --uri content://media/external/images/media --projection _id:_display_name --where "_display_name='veil-android01-synthetic.png'"`,
);
const imageId = fixture.match(/_id=(\d+)/)?.[1];
if (!imageId) throw Error('Push and scan the synthetic fixture first.');
const uri = `content://media/external/images/media/${imageId}`;
const pid = command('shell', 'pidof', 'com.veil.app');
command('forward', 'tcp:9224', `localabstract:webview_devtools_remote_${pid}`);
const list = await (await fetch('http://localhost:9224/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let sequence = 0;
const pending = new Map();
const network = [];
const errors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  } else if (msg.method === 'Network.requestWillBeSent')
    network.push({ url: msg.params.request.url, method: msg.params.request.method });
  else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
});
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
await rpc('Network.enable');
await rpc('Runtime.enable');
await rpc('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
const runtime = await evaluate(
  '({userAgent:navigator.userAgent,secure:isSecureContext,crossOriginIsolated,online:navigator.onLine,sharedArrayBuffer:typeof SharedArrayBuffer,safeTop:getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top"),safeBottom:getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-bottom")})',
);
await evaluate(
  `window.__workers=[];window.Worker=class extends Worker { constructor(url,options){super(url,options);const state={url:String(url),created:performance.now(),events:[]};window.__workers.push(state);this.addEventListener('message',e=>{state.events.push({type:e.data.type,ms:performance.now(),boxes:e.data.boxes?.length,error:e.data.message});});} };true`,
);
const click = async (text) =>
  evaluate(
    `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length && b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();return true})()`,
  );
const body = () => evaluate('document.body.innerText');
const wait = async (test, label) => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const text = await body();
    if (test(text)) return text;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error('Timed out ' + label + ': ' + (await body()).slice(-1800));
};
const screenshot = (name) =>
  writeFileSync(`${outputDir}/${name}.png`, execFileSync(adb, ['-s', device, 'exec-out', 'screencap', '-p']));
try {
  screenshot('01-home');
  command(
    'shell',
    'am',
    'start',
    '-n',
    'com.veil.app/.MainActivity',
    '-a',
    'android.intent.action.SEND',
    '-t',
    'image/png',
    '-d',
    uri,
    '--eu',
    'android.intent.extra.STREAM',
    uri,
    '--grant-read-uri-permission',
  );
  await wait((t) => t.includes('veil-android01-synthetic.png'), 'share intake');
  screenshot('02-shared');
  await click('Clean');
  await wait((t) => t.includes('Find private text'), 'Clean ready');
  const scanStart = await evaluate('performance.now()');
  await click('Find private text');
  await wait((t) => t.includes('Remove 2 selected') || t.includes('Nothing was removed or saved.'), 'OCR');
  const scanMs = (await evaluate('performance.now()')) - scanStart;
  const review = await body();
  if (!review.includes('Remove 2 selected')) throw Error('OCR failed: ' + review);
  screenshot('03-ocr-review');
  const cleanStart = await evaluate('performance.now()');
  await click('Remove 2 selected');
  const done = await wait(
    (t) => t.includes('Fresh copy ready') || t.includes('Nothing was removed or saved.'),
    'clean/export/rescan',
  );
  const cleanMs = (await evaluate('performance.now()')) - cleanStart;
  if (!done.includes('Fresh copy ready')) throw Error('Clean failed: ' + done);
  if (!done.includes('no longer detects') || !done.includes('filled in by a model'))
    throw Error('Clean did not pass rescan/inpaint');
  await evaluate("document.querySelector('[data-testid=evidence-sheet]').lastElementChild.scrollIntoView({block:'end'});true");
  screenshot('04-clean-ready');
  const workers = await evaluate('window.__workers');
  const exportQuery = `content query --uri content://media/external/images/media --projection _id:_display_name:relative_path --where "relative_path='Pictures/Veil/' AND _display_name LIKE 'veil-android01-synthetic-clean%'"`;
  const beforeExports = command('shell', exportQuery);
  const previousIds = new Set(Array.from(beforeExports.matchAll(/_id=(\d+)/g), (m) => m[1]));
  await click('Save clean copy');
  let saved = '';
  for (let i = 0; i < 30; i++) {
    saved = command('shell', exportQuery);
    if (Array.from(saved.matchAll(/_id=(\d+)/g), (m) => m[1]).some((id) => !previousIds.has(id))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!Array.from(saved.matchAll(/_id=(\d+)/g), (m) => m[1]).some((id) => !previousIds.has(id))) throw Error('No new clean export saved');
  screenshot('05-export-saved');
  console.log(
    JSON.stringify({
      runtime,
      scanMs,
      cleanMs,
      workers,
      remoteRequests: network.filter(
        (r) => r.url.startsWith('https:') && !r.url.startsWith('https://localhost/'),
      ),
      saved,
      errors,
    }),
  );
  const output = { runtime, scanMs, cleanMs, workers, network, errors, saved, review, done };
  writeFileSync(`${outputDir}/runtime.json`, JSON.stringify(output, null, 2));
} finally {
  await rpc('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  ws.close();
}
