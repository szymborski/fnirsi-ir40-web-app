// Geometry helpers: hit test, snap, area from measured edges.
// Point = [x, y] in world units. Sketch: 1 unit ~ 1 mm. Photo: 1 unit = 1 image pixel.
import { kindOf } from './marks.js';

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function edgeCount(s) {
  if (s.type !== 'poly') return 0;
  return s.closed ? s.pts.length : s.pts.length - 1;
}

export function edgePts(s, i) {
  return [s.pts[i], s.pts[(i + 1) % s.pts.length]];
}

// Closest point on segment ab to p. Return [point, t, distance].
export function projectOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return [q, t, dist(p, q)];
}

// Find the item under point p. tol is in world units.
// Order: vertex of selected shape, text, wall mark, edge (nearest).
export function hitTest(shapes, p, tol, selectedId, photo = false) {
  const sel = shapes.find((s) => s.id === selectedId);
  if (sel?.type === 'poly') {
    let best = null;
    sel.pts.forEach((v, i) => {
      const d = dist(p, v);
      if (d < tol * 1.4 && (!best || d < best.d)) best = { d, i };
    });
    if (best) return { kind: 'vertex', shape: sel, index: best.i };
  }
  for (let k = shapes.length - 1; k >= 0; k--) {
    const s = shapes[k];
    if (s.type === 'text' && dist(p, [s.x, s.y]) < tol * 2.2) return { kind: 'text', shape: s };
  }
  let bm = null;
  for (const s of shapes) {
    for (let i = 0; i < edgeCount(s); i++) {
      for (const m of marksOf(s, i)) {
        const g = markGeom(s, i, m, photo, kindOf(m).span);
        const d = kindOf(m).span ? projectOnSeg(p, g.a0, g.a1)[2] : dist(p, g.c);
        if (d < tol * 1.1 && (!bm || d < bm.d)) bm = { d, shape: s, index: i, mark: m };
      }
    }
  }
  if (bm) return { kind: 'mark', shape: bm.shape, index: bm.index, mark: bm.mark };
  let best = null;
  for (const s of shapes) {
    for (let i = 0; i < edgeCount(s); i++) {
      const [a, b] = edgePts(s, i);
      const d = projectOnSeg(p, a, b)[2];
      if (d < tol && (!best || d < best.d)) best = { d, shape: s, index: i };
    }
  }
  if (best) return { kind: 'edge', shape: best.shape, index: best.index };
  return null;
}

// Snap point p.
// opt: { shapes, from (start point or null), tol, angleStep (deg, 0 = off), angleTol (deg), align (bool), skip (vertex refs to ignore) }
// Return { p, guides: [[a, b], ...], kind }.
export function snapPoint(p, opt) {
  const { shapes, from, tol, skip } = opt;
  const isSkipped = (s, i) => skip && skip.some((k) => k[0] === s && k[1] === i);

  // 1. Magnet to vertex. Strongest snap.
  let best = null;
  for (const s of shapes) {
    if (s.type !== 'poly') continue;
    s.pts.forEach((v, i) => {
      if (isSkipped(s, i)) return;
      const d = dist(p, v);
      if (d < tol && (!best || d < best.d)) best = { d, v };
    });
  }
  if (best) return { p: [best.v[0], best.v[1]], guides: [], kind: 'vertex' };

  let q = [p[0], p[1]];
  let kind = null;
  const guides = [];

  // 2. Angle snap from start point.
  if (from && opt.angleStep) {
    const ang = Math.atan2(q[1] - from[1], q[0] - from[0]);
    const step = (opt.angleStep * Math.PI) / 180;
    const snapped = Math.round(ang / step) * step;
    if (Math.abs(snapped - ang) < (opt.angleTol * Math.PI) / 180) {
      const len = dist(from, q);
      q = [from[0] + Math.cos(snapped) * len, from[1] + Math.sin(snapped) * len];
      kind = 'angle';
    }
  }

  // 3. Align x or y with other vertices (only when angle snap did not lock a slant).
  if (opt.align) {
    let bx = null, by = null;
    for (const s of shapes) {
      if (s.type !== 'poly') continue;
      s.pts.forEach((v, i) => {
        if (isSkipped(s, i)) return;
        const dx = Math.abs(v[0] - q[0]);
        const dy = Math.abs(v[1] - q[1]);
        if (dx < tol * 0.6 && (!bx || dx < bx.d)) bx = { d: dx, v };
        if (dy < tol * 0.6 && (!by || dy < by.d)) by = { d: dy, v };
      });
    }
    const horiz = from && kind === 'angle' && Math.abs(q[1] - from[1]) < 1e-6;
    const vert = from && kind === 'angle' && Math.abs(q[0] - from[0]) < 1e-6;
    const slant = kind === 'angle' && !horiz && !vert;
    if (bx && !vert && !slant) { q[0] = bx.v[0]; guides.push([bx.v, null]); kind = kind || 'align'; }
    if (by && !horiz && !slant) { q[1] = by.v[1]; guides.push([by.v, null]); kind = kind || 'align'; }
    for (const g of guides) g[1] = [q[0], q[1]];
  }

  // 4. Magnet to a point on an edge (for example: start a dimension on a wall).
  if (!kind) {
    let be = null;
    for (const s of shapes) {
      for (let i = 0; i < edgeCount(s); i++) {
        const [a, b] = edgePts(s, i);
        const [pt, , d] = projectOnSeg(q, a, b);
        if (d < tol * 0.7 && (!be || d < be.d)) be = { d, pt };
      }
    }
    if (be) return { p: be.pt, guides: [], kind: 'edge' };
  }
  return { p: q, guides, kind };
}

