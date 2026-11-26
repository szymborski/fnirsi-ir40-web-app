// Canvas editor for sketch and photo projects.
// One finger: draw with current tool (or pan with hand tool). Tap: select. Two fingers: pan + zoom.
import { render, fitView } from './render.js';
import { dist, edgeCount, hitTest, snapPoint, bounds, fitShape } from './geometry.js';
import { uid } from './db.js';

const TAP_MOVE = 8; // px. More movement = drag.

export class Editor extends EventTarget {
  // project.shapes is changed in place. Event 'change' = save needed. Event 'select' = panel update.
  constructor(canvas, loupe, project, image, settings) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.loupe = loupe;
    this.lctx = loupe.getContext('2d');
    this.p = project;
    this.image = image;
    this.photo = project.kind === 'photo';
    this.settings = settings;
    this.shapes = project.shapes;
    this.tool = this.photo ? 'dim' : 'line';
    this.magnet = true;
    this.sel = null; // { id, edge }
    this.undoStack = [];
    this.redoStack = [];
    this.pointers = new Map();
    this.g = null; // active gesture
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.bind();
    this.resize();
    this.fit();
  }

  // ---------- view ----------
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    // Keep the same world point in the centre when stage size changes.
    if (this.w) {
      this.view.ox += (r.width - this.w) / 2;
      this.view.oy += (r.height - this.h) / 2;
    }
    this.w = r.width;
    this.h = r.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    const ls = 132;
    this.loupe.width = ls * this.dpr;
    this.loupe.height = ls * this.dpr;
    this.loupe.style.width = this.loupe.style.height = `${ls}px`;
    this.draw();
  }

  fit() {
    let box = null;
    if (this.photo && this.image) box = { x0: 0, y0: 0, x1: this.image.width, y1: this.image.height };
    else box = bounds(this.shapes);
    if (!box) {
      // Empty sketch: show about 6 x 6 m.
      this.view = { scale: Math.min(this.w, this.h) / 6000, ox: this.w / 2, oy: this.h / 2 };
    } else {
      const pad = this.photo ? 8 : 56;
      if (!this.photo) {
        const m = 200;
        box = { x0: box.x0 - m, y0: box.y0 - m, x1: box.x1 + m, y1: box.y1 + m };
      }
      this.view = fitView(box, this.w, this.h, pad);
    }
    this.fitScale = this.view.scale;
    this.draw();
  }

  toWorld(x, y) {
    return [(x - this.view.ox) / this.view.scale, (y - this.view.oy) / this.view.scale];
  }

  zoomAt(x, y, factor) {
    const s0 = this.view.scale;
    const min = this.photo ? this.fitScale * 0.5 : 0.004;
    const max = this.photo ? 20 : 6;
    const s = Math.max(min, Math.min(max, s0 * factor));
    const wx = (x - this.view.ox) / s0, wy = (y - this.view.oy) / s0;
    this.view = { scale: s, ox: x - wx * s, oy: y - wy * s };
  }

  // ---------- render ----------
  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.paint();
    });
  }

  renderOpts(extra = {}) {
    return {
      ui: 1, unit: this.settings.unit, photo: this.photo, image: this.image,
      sel: this.sel, showArea: !this.photo, guides: this.g?.guides, snapPoint: this.g?.snapKind === 'vertex' ? this.g.cur : null,
      ...extra,
    };
  }

  sceneShapes() {
    const d = this.g?.draft;
    return d ? [...this.shapes, d] : this.shapes;
  }

  paint() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    render(ctx, this.w, this.h, this.sceneShapes(), this.view, this.renderOpts());
    this.paintLoupe();
  }

  // Magnifier above the finger. Finger hides the exact point.
  paintLoupe() {
    const g = this.g;
    const show = g && (g.type === 'draw' || g.type === 'vertex') && g.cur;
    this.loupe.style.display = show ? 'block' : 'none';
    if (!show) return;
    const size = 132;
    const zoom = 2.6;
    const scale = this.view.scale * zoom;
    const v = { scale, ox: size / 2 - g.cur[0] * scale, oy: size / 2 - g.cur[1] * scale };
    const c = this.lctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    render(c, size, size, this.sceneShapes(), v, this.renderOpts({ ui: 0.9 }));
    c.strokeStyle = '#ff375f';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(size / 2 - 10, size / 2); c.lineTo(size / 2 + 10, size / 2);
    c.moveTo(size / 2, size / 2 - 10); c.lineTo(size / 2, size / 2 + 10);
    c.stroke();
    // Place loupe up-left of finger. Move it right when finger is near left edge.
    const sx = g.screen[0], sy = g.screen[1];
    let lx = sx - size - 24, ly = sy - size - 48;
    if (lx < 8) lx = sx + 24;
    if (ly < 8) ly = sy + 48;
    this.loupe.style.transform = `translate(${lx}px, ${ly}px)`;
  }

  // ---------- history ----------
  snapshot() {
    this.undoStack.push(JSON.stringify(this.shapes));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  restore(json) {
    const data = JSON.parse(json);
    this.shapes.length = 0;
    this.shapes.push(...data);
    if (this.sel && !this.shapes.find((s) => s.id === this.sel.id)) this.sel = null;
    this.changed();
    this.emitSelect();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.shapes));
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.shapes));
    this.restore(this.redoStack.pop());
  }

  changed() {
    this.draw();
    this.dispatchEvent(new Event('change'));
  }

  // ---------- selection ----------
  select(sel) {
    this.sel = sel;
    this.draw();
    this.emitSelect();
  }

  emitSelect() {
    this.dispatchEvent(new Event('select'));
  }

  selected() {
    if (!this.sel) return null;
    const s = this.shapes.find((x) => x.id === this.sel.id);
    return s ? { shape: s, edge: this.sel.edge } : null;
  }

  allEdges() {
    const list = [];
    for (const s of this.shapes) for (let i = 0; i < edgeCount(s); i++) list.push({ shape: s, edge: i });
    return list;
  }

  // Next edge with no value, after current one. Wrap around.
  nextMissing() {
    const all = this.allEdges();
    const cur = all.findIndex((e) => this.sel && e.shape.id === this.sel.id && e.edge === this.sel.edge);
    for (let k = 1; k <= all.length; k++) {
      const e = all[(cur + k + all.length) % all.length];
      if (!e.shape.edges[e.edge]?.v) return e;
    }
    return null;
  }

  // Set value of selected edge. Return what happened.
  setValue(mm, { advance = false } = {}) {
    const s = this.selected();
    if (!s || s.edge == null) return 'none';
    this.snapshot();
    s.shape.edges[s.edge].v = mm;
    this.changed();
    if (advance) {
      const n = this.nextMissing();
      if (n) { this.select({ id: n.shape.id, edge: n.edge }); this.reveal(n); return 'next'; }
      this.select(null);
      return 'done';
    }
    this.emitSelect();
    return 'set';
  }

  // Pan so the edge is on screen (not under the panel).
  reveal(e) {
    const s = e.shape;
    const a = s.pts[e.edge], b = s.pts[(e.edge + 1) % s.pts.length];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const x = m[0] * this.view.scale + this.view.ox, y = m[1] * this.view.scale + this.view.oy;
    const margin = 60;
    if (x < margin || x > this.w - margin || y < margin || y > this.h - margin - 120) {
      this.view.ox += this.w / 2 - x;
      this.view.oy += (this.h - 120) / 2 - y;
      this.draw();
    }
  }

  // ---------- edits ----------
  deleteSelection() {
    const s = this.selected();
    if (!s) return;
    this.snapshot();
    if (s.shape.type === 'text' || s.edge == null) this.removeShape(s.shape);
    else this.removeEdge(s.shape, s.edge);
    this.sel = null;
    this.changed();
    this.emitSelect();
  }

  deleteShape() {
    const s = this.selected();
    if (!s) return;
    this.snapshot();
    this.removeShape(s.shape);
    this.sel = null;
    this.changed();
    this.emitSelect();
  }

  removeShape(shape) {
    const i = this.shapes.indexOf(shape);
    if (i >= 0) this.shapes.splice(i, 1);
  }

  // Remove one edge. Closed shape opens. Middle edge of open line splits it in two.
  removeEdge(s, i) {
    const n = s.pts.length;
    if (s.closed) {
      s.pts = [...s.pts.slice(i + 1), ...s.pts.slice(0, i + 1)];
      s.edges = [...s.edges.slice(i + 1), ...s.edges.slice(0, i)];
      s.closed = false;
      if (s.pts.length < 2) this.removeShape(s);
      return;
    }
    if (n <= 2) return this.removeShape(s);
    if (i === 0) { s.pts.shift(); s.edges.shift(); return; }
    if (i === n - 2) { s.pts.pop(); s.edges.pop(); return; }
    const s2 = { ...s, id: uid(), pts: s.pts.slice(i + 1), edges: s.edges.slice(i + 1) };
    s.pts = s.pts.slice(0, i + 1);
    s.edges = s.edges.slice(0, i);
    this.shapes.splice(this.shapes.indexOf(s) + 1, 0, s2);
  }

  renameEdge(name) {
    const s = this.selected();
    if (!s || s.edge == null) return;
    this.snapshot();
    s.shape.edges[s.edge].name = name || '';
    this.changed();
    this.emitSelect();
  }

  renameShape(name) {
    const s = this.selected();
    if (!s) return;
    this.snapshot();
    s.shape.name = name || '';
    this.changed();
    this.emitSelect();
  }

  setText(shape, text) {
    this.snapshot();
    shape.text = text;
    this.changed();
    this.emitSelect();
  }

  fitSelectedShape() {
    const s = this.selected();
    if (!s) return false;
    this.snapshot();
    const ok = fitShape(s.shape);
    if (!ok) { this.undoStack.pop(); return false; }
    this.changed();
    this.fit();
    return true;
  }

  addText(p, text) {
    this.snapshot();
    const t = { id: uid(), type: 'text', x: p[0], y: p[1], text };
    this.shapes.push(t);
    this.changed();
    this.select({ id: t.id, edge: null });
  }

  // Open wall line that ends exactly at point p.
  chainAt(p) {
    for (let k = this.shapes.length - 1; k >= 0; k--) {
      const s = this.shapes[k];
      if (s.type !== 'poly' || s.closed || s.style === 'dim') continue;
      if (dist(s.pts[s.pts.length - 1], p) < 1e-6) return { s, atEnd: true };
      if (dist(s.pts[0], p) < 1e-6) return { s, atEnd: false };
    }
    return null;
  }

  // Add segment a-b. Wall segments join to a line that ends at a (or b).
  addSegment(a, b, style) {
    this.snapshot();
    if (style === 'wall') {
      const same = (p, q) => dist(p, q) < 1e-6;
      // Segment can start or end at a free end of an open line.
      let c = this.chainAt(a);
      let to = b;
      if (!c) { c = this.chainAt(b); to = a; }
      if (c) {
        const s = c.s;
        const other = c.atEnd ? s.pts[0] : s.pts[s.pts.length - 1];
        if (s.pts.length >= 3 && same(to, other)) {
          // Close the shape. Closing edge goes from last vertex to first vertex.
          s.closed = true;
          s.edges.push({ v: null, name: '' });
          this.changed();
          this.select({ id: s.id, edge: s.pts.length - 1 });
          return;
        }
        if (c.atEnd) {
          s.pts.push(to);
          s.edges.push({ v: null, name: '' });
          this.changed();
          this.select({ id: s.id, edge: s.edges.length - 1 });
        } else {
          s.pts.unshift(to);
          s.edges.unshift({ v: null, name: '' });
          this.changed();
          this.select({ id: s.id, edge: 0 });
        }
        return;
      }
    }
    const s = { id: uid(), type: 'poly', style, closed: false, pts: [a, b], edges: [{ v: null, name: '' }] };
    this.shapes.push(s);
    this.changed();
    this.select({ id: s.id, edge: 0 });
  }

  addRect(a, b) {
    if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return;
    this.snapshot();
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const s = {
      id: uid(), type: 'poly', style: 'wall', closed: true,
      pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      edges: [0, 1, 2, 3].map(() => ({ v: null, name: '' })),
    };
    this.shapes.push(s);
    this.changed();
    this.select({ id: s.id, edge: 0 });
  }

  // ---------- input ----------
  tol(e) {
    return (e.pointerType === 'mouse' ? 12 : 24) / this.view.scale;
  }

  snapOpts(from, skip, e) {
    if (!this.magnet) return null;
    return {
      shapes: this.shapes, from, tol: this.tol(e), skip,
      angleStep: this.photo ? 90 : 45, angleTol: this.photo ? 3 : 7, align: !this.photo,
    };
  }

  snap(p, from, skip, e) {
    const o = this.snapOpts(from, skip, e);
    if (!o) return { p, guides: [], kind: null };
    return snapPoint(p, o);
  }

  bind() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    c.addEventListener('pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 2) {
        // Two fingers: cancel draw, start pinch.
        const [p1, p2] = [...this.pointers.values()];
        this.g = { type: 'pinch', d0: dist(p1, p2), c0: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], v0: { ...this.view } };
        this.draw();
        return;
      }
      if (this.pointers.size > 2) return;
      const sp = pos(e);
      const wp = this.toWorld(...sp);
      const hit = hitTest(this.shapes, wp, this.tol(e), this.sel?.id);
      this.g = { type: 'pending', down: sp, wdown: wp, hit, t: Date.now(), e };
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const sp = pos(e);
      this.pointers.set(e.pointerId, sp);
      const g = this.g;
      if (!g) return;
      if (g.type === 'pinch') {
        if (this.pointers.size < 2) return;
        const [p1, p2] = [...this.pointers.values()];
        const cNow = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        this.view = { ...g.v0 };
        this.zoomAt(g.c0[0], g.c0[1], dist(p1, p2) / g.d0);
        this.view.ox += cNow[0] - g.c0[0];
        this.view.oy += cNow[1] - g.c0[1];
        this.draw();
        return;
      }
      if (g.type === 'pending') {
        if (dist(sp, g.down) < TAP_MOVE) return;
        this.startDrag(g, e);
      }
      this.moveDrag(sp, e);
    });

    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.g;
      if (!g) return;
      if (g.type === 'pinch') {
        if (this.pointers.size === 0) this.g = null;
        else this.g = { type: 'idle' };
        this.draw();
        return;
      }
      if (e.type === 'pointercancel') { this.g = null; this.draw(); return; }
      if (g.type === 'pending') this.tap(g);
      else this.endDrag(g);
      this.g = null;
      this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      if (e.ctrlKey) this.zoomAt(x, y, Math.exp(-e.deltaY / 100));
      else if (e.metaKey || e.altKey) this.zoomAt(x, y, Math.exp(-e.deltaY / 300));
      else { this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; }
      this.draw();
    }, { passive: false });

    // Stop iOS page zoom gestures on canvas.
    for (const n of ['gesturestart', 'gesturechange']) c.addEventListener(n, (e) => e.preventDefault());

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
  }

  startDrag(g, e) {
    const hit = g.hit;
    // Wall tool on a free end of an open wall line: continue the line, do not move the vertex.
    const s = hit?.shape;
    const freeEnd = hit?.kind === 'vertex' && this.tool === 'line' && s.style !== 'dim' && !s.closed
      && (hit.index === 0 || hit.index === s.pts.length - 1);
    if (hit?.kind === 'vertex' && !freeEnd) {
      this.snapshot();
      Object.assign(g, { type: 'vertex', shape: hit.shape, index: hit.index });
      return;
    }
    const selText = hit?.kind === 'text' && this.sel?.id === hit.shape.id;
    if (selText || (this.tool === 'hand' && hit && this.sel?.id === hit.shape.id)) {
      this.snapshot();
      Object.assign(g, { type: 'move', shape: hit.shape, last: g.wdown });
      return;
    }
    if (this.tool === 'hand' || this.tool === 'text') {
      Object.assign(g, { type: 'pan', last: g.down });
      return;
    }
    const start = freeEnd ? [...s.pts[hit.index]] : this.snap(g.wdown, null, null, e).p;
    Object.assign(g, { type: 'draw', start });
  }

  moveDrag(sp, e) {
    const g = this.g;
    const wp = this.toWorld(...sp);
    g.screen = sp;
    if (g.type === 'pan') {
      this.view.ox += sp[0] - g.last[0];
      this.view.oy += sp[1] - g.last[1];
      g.last = sp;
    } else if (g.type === 'move') {
      const dx = wp[0] - g.last[0], dy = wp[1] - g.last[1];
      g.last = wp;
      if (g.shape.type === 'text') { g.shape.x += dx; g.shape.y += dy; }
      else g.shape.pts = g.shape.pts.map((p) => [p[0] + dx, p[1] + dy]);
      g.moved = true;
    } else if (g.type === 'vertex') {
      const s = g.shape, n = s.pts.length;
      // Angle snap from a neighbour vertex.
      const prev = g.index > 0 ? s.pts[g.index - 1] : s.closed ? s.pts[n - 1] : null;
      const r = this.snap(wp, prev, [[s, g.index]], e);
      s.pts[g.index] = r.p;
      Object.assign(g, { cur: r.p, guides: r.guides, snapKind: r.kind, moved: true });
    } else if (g.type === 'draw') {
      const r = this.snap(wp, g.start, null, e);
      g.cur = r.p;
      g.guides = r.guides;
      g.snapKind = r.kind;
      const a = g.start, b = r.p;
      g.draft = this.tool === 'rect'
        ? { id: '__draft', draft: true, type: 'poly', style: 'wall', closed: true, pts: [a, [b[0], a[1]], b, [a[0], b[1]]], edges: [] }
        : { id: '__draft', draft: true, type: 'poly', style: this.tool === 'dim' ? 'dim' : 'wall', closed: false, pts: [a, b], edges: [] };
    }
    this.draw();
  }

  endDrag(g) {
    if (g.type === 'draw' && g.cur) {
      const lenPx = dist(g.start, g.cur) * this.view.scale;
      if (lenPx >= 12) {
        if (this.tool === 'rect') this.addRect(g.start, g.cur);
        else this.addSegment(g.start, g.cur, this.tool === 'dim' ? 'dim' : 'wall');
      }
    } else if ((g.type === 'vertex' || g.type === 'move') && g.moved) {
      this.changed();
    } else if (g.type === 'vertex' || g.type === 'move') {
      this.undoStack.pop();
    }
  }

  tap(g) {
    const hit = g.hit;
    if (this.tool === 'text' && !hit) {
      this.dispatchEvent(new CustomEvent('ask-text', { detail: { point: g.wdown } }));
      return;
    }
    if (!hit) { this.select(null); return; }
    if (hit.kind === 'text') {
      if (this.sel?.id === hit.shape.id) this.dispatchEvent(new CustomEvent('edit-text', { detail: { shape: hit.shape } }));
      else this.select({ id: hit.shape.id, edge: null });
      return;
    }
    if (hit.kind === 'edge') {
      const same = this.sel?.id === hit.shape.id && this.sel.edge === hit.index;
      if (same) this.dispatchEvent(new Event('edit-value'));
      else this.select({ id: hit.shape.id, edge: hit.index });
      return;
    }
    if (hit.kind === 'vertex') this.select({ id: hit.shape.id, edge: this.sel?.edge ?? 0 });
  }

  setTool(t) {
    this.tool = t;
  }
}
