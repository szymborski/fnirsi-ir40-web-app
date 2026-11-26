// App shell: router, screens, rangefinder link.
import * as db from './db.js';
import { ir40, IR40, MODE, errorText } from './ble.js';
import { Editor } from './editor.js';
import { render, fitView } from './render.js';
import { bounds, edgeCount, polyMetrics, rectPairs, rectMismatch, marksOf, RECT_TOL } from './geometry.js';
import { MARK_KINDS, kindOf, fieldLabel, markName } from './marks.js';
import { fmt, fmtArea, fmtDate, parse, esc } from './format.js';
import { importPhoto, pickPhoto, blobToImage, toBlob } from './image.js';
import { exportBackup, importBackup, pickFile } from './backup.js';
import { $, h, toast, ask, confirmBox, menu, sheet, beep, shareFile } from './ui.js';
import { seedDemo } from './demo.js';
import { latestVersion, refreshFiles } from './update.js';

export const APP_VERSION = '1.1.2'; // Change also version.json.

const app = $('#app');
const settings = { unit: 'mm', sound: true, sim: false };
const readings = []; // last readings: { mm, t, used }
let screen = null; // { name, cleanup, onMeasure }
let urls = []; // object URLs to free on screen change
let curHash = '', prevHash = ''; // For back from a wall photo to its plan.

const NAME_HINTS = ['Kuchnia', 'Salon', 'Sypialnia', 'Łazienka', 'Przedpokój', 'Całe mieszkanie', 'Balkon', 'Pokój dziecka'];

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M12 3v9M12 3l-2.5 2.5M12 3l2.5 2.5M12 21v-9M12 21l-2.5-2.5M12 21l2.5-2.5M3 12h9M3 12l2.5-2.5M3 12l2.5 2.5M21 12h-9M21 12l-2.5-2.5M21 12l-2.5 2.5"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 19L9 7l7 9 4-11" stroke-width="2.6"/><circle cx="4" cy="19" r="1.8"/><circle cx="9" cy="7" r="1.8"/><circle cx="16" cy="16" r="1.8"/></svg>',
  rect: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" stroke-width="2.4"/></svg>',
  dim: '<svg viewBox="0 0 24 24"><path d="M4 12h16M4 8v8M20 8v8M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
  magnet: '<svg viewBox="0 0 24 24"><path d="M6 4v8a6 6 0 0012 0V4"/><path d="M6 8h3M15 8h3"/><path d="M9 4v8a3 3 0 006 0V4"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  ble: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
  sketch: '<svg viewBox="0 0 24 24"><path d="M4 4h10v6h6v10H4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.4"/></svg>',
};

// ---------- boot ----------
async function boot() {
  Object.assign(settings, await db.getSetting('settings', {}));
  ir40.addEventListener('state', onBleState);
  ir40.addEventListener('measure', (e) => onMeasure(e.detail));
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeLock(); });
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    await seedDemo();
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (params.has('sim')) settings.sim = true;
  route();
  if (!settings.sim) ir40.reconnectKnown().then((ok) => ok && toast('Dalmierz połączony', 'ok'));
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    checkUpdate();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkUpdate());
  }
}

// Look for a new deploy. On start and when the app comes back to the front, max once per 5 min.
let lastCheck = 0;
async function checkUpdate(manual = false) {
  if (!manual && Date.now() - lastCheck < 5 * 60e3) return;
  lastCheck = Date.now();
  let v;
  try { v = await latestVersion(); } catch {
    if (manual) toast('Brak połączenia z serwerem', 'err');
    return;
  }
  if (v === APP_VERSION) {
    if (manual) toast(`Masz najnowszą wersję (${v})`, 'ok');
    return;
  }
  await refreshFiles();
  if (manual) location.reload();
  else toast(`Nowa wersja ${v}`, '', { action: { label: 'Odśwież', run: () => location.reload() }, ms: 15000 });
}

function saveSettings() {
  return db.setSetting('settings', { ...settings });
}

// ---------- router ----------
async function route() {
  prevHash = curHash;
  curHash = location.hash;
  screen?.cleanup?.();
  screen = null;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  document.querySelectorAll('.modal').forEach((m) => m.remove());
  const [, kind, id] = location.hash.split('/');
  if (kind === 'f' && id) return showFolder(id);
  if (kind === 'p' && id) return showProject(id);
  return showHome();
}

const go = (hash) => { location.hash = hash; };
const objUrl = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

// ---------- BLE ----------
function bleButton() {
  return `<button class="ble-btn" data-ble aria-label="Dalmierz">${ICON.ble}<span data-ble-label></span></button>`;
}

function updateBleUi() {
  const last = readings[0];
  document.querySelectorAll('[data-ble]').forEach((b) => {
    b.dataset.state = settings.sim ? 'connected' : ir40.state;
    const label = b.querySelector('[data-ble-label]');
    if (settings.sim) label.textContent = last ? fmt(last.mm, settings.unit, true) : 'Symulacja';
    else if (ir40.state === 'connected') label.textContent = last ? fmt(last.mm, settings.unit, true) : 'Połączono';
    else if (ir40.state === 'connecting') label.textContent = 'Łączę…';
    else label.textContent = 'Połącz';
  });
}

// Tell the user when the link drops. They look at the laser dot, not at the screen.
let bleWas = 'disconnected', bleLost = false;
function onBleState() {
  const st = ir40.state;
  if (bleWas === 'connected' && st === 'disconnected' && !ir40.manualDisconnect) {
    bleLost = true;
    toast('Dalmierz rozłączony. Łączę ponownie…', 'warn');
    if (settings.sound) beep(440, 220);
  } else if (st === 'connected' && bleLost) {
    bleLost = false;
    toast('Dalmierz połączony', 'ok');
  }
  if (st === 'disconnected' && ir40.manualDisconnect) bleLost = false;
  bleWas = st;
  updateBleUi();
}

async function onBleTap() {
  if (settings.sim) {
    const v = await menu('Tryb testowy', [
      { label: 'Symuluj pomiar', value: 'm', icon: ICON.ble, hint: 'Losowa długość jak z dalmierza' },
      { label: 'Wyłącz tryb testowy', value: 'off' },
    ]);
    if (v === 'm') ir40.simulate();
    if (v === 'off') { settings.sim = false; saveSettings(); updateBleUi(); }
    return;
  }
  if (!IR40.supported) return showNoBle();
  if (ir40.state === 'connected') {
    const v = await menu('FNIRSI IR40', [{ label: 'Rozłącz', value: 'off', danger: true }]);
    if (v === 'off') ir40.disconnect();
    return;
  }
  if (ir40.state === 'connecting') return;
  try {
    await ir40.connect();
    toast('Dalmierz połączony. Mierz przyciskiem na urządzeniu.', 'ok');
  } catch (e) {
    if (e?.name !== 'NotFoundError' && e?.name !== 'AbortError') toast(`Błąd połączenia: ${errorText(e)}`, 'err');
  }
}

