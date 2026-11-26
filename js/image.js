// Photo import. Scale down and store as JPEG blob in IndexedDB.

const MAX_SIDE = 2560; // Keep detail for zoom. Typical file 0.6-1.5 MB.
const QUALITY = 0.85;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nie można odczytać zdjęcia'));
    img.src = src;
  });
}

// File -> { blob, width, height }. Browser applies EXIF rotation on draw.
export async function importPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await toBlob(c, 'image/jpeg', QUALITY);
    return { blob, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function toBlob(canvas, type = 'image/jpeg', q = 0.85) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, q));
}

export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  img.dataset.url = url;
  return img;
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

// Ask user for a photo. capture=true opens camera directly.
export function pickPhoto(capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = 'environment';
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