// Rebuild polygon from measured lengths. Keep drawn directions.
// Unmeasured edges use drawn length * mean scale of measured edges.
// Return { pts, scale, measured, total } or null.
export function rebuild(s) {
  const n = edgeCount(s);
  if (!n) return null;
  let sumRatio = 0, measured = 0;
  for (let i = 0; i < n; i++) {
    const v = s.edges[i]?.v;
    const [a, b] = edgePts(s, i);
    const l = dist(a, b);
    if (v && l > 0) { sumRatio += v / l; measured++; }
  }
  if (!measured) return null;
  const scale = sumRatio / measured;
  const pts = [[0, 0]];
  for (let i = 0; i < n; i++) {
    const [a, b] = edgePts(s, i);
    const l = dist(a, b) || 1;
    const len = s.edges[i]?.v || l * scale;
    const last = pts[pts.length - 1];
    pts.push([last[0] + ((b[0] - a[0]) / l) * len, last[1] + ((b[1] - a[1]) / l) * len]);
  }
  return { pts, scale, measured, total: n };
}

// Area (m2), perimeter (mm) and closure gap (mm) for a closed shape.
export function polyMetrics(s) {
  if (s.type !== 'poly' || !s.closed || s.pts.length < 3) return null;
  const r = rebuild(s);
  if (!r) return null;
  const pts = r.pts.slice(0, -1);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  let perimeter = 0;
  for (let i = 0; i < r.total; i++) {
    const [p, q] = edgePts(s, i);
    perimeter += s.edges[i]?.v || dist(p, q) * r.scale;
  }
  const gap = dist(r.pts[0], r.pts[r.pts.length - 1]);
  return { area: Math.abs(a) / 2 / 1e6, perimeter, gap, approx: r.measured < r.total };
}

// Move shape points so drawn lengths match measured lengths. Keep first vertex in place.
// For a closed shape the closing gap stays visible as a short warning.
export function fitShape(s) {
  const r = rebuild(s);
  if (!r) return false;
  const o = s.pts[0];
  for (let i = 1; i < s.pts.length; i++) s.pts[i] = [o[0] + r.pts[i][0], o[1] + r.pts[i][1]];
  return true;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Signed area in drawn units. Use to find outside side of edges.
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bounds(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const s of shapes) {
    if (s.type === 'poly') s.pts.forEach(add);
    else if (s.type === 'text') add([s.x, s.y]);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// ---------- rectangle check ----------
export const RECT_TOL = 10; // mm. Opposite walls of a rectangle that differ more get a warning.

// Shape drawn as a rectangle (4 corners near 90 deg)? Return pairs of opposite edges with both values:
// [{ i, j, diff }]. Else null.
export function rectPairs(s) {
  if (s.type !== 'poly' || !s.closed || s.pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const p = s.pts[(i + 3) % 4], q = s.pts[i], r = s.pts[(i + 1) % 4];
    const ux = p[0] - q[0], uy = p[1] - q[1], vx = r[0] - q[0], vy = r[1] - q[1];
    const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
    if (Math.abs(cos) > 0.17) return null; // More than ~10 deg from a right angle.
  }
  const out = [];
  for (const [i, j] of [[0, 2], [1, 3]]) {
    const a = s.edges[i]?.v, b = s.edges[j]?.v;
    if (a && b) out.push({ i, j, diff: Math.abs(a - b) });
  }
  return out;
}

// Pair with a difference above RECT_TOL that has edge i, or null.
export function rectMismatch(s, i) {
  return rectPairs(s)?.find((p) => (p.i === i || p.j === i) && p.diff > RECT_TOL) || null;
}

// ---------- wall marks ----------
// Mark = point or opening on a wall edge: s.edges[i].marks = [mark].
// mark = { id, kind, name, from (0 = start vertex, 1 = end vertex), t (0..1, place when d is not known),
//          d (mm from corner), w (width), z (height above floor), h (height) }.
export function marksOf(s, i) {
  return s.edges[i]?.marks || [];
}

// Find mark by id. Return { shape, edge, mark } or null.
export function findMark(shapes, id) {
  for (const s of shapes) {
    for (let i = 0; i < edgeCount(s); i++) {
      const m = marksOf(s, i).find((x) => x.id === id);
      if (m) return { shape: s, edge: i, mark: m };
    }
  }
  return null;
}

// Place of mark on its wall, in world units. Return { a0, a1 (span ends or same point), c (centre), corner, t0, t1 }.
// mm to world: from measured wall length, else 1 mm = 1 unit (sketch). Photo with unmeasured wall: use t.
export function markGeom(s, i, m, photo, span) {
  const [a, b] = edgePts(s, i);
  const L = dist(a, b) || 1;
  const v = s.edges[i]?.v;
  const k = v ? L / v : photo ? 0 : 1;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  let t0 = m.d != null && k ? (m.d * k) / L : m.t ?? 0.5;
  let t1 = span ? (m.w && k ? t0 + (m.w * k) / L : t0 + Math.min(0.2, 600 / L)) : t0;
  t0 = clamp(t0); t1 = clamp(t1);
  if (m.from === 1) { t0 = 1 - t0; t1 = 1 - t1; }
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a0 = at(t0), a1 = at(t1);
  return { a0, a1, c: mid(a0, a1), corner: m.from === 1 ? b : a, t0, t1 };
}