function showNoBle() {
  const m = sheet(`<div class="form"><h3>Brak Bluetooth w tej przeglądarce</h3>
    <p class="muted">Safari na iPhonie nie obsługuje Web Bluetooth. Otwórz ten adres w aplikacji <b>Bluefy</b> (darmowa, App Store). Na komputerze użyj Chrome lub Edge.</p>
    <p class="muted">Bez dalmierza możesz wpisywać wymiary ręcznie albo włączyć tryb testowy.</p>
    <div class="col">
      <button class="btn primary" data-copy>Kopiuj link do aplikacji</button>
      <a class="btn ghost" href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy w App Store</a>
      <button class="btn ghost" data-sim>Włącz tryb testowy</button>
    </div></div>`);
  m.el.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href.split('#')[0]); toast('Skopiowano link'); } catch { toast(location.href); }
  };
  m.el.querySelector('[data-sim]').onclick = () => { settings.sim = true; saveSettings(); updateBleUi(); m.close(); };
}

function onMeasure({ mode, mm, unit }) {
  if (mode !== MODE.LINEAR || !mm) return; // Only length mode. 0 = no valid reading.
  if (unit !== 0) toast('Ustaw jednostkę „m” na dalmierzu', 'err');
  // used = true before put: the panel renders during put and must not offer this reading again.
  const r = { mm, t: Date.now(), used: true };
  readings.unshift(r);
  readings.length = Math.min(readings.length, 8);
  if (settings.sound) beep();
  updateBleUi();
  if (screen?.onMeasure) r.used = screen.onMeasure(mm);
  else toast(`Odczyt ${fmt(mm, settings.unit, true)}. Otwórz pomiar, aby go wstawić.`);
}

// ---------- wake lock ----------
let lock = null;
async function wakeLock() {
  if (screen?.name !== 'editor') return;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}

// ---------- home ----------
async function showHome() {
  screen = { name: 'home' };
  const folders = (await db.getAll('folders')).sort((a, b) => b.updatedAt - a.updatedAt);
  const counts = {};
  for (const f of folders) counts[f.id] = (await db.projectsInFolder(f.id)).length;

  app.innerHTML = `
    <header class="bar">
      <h1>Dalmierz</h1>
      <div class="spacer"></div>
      ${bleButton()}
      <button class="icon-btn" data-settings aria-label="Ustawienia">${ICON.gear}</button>
    </header>
    <main class="scroll">
      ${!IR40.supported && !settings.sim ? `<div class="banner" data-noble>Ta przeglądarka nie obsługuje Bluetooth. Na iPhonie otwórz stronę w Bluefy. <u>Więcej</u></div>` : ''}
      ${folders.length ? `<ul class="cards">${folders.map((f) => `
        <li class="card" data-id="${f.id}">
          <div class="card-icon">${ICON.folder}</div>
          <div class="card-body"><b>${esc(f.name)}</b><small>${counts[f.id]} ${plural(counts[f.id], 'pomiar', 'pomiary', 'pomiarów')} · ${fmtDate(f.updatedAt)}</small></div>
          <button class="icon-btn" data-more="${f.id}" aria-label="Opcje">${ICON.more}</button>
        </li>`).join('')}</ul>`
      : `<div class="empty"><div class="empty-icon">${ICON.folder}</div><h2>Brak katalogów</h2>
          <p>Utwórz katalog dla mieszkania lub zlecenia, np. „Mieszkanie ul. Smocza 16”. W środku dodasz rysunki i zdjęcia z wymiarami.</p></div>`}
    </main>
    <button class="fab" data-new>${ICON.plus}<span>Nowy katalog</span></button>`;

  bindCommon();
  app.querySelector('[data-noble]')?.addEventListener('click', showNoBle);
  app.querySelector('[data-settings]').onclick = showSettings;
  app.querySelector('[data-new]').onclick = async () => {
    const name = await ask('Nowy katalog', '', { placeholder: 'np. Mieszkanie ul. Smocza 16', ok: 'Utwórz' });
    if (!name) return;
    const f = { id: db.uid(), name, createdAt: Date.now(), updatedAt: Date.now() };
    await db.put('folders', f);
    db.requestPersist();
    go(`#/f/${f.id}`);
  };
  app.querySelectorAll('.card').forEach((c) => c.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) return;
    go(`#/f/${c.dataset.id}`);
  }));
  app.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => folderMenu(folders.find((f) => f.id === b.dataset.more))));
}

async function folderMenu(f) {
  const v = await menu(f.name, [
    { label: 'Zmień nazwę', value: 'rename' },
    { label: 'Zapisz kopię zapasową', value: 'backup', hint: 'Plik .json ze zdjęciami' },
    { label: 'Usuń katalog', value: 'delete', danger: true },
  ]);
  if (v === 'rename') {
    const name = await ask('Nazwa katalogu', f.name);
    if (name) { f.name = name; f.updatedAt = Date.now(); await db.put('folders', f); route(); }
  } else if (v === 'backup') {
    const blob = await exportBackup([f.id]);
    await shareFile(blob, `${slug(f.name)}.dalmierz.json`, f.name);
  } else if (v === 'delete') {
    if (await confirmBox('Usunąć katalog?', `„${f.name}” i wszystkie pomiary w środku znikną z tego urządzenia.`)) {
      await db.deleteFolder(f.id);
      if (location.hash.startsWith('#/f/')) go('#/'); else route();
    }
  }
}

