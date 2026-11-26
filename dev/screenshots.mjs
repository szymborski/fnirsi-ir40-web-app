// Make README screenshots with headless Chrome (CDP). No npm packages.
// Start dev server first: python3 dev/serve.py
// Run: node dev/screenshots.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8640/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const PORT = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'dalmierz-shot-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await wait(200);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not ready */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value;
  const shot = async (name) => {
    await wait(900);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${BASE}?demo#/` });
  await wait(1500);
  await shot('1-katalogi');

  const ids = await evaluate(`new Promise((res) => { const q = indexedDB.open('dalmierz'); q.onsuccess = () => {
    const t = q.result.transaction(['folders', 'projects']);
    const a = t.objectStore('folders').getAll(), b = t.objectStore('projects').getAll();
    t.oncomplete = () => res({ folder: a.result[0].id, projects: Object.fromEntries(b.result.map((p) => [p.name, p.id])) });
  }; })`);

  await evaluate(`location.hash = '#/f/${ids.folder}'`);
  await wait(1500); // thumbnails render
  await shot('2-pomiary');

  await evaluate(`location.hash = '#/p/${ids.projects['Kuchnia']}'`);
  await wait(600);
  await evaluate(`(() => { const ed = window.dalmierzEditor; ed.select({ id: ed.shapes[0].id, edge: 0 }); })()`);
  await shot('3-rysunek');

  await evaluate(`location.hash = '#/p/${ids.projects['Ściana z oknem']}'`);
  await shot('4-zdjecie');
  ws.close();
} finally {
  chrome.kill();
}
