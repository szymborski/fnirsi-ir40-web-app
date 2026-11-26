// Unit format. All values are stored in mm.

export const UNITS = { mm: 'mm', cm: 'cm', m: 'm' };

export function fmt(mm, unit = 'mm', withUnit = false) {
  if (mm == null || Number.isNaN(mm)) return '—';
  let s;
  if (unit === 'cm') s = (mm / 10).toFixed(1);
  else if (unit === 'm') s = (mm / 1000).toFixed(3);
  else s = String(Math.round(mm));
  s = s.replace('.', ',');
  return withUnit ? `${s} ${unit}` : s;
}

// Parse user text in the given unit. Accept comma or dot. Return mm or null.
export function parse(text, unit = 'mm') {
  const v = parseFloat(String(text).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  if (unit === 'cm') return Math.round(v * 10);
  if (unit === 'm') return Math.round(v * 1000);
  return Math.round(v);
}

export const fmtArea = (m2) => `${m2.toFixed(2).replace('.', ',')} m²`;

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