// ---------- folder ----------
async function showFolder(id) {
  const f = await db.get('folders', id);
  if (!f) return go('#/');
  screen = { name: 'folder' };
  const projects = await db.projectsInFolder(id);

  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-back aria-label="Wstecz">${ICON.back}</button>
      <h1 class="title-btn" data-rename>${esc(f.name)}</h1>
      <div class="spacer"></div>
      ${bleButton()}
      <button class="icon-btn" data-more aria-label="Opcje">${ICON.more}</button>
    </header>
    <main class="scroll">
      ${projects.length ? `<ul class="grid">${projects.map((p) => {
        const st = projectStats(p);
        return `<li class="tile" data-id="${p.id}">
          <div class="thumb">${p.thumb ? `<img src="${objUrl(p.thumb)}" alt="">` : `<span>${p.kind === 'photo' ? ICON.image : ICON.sketch}</span>`}</div>
          <div class="tile-body"><b>${esc(p.name)}</b>
            <small>${p.parent ? 'Zdjęcie ściany' : p.kind === 'photo' ? 'Zdjęcie' : 'Rysunek'} · <span class="${st.total && st.done === st.total ? 'ok' : st.total ? 'warn' : ''}">${st.done}/${st.total} wymiarów</span></small></div>
          <button class="icon-btn" data-pmore="${p.id}" aria-label="Opcje">${ICON.more}</button>
        </li>`;
      }).join('')}</ul>`
      : `<div class="empty"><div class="empty-icon">${ICON.sketch}</div><h2>Brak pomiarów</h2>
          <p>Dodaj <b>rysunek</b>, aby naszkicować pomieszczenie, albo <b>zdjęcie</b> ściany czy szafki i zaznacz na nim odcinki do zmierzenia.</p></div>`}
    </main>
    <button class="fab" data-new>${ICON.plus}<span>Nowy pomiar</span></button>`;

  bindCommon();
  app.querySelector('[data-back]').onclick = () => go('#/');
  app.querySelector('[data-rename]').onclick = async () => {
    const name = await ask('Nazwa katalogu', f.name);
    if (name) { f.name = name; f.updatedAt = Date.now(); await db.put('folders', f); route(); }
  };
  app.querySelector('[data-more]').onclick = () => folderMenu(f);
  app.querySelector('[data-new]').onclick = () => newProject(f);
  app.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', (e) => {
    if (e.target.closest('[data-pmore]')) return;
    go(`#/p/${t.dataset.id}`);
  }));
  app.querySelectorAll('[data-pmore]').forEach((b) => (b.onclick = () => projectMenu(projects.find((p) => p.id === b.dataset.pmore), f)));

  // Make missing thumbnails (for example after backup import).
  for (const p of projects) {
    if (p.thumb || !p.shapes?.length && !p.imageId) continue;
    const img = p.imageId ? await loadProjectImage(p) : null;
    const t = await makeThumb(p, img).catch(() => null);
    if (!t || screen?.name !== 'folder') continue;
    p.thumb = t;
    await db.put('projects', p);
    const box = app.querySelector(`.tile[data-id="${p.id}"] .thumb`);
    if (box) box.innerHTML = `<img src="${objUrl(t)}" alt="">`;
  }
}

function projectStats(p) {
  let total = 0, done = 0;
  for (const s of p.shapes || []) for (let i = 0; i < edgeCount(s); i++) { total++; if (s.edges[i]?.v) done++; }
  return { total, done };
}

async function newProject(f) {
  const kind = await menu('Nowy pomiar', [
    { label: 'Rysunek', value: 'sketch', icon: ICON.sketch, hint: 'Narysuj pomieszczenie lub mebel' },
    { label: 'Zrób zdjęcie', value: 'camera', icon: ICON.camera, hint: 'Zaznacz odcinki na zdjęciu' },
    { label: 'Zdjęcie z galerii', value: 'gallery', icon: ICON.image },
  ]);
  if (!kind) return;
  let photo = null;
  if (kind !== 'sketch') {
    photo = await takePhoto(kind === 'camera');
    if (!photo) return;
  }
  const name = await ask('Nazwa pomiaru', '', { placeholder: 'np. Kuchnia', ok: 'Utwórz', suggestions: NAME_HINTS });
  if (!name) return;
  const p = await addProject(f, name, photo);
  go(`#/p/${p.id}`);
}

// Pick and scale a photo. Return { blob, width, height } or null.
async function takePhoto(camera) {
  const file = await pickPhoto(camera);
  if (!file) return null;
  toast('Przygotowuję zdjęcie…');
  try { return await importPhoto(file); } catch (e) { toast(e.message, 'err'); return null; }
}

// Save a new project. photo = null: sketch.
async function addProject(f, name, photo, extra = {}) {
  const p = {
    id: db.uid(), folderId: f.id, name, kind: photo ? 'photo' : 'sketch',
    shapes: [], createdAt: Date.now(), updatedAt: Date.now(), thumb: null, ...extra,
  };
  if (photo) {
    p.imageId = db.uid();
    p.imageW = photo.width;
    p.imageH = photo.height;
    await db.put('images', { id: p.imageId, blob: photo.blob });
  }
  await db.put('projects', p);
  f.updatedAt = Date.now();
  await db.put('folders', f);
  db.requestPersist();
  return p;
}

// Delete a project. A wall photo: remove the link from its plan too.
async function removeProject(p) {
  if (p.parent) {
    const parent = await db.get('projects', p.parent);
    let hit = false;
    for (const s of parent?.shapes || []) for (const e of s.edges || []) if (e.photo === p.id) { delete e.photo; hit = true; }
    if (hit) await db.put('projects', parent);
  }
  await db.deleteProject(p);
}

async function projectMenu(p, f) {
  const v = await menu(p.name, [
    { label: 'Zmień nazwę', value: 'rename' },
    { label: 'Eksport PNG z wymiarami', value: 'png' },
    { label: 'Duplikuj', value: 'dup' },
    { label: 'Usuń', value: 'delete', danger: true },
  ]);
  if (v === 'rename') {
    const name = await ask('Nazwa pomiaru', p.name, { suggestions: NAME_HINTS });
    if (name) { p.name = name; await db.put('projects', p); route(); }
  } else if (v === 'png') {
    const img = p.imageId ? await loadProjectImage(p) : null;
    await exportPng(p, img, f);
  } else if (v === 'dup') {
    const copy = { ...structuredClone({ ...p, thumb: null }), id: db.uid(), name: `${p.name} (kopia)`, createdAt: Date.now(), updatedAt: Date.now(), thumb: p.thumb };
    if (p.imageId) {
      const img = await db.get('images', p.imageId);
      copy.imageId = db.uid();
      await db.put('images', { id: copy.imageId, blob: img.blob });
    }
    await db.put('projects', copy);
    route();
  } else if (v === 'delete') {
    if (await confirmBox('Usunąć pomiar?', `„${p.name}” zniknie z tego urządzenia.`)) {
      await removeProject(p);
      route();
    }
  }
}

