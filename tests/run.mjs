// Run: node tests/run.mjs. Check parser with real IR40 packets and geometry math.
import assert from 'node:assert/strict';
import { parsePacket, TAG } from '../js/ble.js';
import { polyMetrics, snapPoint } from '../js/geometry.js';
import { fmt, parse } from '../js/format.js';

const bytes = (s) => Uint8Array.from(s.split(' ').map((x) => parseInt(x, 16)));

// Captured from real device (fnirsi.etool.40mpro), 2026-11-26.
let f = parsePacket(bytes('00 15 02 01 14 00 00 00 00 02 05 14 00 00 0A 32 02 06 14 00 00 00 00'));
assert.equal(f[TAG.MODE], 0);
assert.equal(f[TAG.RESULT], 2610);
assert.equal(f[TAG.UNIT], 0);
f = parsePacket(bytes('00 0E 02 06 14 00 00 00 00 02 0A 14 00 00 00 01'));
assert.equal(TAG.RESULT in f, false, 'status packet has no result');
assert.equal(f[TAG.REFERENCE], 1);
// From MultiMote README: rect 0.217 x 0.251.
f = parsePacket(bytes('00 23 02 01 14 00 00 00 03 02 02 14 00 00 00 D9 02 03 14 00 00 00 FB 02 05 14 00 00 00 36 02 06 14 00 00 00 00'));
assert.deepEqual([f[TAG.MODE], f[TAG.SIDE_A], f[TAG.SIDE_B]], [3, 217, 251]);
assert.equal(parsePacket(bytes('00')), null);

// Rectangle 4000 x 3000 drawn at other scale: area 12 m2, no gap.
const E = (v) => ({ v });
let m = polyMetrics({ type: 'poly', closed: true, pts: [[0, 0], [40, 0], [40, 30], [0, 30]], edges: [E(4000), E(3000), E(4000), E(3000)] });
assert.ok(Math.abs(m.area - 12) < 1e-9 && m.gap < 1e-6 && !m.approx);
// Wrong side: gap is 100 mm.
m = polyMetrics({ type: 'poly', closed: true, pts: [[0, 0], [40, 0], [40, 30], [0, 30]], edges: [E(4000), E(3000), E(3900), E(3000)] });
assert.ok(Math.abs(m.gap - 100) < 1e-6);
// Partial: approx.
m = polyMetrics({ type: 'poly', closed: true, pts: [[0, 0], [40, 0], [40, 30], [0, 30]], edges: [E(4000), E(null), E(null), E(null)] });
assert.ok(m.approx && Math.abs(m.area - 12) < 1e-9);

// Snap: vertex magnet, then 45 deg angle.
const shapes = [{ type: 'poly', pts: [[0, 0], [100, 0]], edges: [E(null)] }];
assert.deepEqual(snapPoint([103, 4], { shapes, tol: 10 }).p, [100, 0]);
const r = snapPoint([200, 5], { shapes, from: [100, 0], tol: 2, angleStep: 45, angleTol: 7 });
assert.equal(r.kind, 'angle');
assert.ok(Math.abs(r.p[1]) < 1e-9);

assert.equal(fmt(2435, 'cm'), '243,5');
assert.equal(fmt(2435, 'm'), '2,435');
assert.equal(parse('243,5', 'cm'), 2435);
assert.equal(parse('2.435', 'm'), 2435);
console.log('all tests passed');
