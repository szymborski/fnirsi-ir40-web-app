// Geometry helpers: hit test, snap, area from measured edges.
// Point = [x, y] in world units. Sketch: 1 unit ~ 1 mm. Photo: 1 unit = 1 image pixel.

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
// Order: vertex of selected shape, text, edge (nearest).
export function hitTest(shapes, p, tol, selectedId) {
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