async function loadProjectImage(p) {
  const rec = await db.get('images', p.imageId);
  if (!rec) return null;
  const img = await blobToImage(rec.blob);
  urls.push(img.dataset.url);
  return img;
}

// ---------- editor ----------
async function showProject(id) {
  const p = await db.get('projects', id);
  if (!p) return go('#/');
  const f = await db.get('folders', p.folderId);
  const image = p.imageId ? await loadProjectImage(p) : null;
  const parent = p.parent ? await db.get('projects', p.parent) : null; // Plan of a wall photo.

  const tools = [
    ['hand', 'Przesuń', ICON.hand],
    ['line', 'Ściana', ICON.line],
    ['rect', 'Prostokąt', ICON.rect],
    ['dim', 'Wymiar', ICON.dim],
    ['text', 'Notatka', ICON.text],
  ];
  app.innerHTML = `
    <div class="editor">
      <header class="bar">
        <button class="icon-btn" data-back aria-label="Wstecz">${ICON.back}</button>
        <h1 class="title-btn" data-rename>${esc(p.name)}</h1>
        <div class="spacer"></div>
        ${bleButton()}
        <button class="icon-btn" data-more aria-label="Opcje">${ICON.more}</button>
      </header>
      <div class="stage">
        <canvas></canvas>
        <canvas class="loupe"></canvas>
        <div class="stage-btns">
          <button class="round-btn" data-list aria-label="Lista wymiarów">${ICON.list}</button>
          <button class="round-btn" data-fit aria-label="Dopasuj widok">${ICON.fit}</button>
        </div>
      </div>
      <section class="panel" data-panel></section>
      <nav class="toolbar">
        ${tools.map(([t, l, i]) => `<button class="tool" data-tool="${t}">${i}<span>${l}</span></button>`).join('')}
        <div class="tb-sep"></div>
        <button class="tool sm" data-magnet aria-label="Przyciąganie">${ICON.magnet}<span>Magnes</span></button>
        <button class="tool sm" data-undo aria-label="Cofnij">${ICON.undo}<span>Cofnij</span></button>
        <button class="tool sm" data-redo aria-label="Ponów">${ICON.redo}<span>Ponów</span></button>
      </nav>
    </div>`;
  bindCommon();

  const [canvas, loupe] = app.querySelectorAll('canvas');
  const ed = new Editor(canvas, loupe, p, image, settings);
  const panel = app.querySelector('[data-panel]');
  window.dalmierzEditor = ed; // Debug handle for console and tests.

  let saveTimer = null, thumbTimer = null, deleted = false;
  let tipOpen = false; // full tool tip in the panel
  const save = async () => {
    p.updatedAt = Date.now();
    await db.put('projects', p);
  };
  const saveThumb = async () => {
    try { p.thumb = await makeThumb(p, image); await db.put('projects', p); } catch { /* skip thumb */ }
  };
  ed.addEventListener('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(saveThumb, 2000);
    updateUndo();
  });
  ed.addEventListener('select', () => renderPanel());
  ed.addEventListener('ask-text', async (e) => {
    const t = await ask('Notatka', '', { placeholder: 'np. rura gazowa, pion, gniazdko 30 cm' });
    if (t) ed.addText(e.detail.point, t);
  });
  ed.addEventListener('edit-text', (e) => editText(e.detail.shape));
  ed.addEventListener('edit-value', () => editValue());

  const editText = async (shape) => {
    const t = await ask('Notatka', shape.text);
    if (t) ed.setText(shape, t);
  };

  const editValue = async () => {
    const s = ed.selected();
    if (!s || (s.edge == null && !s.mark)) return;
    const cur = ed.selectedValue();
    const title = s.mark ? `${markName(s.mark)}: ${fieldLabel(s.mark, s.field).toLowerCase()}` : 'Wymiar';
    const txt = await ask(`${title} (${settings.unit})`, cur != null ? fmt(cur, settings.unit) : '', { inputmode: 'decimal', placeholder: settings.unit === 'mm' ? 'np. 2435' : '' });
    if (txt == null) return;
    const mm = parse(txt, settings.unit, { zero: !!s.mark });
    if (mm == null) return toast('Niepoprawna wartość', 'err');
    put(mm);
  };

  const edgeLabel = (shape, i) => shape.edges[i]?.name || `Odcinek ${ed.allEdges().findIndex((x) => x.shape === shape && x.edge === i) + 1}`;
  const targetLabel = (s) => (s.mark ? `${markName(s.mark)}, ${fieldLabel(s.mark, s.field).toLowerCase()}` : edgeLabel(s.shape, s.edge));

  // Put a value in the selected edge or mark field and go to the next one.
  // Toast has "Cofnij": old value back and the same target selected again, so the next reading goes there.
  // Return false when nothing is selected.
  const put = (mm) => {
    const s = ed.selected();
    if (!s || (s.edge == null && !s.mark)) return false;
    const before = { sel: { ...ed.sel }, value: ed.selectedValue(), label: targetLabel(s) };
    const r = ed.setValue(mm, { advance: true });
    const bad = s.edge != null ? rectMismatch(s.shape, s.edge) : null;
    const v = fmt(mm, settings.unit, true);
    const undo = {
      label: 'Cofnij',
      run: () => {
        ed.select(before.sel);
        ed.setValue(before.value);
        toast(`${before.label}: zmierz jeszcze raz`);
      },
    };
    if (bad) {
      toast(`⚠ ${before.label}: ${v}. Ściana naprzeciw różni się o ${fmt(bad.diff, settings.unit, true)}`, 'warn', { action: undo, ms: 7000 });
      if (settings.sound) setTimeout(() => beep(520, 180), 160);
    } else {
      toast(`✓ ${before.label}: ${v}${r === 'done' ? '. Wszystko zmierzone' : ''}`, 'ok', { action: undo });
    }
    return true;
  };

  const setTool = (t) => {
    ed.setTool(t);
    app.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    renderPanel();
  };
  app.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  setTool(ed.tool);

  const magnetBtn = app.querySelector('[data-magnet]');
  magnetBtn.classList.add('on');
  magnetBtn.onclick = () => {
    ed.magnet = !ed.magnet;
    magnetBtn.classList.toggle('on', ed.magnet);
    toast(ed.magnet ? 'Przyciąganie włączone' : 'Przyciąganie wyłączone');
  };
  const undoBtn = app.querySelector('[data-undo]'), redoBtn = app.querySelector('[data-redo]');
  const updateUndo = () => {
    undoBtn.disabled = !ed.undoStack.length;
    redoBtn.disabled = !ed.redoStack.length;
  };
  undoBtn.onclick = () => { ed.undo(); updateUndo(); };
  redoBtn.onclick = () => { ed.redo(); updateUndo(); };
  updateUndo();

  app.querySelector('[data-fit]').onclick = () => ed.fit();
  app.querySelector('[data-list]').onclick = () => showEdgeList(ed);
  // Wall photo opened from its plan: back goes to the plan.
  app.querySelector('[data-back]').onclick = () => go(parent && prevHash === `#/p/${parent.id}` ? prevHash : `#/f/${p.folderId}`);
  ed.addEventListener('open-photo', (e) => openWallPhoto(e.detail.id));

  // Open the wall photo. Link to a deleted project: remove it.
  const openWallPhoto = async (id) => {
    if (await db.get('projects', id)) return go(`#/p/${id}`);
    for (const s of p.shapes) for (let i = 0; i < (s.edges || []).length; i++) if (s.edges[i].photo === id) ed.setWallPhoto(s, i, null);
    toast('Zdjęcie ściany zostało usunięte', 'err');
  };

  // Take a photo of the selected wall. New photo project, linked both ways.
  const addWallPhoto = async (s) => {
    const src = await menu('Zdjęcie ściany', [
      { label: 'Zrób zdjęcie', value: 'camera', icon: ICON.camera, hint: 'Potem zaznacz na nim wymiary' },
      { label: 'Zdjęcie z galerii', value: 'gallery', icon: ICON.image },
    ]);
    if (!src) return;
    const photo = await takePhoto(src === 'camera');
    if (!photo) return;
    const ph = await addProject(f, `${p.name} – ${edgeLabel(s.shape, s.edge)}`, photo, { parent: p.id });
    ed.setWallPhoto(s.shape, s.edge, ph.id);
    clearTimeout(saveTimer);
    await save();
    go(`#/p/${ph.id}`);
  };
  app.querySelector('[data-rename]').onclick = async () => {
    const name = await ask('Nazwa pomiaru', p.name, { suggestions: NAME_HINTS });
    if (name) { p.name = name; app.querySelector('[data-rename]').textContent = name; save(); }
  };
  app.querySelector('[data-more]').onclick = async () => {
    const v = await menu(p.name, [
      { label: 'Eksport PNG z wymiarami', value: 'png' },
      { label: 'Lista wymiarów', value: 'list' },
      { label: `Jednostka: ${settings.unit}`, value: 'unit' },
      { label: 'Usuń pomiar', value: 'delete', danger: true },
    ]);
    if (v === 'png') exportPng(p, image, f);
    if (v === 'list') showEdgeList(ed);
    if (v === 'unit') { await chooseUnit(); ed.draw(); renderPanel(); }
    if (v === 'delete' && (await confirmBox('Usunąć pomiar?', `„${p.name}” zniknie z tego urządzenia.`))) {
      deleted = true; // Cleanup must not save it again.
      clearTimeout(saveTimer);
      clearTimeout(thumbTimer);
      await removeProject(p);
      go(`#/f/${p.folderId}`);
    }
  };

  const onKey = (e) => {
    if (e.target.closest('input, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); updateUndo(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') ed.deleteSelection();
    else if (e.key === 'Escape') ed.select(null);
    else if (e.key === 'm' && settings.sim) ir40.simulate();
  };
  document.addEventListener('keydown', onKey);

  // Panel: context for selection, tool hint and last readings.
  function renderPanel() {
    const s = ed.selected();
    const live = settings.sim || ir40.state === 'connected';
    let html = '';
    // Readings that came when nothing was selected. Tap to put one in.
    const fresh = readings.filter((r) => !r.used && Date.now() - r.t < 10 * 60e3).slice(0, 2);
    const readChips = (s && (s.edge != null || s.mark)) ? fresh.map((r) => `<button class="chip okc" data-read="${readings.indexOf(r)}">Wstaw ${fmt(r.mm, settings.unit, true)}</button>`).join('') : '';
    if (s && s.mark) {
      const K = kindOf(s.mark);
      const fl = fieldLabel(s.mark, s.field).toLowerCase();
      html = `
        <div class="p-row">
          <span class="m-sym" style="background:${K.color}">${K.sym || ''}</span>
          <div class="p-main"><small class="muted">${esc(edgeLabel(s.shape, s.markEdge))}</small><b>${esc(markName(s.mark))}</b></div>
          <div class="p-hint ${live ? 'live' : ''}">${live ? `<span class="pulse"></span>Zmierz: ${esc(fl)}` : 'Stuknij pole, aby wpisać'}</div>
        </div>
        <div class="p-fields">${K.fields.map((f) => `<button class="p-field ${f === s.field ? 'on' : ''} ${s.mark[f] == null ? 'missing' : ''}" data-field="${f}">
          <small>${esc(fieldLabel(s.mark, f))}</small><b>${s.mark[f] != null ? fmt(s.mark[f], settings.unit) : '—'}</b></button>`).join('')}</div>
        ${s.field === 'd' ? '<p class="p-tip small">Mierz od narożnika, z którego idzie przerywana linia.</p>' : ''}
        <div class="p-actions">
          ${readChips}
          <button class="chip" data-flip>⇄ Drugi narożnik</button>
          <button class="chip" data-mark-kind>Typ</button>
          <button class="chip" data-mark-name>${s.mark.name ? '✎ Nazwa' : '+ Nazwa'}</button>
          <button class="chip danger" data-del>Usuń</button>
        </div>`;
    } else if (s && s.shape.type === 'text') {
      html = `<div class="p-row"><div class="p-main"><small>Notatka</small><b>${esc(s.shape.text)}</b></div>
        <button class="btn ghost" data-edit-text>Edytuj</button><button class="btn ghost danger" data-del>Usuń</button></div>`;
    } else if (s && s.edge != null) {
      const e = s.shape.edges[s.edge];
      const idx = ed.allEdges().findIndex((x) => x.shape === s.shape && x.edge === s.edge) + 1;
      const m = s.shape.closed && !ed.photo ? polyMetrics(s.shape) : null;
      html = `
        <div class="p-row">
          <button class="p-value ${e.v ? '' : 'missing'}" data-value>
            <small>${esc(e.name || `Odcinek ${idx}`)}</small>
            <b>${e.v ? fmt(e.v, settings.unit) : '—'}<i>${settings.unit}</i></b>
          </button>
          <div class="p-hint ${live ? 'live' : ''}">${live ? '<span class="pulse"></span>Zmierz dalmierzem' : 'Stuknij liczbę, aby wpisać'}</div>
          ${!ed.photo && s.shape.style !== 'dim' ? `<button class="cam-btn ${e.photo ? 'on' : ''}" data-wall-photo aria-label="Zdjęcie ściany">${ICON.camera}<small>${e.photo ? 'Zdjęcie' : '+ Zdjęcie'}</small></button>` : ''}
        </div>
        <div class="p-actions">
          ${readChips}
          ${parent ? `<button class="chip" data-parent>↩ Rzut</button>` : ''}
          ${!ed.photo && s.shape.style !== 'dim' ? '<button class="chip" data-add-mark>+ Punkt</button>' : ''}
          <button class="chip" data-edge-name>${e.name || s.shape.name ? '✎ Nazwa' : '+ Nazwa'}</button>
          ${!ed.photo && edgeCount(s.shape) > 1 ? '<button class="chip" data-fitshape>Dopasuj</button>' : ''}
          <button class="chip danger icon" data-delmenu aria-label="Usuń">${ICON.trash}</button>
        </div>
        ${m ? `<div class="p-metrics">Pole <b>${m.approx ? '≈ ' : ''}${fmtArea(m.area)}</b> · Obwód <b>${fmt(m.perimeter, settings.unit, true)}</b>
          ${warnings(s.shape, m)}</div>` : ''}`;
    } else {
      // Short tip in one line. Tap it to see the full text.
      const tips = {
        hand: ['Przeciągnij: przesuń widok lub kształt', 'Przeciągnij, aby przesunąć widok. Zaznacz kształt, potem przeciągnij go albo jego punkt.'],
        line: ['Przeciągnij palcem, aby narysować ścianę', 'Zacznij od końca linii, aby rysować dalej. Połącz z początkiem, aby zamknąć pomieszczenie.'],
        rect: ['Przeciągnij po skosie: prostokąt', 'Potem przesuń rogi.'],
        dim: ['Przeciągnij: linia wymiaru', 'Np. wysokość okna albo przekątna.'],
        text: ['Stuknij w rysunek, aby dodać notatkę', ''],
      };
      const [short, more] = tips[ed.tool];
      const recent = readings.slice(0, 4);
      html = `${parent ? `<div class="p-actions top"><button class="chip" data-parent>↩ Rzut: ${esc(parent.name)}</button></div>` : ''}
        <button class="p-tip one ${tipOpen ? 'open' : ''}" data-tip><span>${short}${tipOpen ? `. ${more ? `${more} ` : ''}Dwa palce: przesuń i powiększ.` : ''}</span><i>${tipOpen ? '×' : 'i'}</i></button>
        ${recent.length ? `<div class="p-actions"><small class="muted">Odczyty:</small>${recent.map((r) => `<span class="chip ghost">${fmt(r.mm, settings.unit, true)}</span>`).join('')}</div>` : ''}`;
    }
    panel.innerHTML = html;
    panel.querySelector('[data-value]')?.addEventListener('click', editValue);
    panel.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', () => {
      const r = readings[+b.dataset.read];
      if (!r) return;
      r.used = true;
      if (!put(r.mm)) r.used = false;
    }));
    panel.querySelectorAll('[data-field]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.field === s.field) editValue();
      else ed.selectMark(s.mark, b.dataset.field);
    }));
    panel.querySelector('[data-add-mark]')?.addEventListener('click', async () => {
      const k = await chooseMarkKind('Punkt na ścianie');
      if (k) ed.addMark(k);
    });
    panel.querySelector('[data-wall-photo]')?.addEventListener('click', () => {
      const id = s.shape.edges[s.edge].photo;
      if (id) openWallPhoto(id);
      else addWallPhoto(s);
    });
    panel.querySelector('[data-parent]')?.addEventListener('click', () => go(`#/p/${parent.id}`));
    panel.querySelector('[data-flip]')?.addEventListener('click', () => ed.flipMark());
    panel.querySelector('[data-mark-kind]')?.addEventListener('click', async () => {
      const k = await chooseMarkKind('Typ punktu');
      if (k) ed.updateMark((mk) => { mk.kind = k; });
    });
    panel.querySelector('[data-mark-name]')?.addEventListener('click', async () => {
      const n = await ask('Nazwa punktu', s.mark.name || '', { placeholder: 'np. okap, zmywarka, gniazdko podwójne', suggestions: ['Okap', 'Zmywarka', 'Lodówka', 'Płyta', 'Piekarnik', 'Podwójne'] });
      if (n != null) ed.updateMark((mk) => { mk.name = n; });
    });
    panel.querySelector('[data-del]')?.addEventListener('click', () => ed.deleteSelection());
    panel.querySelector('[data-delmenu]')?.addEventListener('click', async () => {
      const multi = edgeCount(s.shape) > 1;
      const v = await menu(null, [
        ...(s.shape.edges[s.edge].v ? [{ label: 'Wyczyść wymiar', value: 'clear' }] : []),
        { label: multi ? 'Usuń ten odcinek' : 'Usuń linię', value: 'edge', danger: true },
        ...(multi ? [{ label: 'Usuń cały kształt', value: 'shape', danger: true }] : []),
      ]);
      if (v === 'clear') ed.setValue(null);
      if (v === 'edge') ed.deleteSelection();
      if (v === 'shape') ed.deleteShape();
    });
    panel.querySelector('[data-edit-text]')?.addEventListener('click', () => editText(s.shape));
    panel.querySelector('[data-tip]')?.addEventListener('click', () => { tipOpen = !tipOpen; renderPanel(); });
    // One chip for both names: wall name and shape (room) name.
    panel.querySelector('[data-edge-name]')?.addEventListener('click', async () => {
      const e = s.shape.edges[s.edge];
      let what = 'edge';
      if (!ed.photo && edgeCount(s.shape) > 1) {
        what = await menu('Nazwa', [
          { label: 'Nazwa ściany', value: 'edge', hint: e.name || 'brak' },
          { label: 'Nazwa pomieszczenia', value: 'shape', hint: s.shape.name || 'brak' },
        ]);
      }
      if (what === 'edge') {
        const n = await ask('Nazwa odcinka', e.name, { placeholder: 'np. ściana z oknem', suggestions: ['Szerokość', 'Wysokość', 'Głębokość', 'Okno', 'Drzwi', 'Wnęka', 'Przekątna'] });
        if (n != null) ed.renameEdge(n);
      } else if (what === 'shape') {
        const n = await ask('Nazwa pomieszczenia', s.shape.name || '', { placeholder: 'np. Kuchnia', suggestions: NAME_HINTS });
        if (n != null) ed.renameShape(n);
      }
    });
    panel.querySelector('[data-fitshape]')?.addEventListener('click', () => {
      if (ed.fitSelectedShape()) toast('Kształt dopasowany do wymiarów', 'ok');
      else toast('Najpierw zmierz co najmniej jeden odcinek', 'err');
    });
    requestAnimationFrame(() => ed.resize());
  }

  // Warnings for a closed shape. Rectangle: compare opposite walls. Other shapes: closure gap.
  function warnings(shape, m) {
    const pairs = rectPairs(shape);
    if (pairs) {
      const bad = pairs.filter((x) => x.diff > RECT_TOL);
      return bad.length ? `<span class="warn">⚠ Ściany naprzeciw różnią się: ${bad.map((x) => `${esc(edgeLabel(shape, x.i))} / ${esc(edgeLabel(shape, x.j))} o ${fmt(x.diff, settings.unit, true)}`).join(', ')}</span>` : '';
    }
    return !m.approx && m.gap > Math.max(10, m.perimeter * 0.005)
      ? `<span class="warn">⚠ Wymiary nie domykają się o ${fmt(m.gap, settings.unit, true)}. Sprawdź kąty.</span>` : '';
  }

  screen = {
    name: 'editor',
    onMeasure: (mm) => {
      if (put(mm)) return true;
      toast(`Odczyt ${fmt(mm, settings.unit, true)}. Zaznacz odcinek, aby go wstawić.`);
      setTimeout(renderPanel);
      return false;
    },
    cleanup: () => {
      clearTimeout(saveTimer);
      document.removeEventListener('keydown', onKey);
      ed.destroy();
      lock?.release?.().catch(() => {});
      lock = null;
      if (deleted) return;
      // Save last state and thumb. No wait: next screen loads in parallel.
      p.updatedAt = Date.now();
      makeThumb(p, image).then((t) => { p.thumb = t; }).catch(() => {}).finally(() => db.put('projects', p));
      if (f) { f.updatedAt = Date.now(); db.put('folders', f); }
    },
  };
  wakeLock();
  // Start in measure flow: select first edge without value.
  const first = ed.nextMissing();
  if (first && p.shapes.length) ed.select({ id: first.shape.id, edge: first.edge });
  // Fit after the panel has its final height.
  requestAnimationFrame(() => requestAnimationFrame(() => { ed.resize(); ed.fit(); }));
}

