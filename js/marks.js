// Kinds of wall marks (points and openings on a wall). Geometry: see geometry.js markGeom.
// fields = values to measure, in this order. d = from corner, w = width, z = above floor, h = height.

export const MARK_KINDS = {
  socket: { label: 'Gniazdko', sym: 'G', color: '#ff9f0a', fields: ['d', 'z'] },
  water: { label: 'Woda', sym: 'W', color: '#0a84ff', fields: ['d', 'z'] },
  drain: { label: 'Odpływ / pion', sym: 'K', color: '#8e5a2b', fields: ['d', 'z'] },
  gas: { label: 'Gaz', sym: 'Gz', color: '#ff3b30', fields: ['d', 'z'] },
  vent: { label: 'Wentylacja', sym: 'Wt', color: '#30b0c7', fields: ['d', 'z'] },
  window: { label: 'Okno', color: '#40a0ff', span: true, fields: ['d', 'w', 'z', 'h'] },
  door: { label: 'Drzwi', color: '#a2845e', span: true, fields: ['d', 'w', 'h'] },
  radiator: { label: 'Grzejnik', color: '#ff6482', span: true, fields: ['d', 'w', 'z'] },
  other: { label: 'Inny punkt', sym: '•', color: '#5856d6', fields: ['d', 'z'] },
};

export const kindOf = (m) => MARK_KINDS[m.kind] || MARK_KINDS.other;

export function fieldLabel(m, f) {
  if (f === 'd') return 'Od narożnika';
  if (f === 'w') return 'Szerokość';
  if (f === 'h') return 'Wysokość';
  return m.kind === 'window' ? 'Parapet od podłogi' : 'Od podłogi';
}

export const markName = (m) => m.name || kindOf(m).label;
