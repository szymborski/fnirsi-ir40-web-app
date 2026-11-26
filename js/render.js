// Scene render. Used by editor, loupe, thumbnails and PNG export.
import { edgeCount, edgePts, dist, mid, polyMetrics, centroid, signedArea, marksOf, markGeom, rectMismatch } from './geometry.js';
import { kindOf } from './marks.js';
import { fmt, fmtArea } from './format.js';

const C = {
  wall: '#1f2a37', wallPhoto: '#ffd60a',
  dim: '#0a84ff', dimPhoto: '#40c8ff',
  sel: '#ff375f', next: '#ff9f0a', bad: '#c2410c',
  label: '#ffffff', labelBg: '#1f2a37', missingBg: '#ff9f0a',
  grid: '#e7ebf0', gridMajor: '#d3d9e1',
};

// view = { scale, ox, oy }  screen = world * scale + o
// opt = { ui (px multiplier), unit, photo (bool), image, sel: {id, edge}, grid, guides, draft, showArea,
//         links (bool: draw wall photo buttons) }
// Return tap targets in screen px: [{ x, y, r, photo: projectId }].
export function render(ctx, w, h, shapes, view, opt) {
  const targets = [];
  const ui = opt.ui || 1;
  const S = (p) => [p[0] * view.scale + view.ox, p[1] * view.scale + view.oy];
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (opt.photo && opt.image) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(opt.image, view.ox, view.oy, opt.image.width * view.scale, opt.image.height * view.scale);
  } else {
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, 0, w, h);
    if (opt.grid !== false) drawGrid(ctx, w, h, view, ui);
  }

  const wallColor = opt.photo ? C.wallPhoto : C.wall;
  const dimColor = opt.photo ? C.dimPhoto : C.dim;
  const labels = [];
  const marks = [];

  for (const s of shapes) {
    if (s.type !== 'poly') continue;
    const isSel = opt.sel?.id === s.id;
    const isDim = s.style === 'dim';
    const pts = s.pts.map(S);
    const lw = (isDim ? 2 : opt.photo ? 3 : 3.5) * ui;

    // Dark outline on photo. Line stays visible on any background.
    if (opt.photo) strokePath(ctx, pts, s.closed, lw + 3 * ui, 'rgba(0,0,0,0.55)');
    strokePath(ctx, pts, s.closed, lw, isDim ? dimColor : wallColor, isDim && !opt.photo ? [] : null);

    if (isDim) for (let i = 0; i < pts.length; i++) drawTick(ctx, pts, i, dimColor, ui);

    for (let i = 0; i < (s.draft ? 0 : edgeCount(s)); i++) {
      const [a, b] = edgePts(s, i);
      const sa = S(a), sb = S(b);
      const edgeSel = isSel && opt.sel.edge === i;
      if (edgeSel) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        line(ctx, sa, sb, lw + 10 * ui, C.sel);
        ctx.restore();
        line(ctx, sa, sb, lw, C.sel);
      }
      const e = s.edges[i] || {};
      const lenPx = dist(sa, sb);
      if (lenPx < 18 * ui && !edgeSel) continue;
      let outward = 1;
      if (s.closed) outward = signedArea(s.pts) > 0 ? -1 : 1;
      const bad = !!(e.v && rectMismatch(s, i)); // Opposite wall of a rectangle differs.
      const text = e.v ? `${bad ? '⚠ ' : ''}${fmt(e.v, opt.unit)}` : edgeSel ? '…' : '?';
      const sub = e.name || '';
      labels.push({ a: sa, b: sb, text, sub, missing: !e.v, sel: edgeSel, outward, isDim, bad, wallPhoto: opt.links ? e.photo : null });
    }
    if (!s.draft) for (let i = 0; i < edgeCount(s); i++) if (marksOf(s, i).length) marks.push([s, i]);

    // Vertex handles for selected shape.
    if (isSel) {
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 7 * ui, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2.5 * ui;
        ctx.strokeStyle = C.sel;
        ctx.stroke();
      }
    } else if (!isDim) {
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.5 * ui, 0, Math.PI * 2);
        ctx.fillStyle = wallColor;
        ctx.fill();
      }
    }

    if (s.closed && opt.showArea) {
      const m = polyMetrics(s);
      if (m) {
        const c = S(centroid(s.pts));
        pill(ctx, c[0], c[1], (m.approx ? '≈ ' : '') + fmtArea(m.area), 0, ui, 'rgba(31,42,55,0.08)', '#1f2a37', 15, true);
        if (s.name) pill(ctx, c[0], c[1] - 24 * ui, s.name, 0, ui, 'transparent', '#5b6675', 13, false);
      }
    }
  }

  for (const L of labels) drawEdgeLabel(ctx, L, ui, opt.photo, targets);
  for (const [s, i] of marks) drawEdgeMarks(ctx, s, i, S, opt, ui);

  for (const s of shapes) {
    if (s.type !== 'text') continue;
    const p = S([s.x, s.y]);
    const isSel = opt.sel?.id === s.id;
    pill(ctx, p[0], p[1], s.text, 0, ui, isSel ? C.sel : opt.photo ? 'rgba(255,255,255,0.92)' : '#fff3c4', isSel ? '#fff' : '#3a3000', 14, false, true);
  }

  // Snap guides and draft line while drawing.
  if (opt.guides) {
    ctx.save();
    ctx.setLineDash([6 * ui, 6 * ui]);
    for (const [a, b] of opt.guides) line(ctx, S(a), S(b), 1.5 * ui, '#30d158');
    ctx.restore();
  }
  if (opt.snapPoint) {
    const p = S(opt.snapPoint);
    ctx.beginPath();
    ctx.arc(p[0], p[1], 10 * ui, 0, Math.PI * 2);
    ctx.strokeStyle = '#30d158';
    ctx.lineWidth = 3 * ui;
    ctx.stroke();
  }
  ctx.restore();
  return targets;
}