function showEdgeList(ed) {
  const rows = [];
  let n = 0;
  for (const s of ed.shapes) {
    const cnt = edgeCount(s);
    if (!cnt) continue;
    const m = s.closed && !ed.photo ? polyMetrics(s) : null;
    rows.push(`<li class="list-head">${esc(s.name || (s.style === 'dim' ? 'Wymiar' : cnt > 1 ? 'Kształt' : 'Linia'))}${m ? ` · ${m.approx ? '≈ ' : ''}${fmtArea(m.area)}` : ''}</li>`);
    for (let i = 0; i < cnt; i++) {
      n++;
      const e = s.edges[i];
      const bad = rectMismatch(s, i);
      rows.push(`<li><button class="list-row" data-s="${s.id}" data-e="${i}"><span>${n}. ${esc(e.name || 'Odcinek')}</span><b class="${e.v && !bad ? '' : 'warn'}">${bad ? '⚠ ' : ''}${e.v ? fmt(e.v, settings.unit, true) : 'brak'}</b></button></li>`);
      for (const mk of marksOf(s, i)) {
        const vals = kindOf(mk).fields.map((f) => `${fieldLabel(mk, f).toLowerCase()} ${mk[f] != null ? fmt(mk[f], settings.unit) : '?'}`).join(' · ');
        rows.push(`<li><button class="list-row sub" data-m="${mk.id}"><span>${esc(markName(mk))}<small>${esc(vals)}</small></span></button></li>`);
      }
    }
  }
  const m = sheet(`<div class="form"><h3>Wymiary</h3>${rows.length ? `<ul class="list">${rows.join('')}</ul>` : '<p class="muted">Brak odcinków.</p>'}
    <button class="btn ghost wide" data-x>Zamknij</button></div>`);
  m.el.querySelector('[data-x]').onclick = () => m.close();
  m.el.querySelectorAll('.list-row[data-m]').forEach((b) => (b.onclick = () => {
    const mk = ed.shapes.flatMap((s) => s.edges || []).flatMap((e) => e.marks || []).find((x) => x.id === b.dataset.m);
    if (mk) ed.selectMark(mk);
    m.close();
  }));
  m.el.querySelectorAll('.list-row[data-s]').forEach((b) => (b.onclick = () => {
    ed.select({ id: b.dataset.s, edge: +b.dataset.e });
    ed.reveal({ shape: ed.shapes.find((s) => s.id === b.dataset.s), edge: +b.dataset.e });
    m.close();
  }));
}

