// Small UI helpers: toast, modal sheet, prompt, confirm, action menu.
import { esc } from './format.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
// action = { label, run }: button in the toast (for example "Cofnij"). It stays longer.
export function toast(text, kind = '', { action, ms } = {}) {
  let el = $('#toast');
  if (!el) {
    el = h('<div id="toast" role="status"></div>');
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = h(`<button type="button" class="toast-btn">${esc(action.label)}</button>`);
    b.onclick = () => { el.className = ''; clearTimeout(toastTimer); action.run(); };
    el.append(b);
  }
  el.className = `show ${kind} ${action ? 'has-action' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), ms || (action ? 5000 : 2400));
}

// Bottom sheet modal. Return { el, close }. onClose runs once.
export function sheet(inner, { onClose } = {}) {
  const wrap = h(`<div class="modal"><div class="modal-bg"></div><div class="modal-card">${inner}</div></div>`);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = (v) => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 200);
    onClose?.(v);
  };
  wrap.querySelector('.modal-bg').addEventListener('click', () => close(null));
  return { el: wrap, close };
}

// Text prompt. Resolve with string or null.
export function ask(title, value = '', { placeholder = '', ok = 'Zapisz', inputmode = 'text', suggestions = [] } = {}) {
  return new Promise((resolve) => {
    const chips = suggestions.map((s) => `<button type="button" class="chip" data-v="${esc(s)}">${esc(s)}</button>`).join('');
    const m = sheet(
      `<form class="form">
        <h3>${esc(title)}</h3>
        <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${inputmode}" autocomplete="off" enterkeyhint="done">
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        <div class="row"><button type="button" class="btn ghost" data-x>Anuluj</button><button class="btn primary">${esc(ok)}</button></div>
      </form>`,
      { onClose: resolve },
    );
    const form = m.el.querySelector('form');
    const input = form.v;
    setTimeout(() => { input.focus(); input.select(); }, 60);
    form.addEventListener('submit', (e) => { e.preventDefault(); m.close(input.value.trim() || null); });
    form.querySelector('[data-x]').addEventListener('click', () => m.close(null));
    form.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => m.close(c.dataset.v)));
  });
}

export function confirmBox(title, text, { ok = 'Usuń', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = sheet(
      `<div class="form"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
       <div class="row"><button class="btn ghost" data-x>Anuluj</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div></div>`,
      { onClose: (v) => resolve(!!v) },
    );
    m.el.querySelector('[data-x]').addEventListener('click', () => m.close(false));
    m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  });
}

// Action list. items: [{ label, icon, value, danger, hint }]. Resolve with value or null.
export function menu(title, items) {
  return new Promise((resolve) => {
    const list = items
      .map((it, i) => `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">
        <span class="mi-icon">${it.icon || ''}</span><span class="mi-text">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span></button>`)
      .join('');
    const m = sheet(`<div class="form">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="menu">${list}</div>
      <button class="btn ghost wide" data-x>Anuluj</button></div>`, { onClose: resolve });
    m.el.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('click', () => m.close(items[+b.dataset.i].value)));
    m.el.querySelector('[data-x]').addEventListener('click', () => m.close(null));
  });
}

// Short beep. Confirm reading without look at the phone.
let audio;
export function beep(freq = 1320, ms = 70) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio */ }
}

// Share a file. Fallback: download link, then overlay for long-press save.
export async function shareFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  if (blob.type.startsWith('image/')) {
    const m = sheet(`<div class="form"><h3>${esc(title)}</h3><p class="muted">Przytrzymaj obraz, aby go zapisać lub udostępnić.</p>
      <img class="preview" src="${url}" alt=""><a class="btn primary wide" href="${url}" download="${esc(filename)}">Pobierz</a></div>`,
      { onClose: () => URL.revokeObjectURL(url) });
    return m;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