// Wall marks of one edge. Running dimensions from the corner: one dashed line per corner,
// a tick at each mark and a short text across the wall ("1250 ↑520" = 1250 from corner, 520 above floor).
// Symbol (point) or band (opening) sits on the wall. Openings also get a pill with name and size.
function drawEdgeMarks(ctx, s, i, S, opt, ui) {
  const list = marksOf(s, i);
  if (!list.length) return;
  const [a, b] = edgePts(s, i);
  const sa = S(a), sb = S(b);
  let nx = -(sb[1] - sa[1]), ny = sb[0] - sa[0];
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl; ny /= nl;
  const outward = s.closed ? (signedArea(s.pts) > 0 ? -1 : 1) : 1;
  const ix = -nx * outward, iy = -ny * outward; // Into the room.
  const off = (p, o) => [p[0] + ix * o, p[1] + iy * o];
  let ang = Math.atan2(sb[1] - sa[1], sb[0] - sa[0]);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  const f = (v) => (v != null ? fmt(v, opt.unit) : '?');
  const items = list.map((m) => {
    const K = kindOf(m);
    const g = markGeom(s, i, m, opt.photo, K.span);
    const sel = opt.sel?.mark === m.id;
    return { m, K, g, sel, color: sel ? C.sel : K.color, show: m.d != null || sel };
  });

  // Dashed line from each used corner to the farthest mark.
  for (const from of [0, 1]) {
    const grp = items.filter((it) => (it.m.from === 1 ? 1 : 0) === from && it.show);
    if (!grp.length) continue;
    const o = (from ? 22 : 12) * ui;
    const c = S(grp[0].g.corner);
    const far = grp.reduce((x, y) => (dist(S(y.g.a0), c) > dist(S(x.g.a0), c) ? y : x));
    ctx.save();
    ctx.setLineDash([5 * ui, 4 * ui]);
    line(ctx, off(c, o), off(S(far.g.a0), o), 1.5 * ui, grp.some((it) => it.sel) ? C.sel : '#8a94a3');
    ctx.restore();
    line(ctx, off(c, o - 5 * ui), off(c, o + 5 * ui), 1.5 * ui, '#8a94a3');
    for (const it of grp) {
      const p = S(it.g.a0);
      line(ctx, off(p, o - 5 * ui), off(p, o + 5 * ui), 2 * ui, it.color);
      const parts = [f(it.m.d)];
      if (!it.K.span && it.K.fields.includes('z')) parts.push(`↑${f(it.m.z)}`);
      if (!it.K.span && it.m.name) parts.push(it.m.name);
      acrossText(ctx, off(p, o + 7 * ui), ix, iy, parts.join(' '), it.sel ? C.sel : '#1f2a37', ui, opt.photo);
    }
  }

  for (const it of items) {
    const p0 = S(it.g.a0), p1 = S(it.g.a1);
    if (it.K.span) {
      line(ctx, p0, p1, 9 * ui, it.color);
      line(ctx, p0, p1, 3 * ui, '#fff');
      const parts = [it.m.name || it.K.label];
      if (it.m.w != null || it.m.h != null) parts.push(it.K.fields.includes('h') ? `${f(it.m.w)}×${f(it.m.h)}` : f(it.m.w));
      if (it.K.fields.includes('z') && it.m.z != null) parts.push(`↑${f(it.m.z)}`);
      const [x, y] = off(S(it.g.c), 56 * ui);
      pill(ctx, x, y, parts.join(' '), ang, ui, opt.photo ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.94)', opt.photo ? '#fff' : it.sel ? C.sel : '#1f2a37', 11, false, true);
    } else {
      ctx.beginPath();
      ctx.arc(p0[0], p0[1], 8.5 * ui, 0, Math.PI * 2);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.lineWidth = 2 * ui;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${(it.K.sym.length > 1 ? 7.5 : 10) * ui}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.K.sym, p0[0], p0[1] + 0.5 * ui);
    }
  }
}

