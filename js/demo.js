// Demo data. Open the app with ?demo to add it. Use for test and screenshots.
import * as db from './db.js';
import { toBlob } from './image.js';

const E = (v, name = '', marks) => (marks ? { v, name, marks } : { v, name });
const M = (kind, o) => ({ id: db.uid(), kind, name: '', from: 0, t: 0.5, d: null, w: null, z: null, h: null, ...o });

export async function seedDemo() {
  const folders = await db.getAll('folders');
  if (folders.some((f) => f.demo)) return;
  const now = Date.now();
  const f = { id: db.uid(), name: 'Mieszkanie ul. Przykładowa 7', demo: true, createdAt: now, updatedAt: now };
  await db.put('folders', f);

  // L-shaped kitchen with wall marks (window, socket, water, drain, door) and a note.
  const kitchen = {
    id: db.uid(), folderId: f.id, name: 'Kuchnia', kind: 'sketch', createdAt: now, updatedAt: now - 1000, thumb: null,
    shapes: [
      {
        id: db.uid(), type: 'poly', style: 'wall', closed: true, name: 'Kuchnia',
        pts: [[0, 0], [3600, 0], [3600, 2400], [2000, 2400], [2000, 3400], [0, 3400]],
        edges: [
          E(3612, 'ściana z oknem', [M('window', { d: 980, w: 1450, z: 850, h: 1320 })]),
          E(2405, '', [M('socket', { d: 450, z: 1100 }), M('water', { d: 1250, z: 520 }), M('drain', { d: 1380, z: 300 })]),
          E(1598), E(1010),
          E(2010, '', [M('door', { d: 700, w: 900 })]),
          E(3398),
        ],
      },
      { id: db.uid(), type: 'text', x: 1000, y: 1500, text: 'tu lodówka?' },
    ],
  };
  const living = {
    id: db.uid(), folderId: f.id, name: 'Salon', kind: 'sketch', createdAt: now, updatedAt: now - 2000, thumb: null,
    shapes: [
      {
        id: db.uid(), type: 'poly', style: 'wall', closed: true, name: 'Salon',
        pts: [[0, 0], [5200, 0], [5200, 4100], [0, 4100]],
        edges: [E(5185), E(4120), E(5162), E(null)],
      },
    ],
  };
  await db.put('projects', kitchen);
  await db.put('projects', living);

  const { blob, width, height } = await demoPhoto();
  const imageId = db.uid();
  await db.put('images', { id: imageId, blob });
  await db.put('projects', {
    id: db.uid(), folderId: f.id, name: 'Ściana z oknem', kind: 'photo', imageId, imageW: width, imageH: height,
    createdAt: now, updatedAt: now, thumb: null,
    shapes: [
      { id: db.uid(), type: 'poly', style: 'dim', closed: false, pts: [[560, 330], [1240, 330]], edges: [E(1450, 'Szerokość okna')] },
      { id: db.uid(), type: 'poly', style: 'dim', closed: false, pts: [[1300, 400], [1300, 1020]], edges: [E(1320, 'Wysokość okna')] },
      { id: db.uid(), type: 'poly', style: 'dim', closed: false, pts: [[900, 1084], [900, 1460]], edges: [E(null, 'Parapet od podłogi')] },
      { id: db.uid(), type: 'poly', style: 'wall', closed: false, pts: [[60, 1460], [1740, 1460]], edges: [E(3612, 'Ściana')] },
      { id: db.uid(), type: 'text', x: 300, y: 1250, text: 'grzejnik' },
    ],
  });
}

// Draw a simple wall with window. No real photo in the repo.
async function demoPhoto() {
  const w = 1800, h = 1600;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  let g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9d2c5'); g.addColorStop(1, '#b9b0a2');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  g = x.createLinearGradient(0, 1460, 0, h);
  g.addColorStop(0, '#8a6a4a'); g.addColorStop(1, '#6b4f36');
  x.fillStyle = g; x.fillRect(0, 1460, w, h - 1460);
  x.fillStyle = '#f4f4f2'; x.fillRect(520, 360, 760, 700);
  g = x.createLinearGradient(560, 400, 1240, 1020);
  g.addColorStop(0, '#9cc7e8'); g.addColorStop(1, '#d6ebf7');
  x.fillStyle = g; x.fillRect(560, 400, 680, 620);
  x.fillStyle = '#f4f4f2'; x.fillRect(890, 400, 20, 620);
  x.fillStyle = '#e9e7e2'; x.fillRect(490, 1050, 820, 34);
  x.fillStyle = '#ecebe8';
  for (let i = 0; i < 12; i++) x.fillRect(560 + i * 58, 1150, 44, 230);
  x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, 1440, w, 20);
  const blob = await toBlob(c, 'image/jpeg', 0.85);
  return { blob, width: w, height: h };
}