// ---------- render to image ----------
async function makeThumb(p, image) {
  const W = 360, H = 270;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const box = p.kind === 'photo' && image ? { x0: 0, y0: 0, x1: image.width, y1: image.height } : bounds(p.shapes);
  if (!box) return null;
  const view = fitView(box, W, H, p.kind === 'photo' ? 0 : 24);
  if (p.kind === 'photo') {
    // Fill tile: crop photo to tile ratio.
    const k = Math.max(W / image.width, H / image.height);
    Object.assign(view, { scale: k, ox: (W - image.width * k) / 2, oy: (H - image.height * k) / 2 });
  }
  render(c.getContext('2d'), W, H, p.shapes, view, { ui: 0.7, unit: settings.unit, photo: p.kind === 'photo', image, grid: false, showArea: false });
  return toBlob(c, 'image/jpeg', 0.8);
}

async function exportPng(p, image, f) {
  const photo = p.kind === 'photo' && image;
  let W, H, view, ui;
  const header = (w) => Math.round(w * 0.075);
  if (photo) {
    W = image.width;
    ui = Math.max(1.2, Math.max(image.width, image.height) / 850);
    const hh = header(W);
    H = image.height + hh;
    view = { scale: 1, ox: 0, oy: hh };
  } else {
    const b = bounds(p.shapes);
    if (!b) return toast('Pusty rysunek', 'err');
    W = 2400;
    ui = 3.4; // Labels stay readable when the image is shown small on a phone.
    const pad = 180; // Room for edge value and name pills outside the walls.
    const bw = Math.max(b.x1 - b.x0, 1), bh = Math.max(b.y1 - b.y0, 1);
    const scale = (W - pad * 2) / bw;
    const hh = header(W);
    H = Math.min(4000, Math.round(bh * scale + pad * 2 + hh));
    const s2 = Math.min(scale, (H - hh - pad * 2) / bh);
    view = { scale: s2, ox: (W - bw * s2) / 2 - b.x0 * s2, oy: hh + pad - b.y0 * s2 };
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  render(ctx, W, H, p.shapes, view, { ui, unit: settings.unit, photo: !!photo, image, grid: !photo, showArea: !photo });
  // Header band with name, folder, date, unit.
  const hh = header(W);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, hh);
  ctx.fillStyle = '#1f2a37';
  ctx.font = `700 ${hh * 0.36}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(p.name, hh * 0.35, hh * 0.38);
  ctx.fillStyle = '#5b6675';
  ctx.font = `500 ${hh * 0.2}px -apple-system, system-ui, sans-serif`;
  // Legend for point symbols that are on the drawing.
  const used = new Set(p.shapes.flatMap((s) => s.edges || []).flatMap((e) => e.marks || []).map((mk) => kindOf(mk)).filter((K) => K.sym));
  const legend = [...used].map((K) => `${K.sym} ${K.label.toLowerCase()}`).join(', ');
  ctx.fillText(`${f?.name || ''} · ${fmtDate(Date.now())} · wymiary w ${settings.unit}${legend ? ` · ↑ od podłogi · ${legend}` : ''}`, hh * 0.35, hh * 0.74);
  ctx.fillStyle = '#e3e8ee';
  ctx.fillRect(0, hh - 2, W, 2);
  const blob = await toBlob(c, 'image/png');
  await shareFile(blob, `${slug(p.name)}.png`, p.name);
}

async function chooseMarkKind(title) {
  return menu(title, Object.entries(MARK_KINDS).map(([k, K]) => ({
    value: k,
    label: K.label,
    icon: `<span class="m-sym ${K.span ? 'span' : ''}" style="background:${K.color}">${K.sym || ''}</span>`,
    hint: K.fields.map((f) => fieldLabel({ kind: k }, f).toLowerCase()).join(', '),
  })));
}

// ---------- settings ----------
async function chooseUnit() {
  const u = await menu('Jednostka wymiarów', [
    { label: 'Milimetry (mm)', value: 'mm', hint: '2435' },
    { label: 'Centymetry (cm)', value: 'cm', hint: '243,5' },
    { label: 'Metry (m)', value: 'm', hint: '2,435' },
  ]);
  if (u) { settings.unit = u; await saveSettings(); updateBleUi(); }
}

async function showSettings() {
  const info = await db.storageInfo();
  const mb = (b) => (b / 1024 / 1024).toFixed(1).replace('.', ',');
  const m = sheet(`<div class="form">
    <h3>Ustawienia</h3>
    <div class="menu">
      <button class="menu-item" data-unit><span class="mi-text">Jednostka<small>${settings.unit}</small></span></button>
      <button class="menu-item" data-sound><span class="mi-text">Dźwięk po pomiarze<small>${settings.sound ? 'włączony' : 'wyłączony'}</small></span></button>
      <button class="menu-item" data-sim><span class="mi-text">Tryb testowy (bez dalmierza)<small>${settings.sim ? 'włączony' : 'wyłączony'}</small></span></button>
      <button class="menu-item" data-backup><span class="mi-text">Kopia zapasowa wszystkiego<small>Plik .json ze zdjęciami. Zapisz w Plikach / iCloud.</small></span></button>
      <button class="menu-item" data-import><span class="mi-text">Wczytaj kopię zapasową</span></button>
      <button class="menu-item" data-update><span class="mi-text">Sprawdź aktualizację<small>Wersja ${APP_VERSION}</small></span></button>
      <button class="menu-item" data-log><span class="mi-text">Log Bluetooth<small>Ostatnie pakiety z dalmierza</small></span></button>
    </div>
    <p class="muted small">Dane są tylko na tym urządzeniu (IndexedDB).
      ${info ? `Zajęte: ${mb(info.usage)} MB. Trwałe przechowywanie: ${info.persisted ? 'tak' : 'nie (rób kopie zapasowe)'}.` : ''}</p>
    <button class="btn ghost wide" data-x>Zamknij</button></div>`);
  const $m = (s) => m.el.querySelector(s);
  $m('[data-x]').onclick = () => m.close();
  $m('[data-update]').onclick = () => { m.close(); checkUpdate(true); };
  $m('[data-unit]').onclick = async () => { m.close(); await chooseUnit(); route(); };
  $m('[data-sound]').onclick = async () => { settings.sound = !settings.sound; await saveSettings(); m.close(); showSettings(); };
  $m('[data-sim]').onclick = async () => { settings.sim = !settings.sim; await saveSettings(); m.close(); route(); };
  $m('[data-backup]').onclick = async () => {
    m.close();
    const blob = await exportBackup();
    await shareFile(blob, `dalmierz-${new Date().toISOString().slice(0, 10)}.dalmierz.json`, 'Kopia zapasowa');
  };
  $m('[data-import]').onclick = async () => {
    m.close();
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const n = await importBackup(file);
      toast(`Wczytano katalogi: ${n}`, 'ok');
      route();
    } catch (e) { toast(e.message, 'err'); }
  };
  $m('[data-log]').onclick = () => {
    m.close();
    const rows = ir40.log.map((l) => `<li><small>${new Date(l.t).toLocaleTimeString('pl-PL')}</small> <code>${l.hex}</code></li>`).join('');
    const s2 = sheet(`<div class="form"><h3>Log Bluetooth</h3><p class="muted small">Stan: ${ir40.state}${ir40.device ? ` · ${esc(ir40.device.name || '')}` : ''}</p>
      <ul class="log">${rows || '<li class="muted">Brak pakietów</li>'}</ul><button class="btn ghost wide" data-x>Zamknij</button></div>`);
    s2.el.querySelector('[data-x]').onclick = () => s2.close();
  };
}

// ---------- misc ----------
function bindCommon() {
  app.querySelectorAll('[data-ble]').forEach((b) => (b.onclick = onBleTap));
  updateBleUi();
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pomiar';
}

boot();
