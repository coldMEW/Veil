// Physical-device screenshot and Back acceptance for the shared warm UI.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const adb = 'C:/Users/DSU/Android/Sdk/platform-tools/adb.exe';
const serial = process.argv[process.argv.indexOf('--serial') + 1];
if (!process.argv.includes('--serial') || !serial) throw Error('Explicit --serial is required.');
const dir = '../scratch-eval/android/redesign';
mkdirSync(dir, { recursive: true });
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' }).trim();
const pid = run('shell', 'pidof', 'com.veil.app');
run('forward', 'tcp:9224', `localabstract:webview_devtools_remote_${pid}`);
const targets = await (await fetch('http://localhost:9224/json/list')).json();
const ws = new WebSocket(
  targets.find((t) => t.url === 'https://localhost/')?.webSocketDebuggerUrl ??
    targets[0].webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timeout);
    pending.delete(m.id);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
ws.addEventListener('close', () => {
  for (const p of pending.values()) {
    clearTimeout(p.timeout);
    p.reject(Error('WebView closed'));
  }
  pending.clear();
});
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error('CDP timeout: ' + method));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screenshot = (name) =>
  writeFileSync(
    `${dir}/pixel7-${name}.png`,
    execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p']),
  );
const state = () =>
  evaluate(
    `({report:!!document.querySelector('[role=dialog][aria-labelledby="report-title"]'),snap:document.querySelector('[data-testid=evidence-sheet]')?.dataset.snap,home:!!document.querySelector('[data-testid=drop-zone]'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`,
  );
const button = async (name, aria = false) =>
  evaluate(
    `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&${aria ? `b.getAttribute('aria-label')===${JSON.stringify(name)}` : `b.textContent.trim()===${JSON.stringify(name)}`});if(!b)throw Error('Missing visible button: '+${JSON.stringify(name)});b.click();return true})()`,
  );
const tapHandle = async () => {
  const r = await evaluate(
    `(()=>{const e=document.querySelector('[data-testid=evidence-sheet] [role=slider]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+18}})()`,
  );
  await rpc('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await sleep(60);
  await rpc('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(450);
};
const result = {};
try {
  await evaluate('document.fonts.ready.then(()=>true)');
  await sleep(1600);
  result.empty = await state();
  screenshot('empty');
  const q = run(
    'shell',
    `content query --uri content://media/external/images/media --projection _id --where "_display_name='veil-android01-synthetic.png'"`,
  );
  const id = q.match(/_id=(\d+)/)?.[1];
  if (!id) throw Error('Missing synthetic fixture');
  const uri = `content://media/external/images/media/${id}`;
  run(
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
  for (let i = 0; i < 30; i++) {
    if (await evaluate('!!document.querySelector("[data-testid=workspace]")')) break;
    await sleep(200);
  }
  await sleep(700);
  // Optional model consent is cancelled; this is a layout check, not a download.
  if (await evaluate('!!document.querySelector("[aria-label=\\"Offline models\\"][role=dialog]")'))
    await button('Cancel');
  result.peek = await state();
  screenshot('workspace-peek');
  await tapHandle();
  result.half = await state();
  if (result.half.snap !== 'half') throw Error('Handle did not reach half');
  screenshot('workspace-half');
  await button('Clean');
  await sleep(450);
  result.clean = await state();
  screenshot('clean');
  await button('Create report', true);
  await sleep(500);
  result.report = await state();
  if (!result.report.report) throw Error('Report not open');
  screenshot('report');
  run('shell', 'input', 'keyevent', '4');
  await sleep(350);
  result.backReport = await state();
  if (result.backReport.report || result.backReport.home) throw Error('Back did not close report first');
  await tapHandle();
  await sleep(100);
  result.beforeSheetBack = await state();
  run('shell', 'input', 'keyevent', '4');
  await sleep(450);
  result.backSheet = await state();
  if (result.backSheet.snap !== 'peek' || result.backSheet.home) throw Error('Back did not collapse sheet');
  run('shell', 'input', 'keyevent', '4');
  await sleep(350);
  result.backHome = await state();
  if (!result.backHome.home) throw Error('Back did not return home');
  result.runtime = await evaluate(
    '({secure:isSecureContext,coi:crossOriginIsolated,ua:navigator.userAgent,font:getComputedStyle(document.body).fontFamily,safeTop:getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top"),safeBottom:getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-bottom")})',
  );
  console.log(JSON.stringify(result));
  writeFileSync(`${dir}/pixel7-warm-acceptance.json`, JSON.stringify(result, null, 2));
} catch (e) {
  result.error = String(e);
  console.log(JSON.stringify(result));
  writeFileSync(`${dir}/pixel7-warm-acceptance.json`, JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  ws.close();
}
