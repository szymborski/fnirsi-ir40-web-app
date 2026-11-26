// Scene render. Used by editor, loupe, thumbnails and PNG export.
import { edgeCount, edgePts, dist, mid, polyMetrics, centroid, signedArea } from './geometry.js';
import { fmt, fmtArea } from './format.js';

const C = {
  wall: '#1f2a37', wallPhoto: '#ffd60a',
  dim: '#0a84ff', dimPhoto: '#40c8ff',
  sel: '#ff375f', next: '#ff9f0a',
  label: '#ffffff', labelBg: '#1f2a37', missingBg: '#ff9f0a',
  grid: '#e7ebf0', gridMajor: '#d3d9e1',
};

// view = { scale, ox, oy }  screen = world * scale + o
// opt = { ui (px multiplier), unit, photo (bool), image, sel: {id, edge}, grid, guides, draft, showArea }
export function render(ctx, w, h, shapes, view, opt) {
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
      const text = e.v ? fmt(e.v, opt.unit) : edgeSel ? '…' : '?';
      const sub = e.name || '';
      labels.push({ a: sa, b: sb, text, sub, missing: !e.v, sel: edgeSel, outward, isDim });
    }

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

  for (const L of labels) drawEdgeLabel(ctx, L, ui, opt.photo);

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

function drawEdgeLabel(ctx, L, ui, photo) {
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
  const bg = L.sel ? C.sel : L.missing ? C.missingBg : photo ? 'rgba(0,0,0,0.75)' : C.labelBg;
  const size = L.missing && !L.sel ? 12 : 14;
  pill(ctx, x, y, L.text, ang, ui, bg, C.label, size, true);
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