// Text that starts at p and goes in direction (dx, dy), never upside down. Halo keeps it readable on lines.
function acrossText(ctx, p, dx, dy, text, color, ui, photo) {
  let ang = Math.atan2(dy, dx);
  let align = 'left';
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) { ang += Math.PI; align = 'right'; }
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(ang);
  ctx.font = `700 ${11 * ui}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5 * ui;
  ctx.strokeStyle = photo ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = photo ? '#fff' : color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawGrid(ctx, w, h, view, ui) {
  // Pick grid step so cells are 20..100 px on screen. World unit ~ mm.
  const steps = [10, 50, 100, 500, 1000, 5000, 10000];
  let step = steps.find((s) => s * view.scale >= 22 * ui) || 10000;
  const major = step * 5;
  const x0 = -view.ox / view.scale, y0 = -view.oy / view.scale;
  const x1 = x0 + w / view.scale, y1 = y0 + h / view.scale;
  for (const [st, color] of [[step, C.grid], [major, C.gridMajor]]) {
    ctx.beginPath();
    for (let x = Math.floor(x0 / st) * st; x <= x1; x += st) {
      const sx = Math.round(x * view.scale + view.ox) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(y0 / st) * st; y <= y1; y += st) {
      const sy = Math.round(y * view.scale + view.oy) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function strokePath(ctx, pts, closed, lw, color) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

function line(ctx, a, b, lw, color) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

// End tick, perpendicular to the dimension line.
function drawTick(ctx, pts, i, color, ui) {
  const p = pts[i];
  const q = pts[i === 0 ? 1 : i - 1];
  const l = dist(p, q) || 1;
  const nx = -(q[1] - p[1]) / l, ny = (q[0] - p[0]) / l;
  const k = 9 * ui;
  line(ctx, [p[0] - nx * k, p[1] - ny * k], [p[0] + nx * k, p[1] + ny * k], 2.5 * ui, color);
}

function drawEdgeLabel(ctx, L, ui, photo, targets) {
  const { a, b } = L;
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  let nx = -(b[1] - a[1]), ny = b[0] - a[0];
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl; ny /= nl;
  // Text must not be upside down.
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  const m = mid(a, b);
  const off = (L.isDim ? 0 : 16) * ui * L.outward;
  const x = m[0] + nx * off, y = m[1] + ny * off;
  const bg = L.sel ? C.sel : L.missing ? C.missingBg : L.bad ? C.bad : photo ? 'rgba(0,0,0,0.75)' : C.labelBg;
  const size = L.missing && !L.sel ? 12 : 14;
  const w = pill(ctx, x, y, L.text, ang, ui, bg, C.label, size, true);
  // Wall photo: camera button after the value pill. Tap opens the photo.
  if (L.wallPhoto) {
    const k = w / 2 + 17 * ui;
    const cx = x + Math.cos(ang) * k, cy = y + Math.sin(ang) * k;
    drawCamera(ctx, cx, cy, ui);
    targets.push({ x: cx, y: cy, r: 16 * ui, photo: L.wallPhoto });
  }
  if (L.sub) {
    const k = -22 * ui; // Name pill sits beside the value pill, not on it.
    const sx = x - Math.sin(ang) * k, sy = y + Math.cos(ang) * k;
    pill(ctx, sx, sy, L.sub, ang, ui, photo ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)', photo ? '#fff' : '#5b6675', 11, false);
  }
}

function pill(ctx, x, y, text, ang, ui, bg, fg, size, bold, shadow) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.font = `${bold ? 700 : 500} ${size * ui}px -apple-system, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 12 * ui;
  const h = (size + 9) * ui;
  if (bg !== 'transparent') {
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 6 * ui; ctx.shadowOffsetY = 2 * ui; }
    ctx.fillStyle = bg;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5 * ui);
  ctx.restore();
  return w;
}

function drawCamera(ctx, x, y, ui) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 5 * ui;
  ctx.beginPath();
  ctx.arc(0, 0, 13 * ui, 0, Math.PI * 2);
  ctx.fillStyle = '#0a84ff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6 * ui;
  ctx.lineJoin = 'round';
  roundRect(ctx, -7 * ui, -4 * ui, 14 * ui, 10 * ui, 2 * ui);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3 * ui, -4 * ui); ctx.lineTo(-2 * ui, -6.5 * ui); ctx.lineTo(2 * ui, -6.5 * ui); ctx.lineTo(3 * ui, -4 * ui);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 1 * ui, 2.6 * ui, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Fit view to content box with padding (px).
export function fitView(box, w, h, pad) {
  const bw = Math.max(box.x1 - box.x0, 1), bh = Math.max(box.y1 - box.y0, 1);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { scale, ox: (w - bw * scale) / 2 - box.x0 * scale, oy: (h - bh * scale) / 2 - box.y0 * scale };
}
