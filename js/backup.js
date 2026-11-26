// Backup: export and import folders as one JSON file. Photos go inside as data URLs.
import * as db from './db.js';
import { blobToDataURL, dataURLToBlob } from './image.js';

const FORMAT = 'dalmierz-backup';

// folderIds = null: export all folders.
export async function exportBackup(folderIds = null) {
  const folders = (await db.getAll('folders')).filter((f) => !folderIds || folderIds.includes(f.id));
  const projects = [];
  const images = {};
  for (const f of folders) {
    for (const p of await db.projectsInFolder(f.id)) {
      const { thumb, ...rest } = p;
      projects.push(rest);
      if (p.imageId) {
        const img = await db.get('images', p.imageId);
        if (img) images[p.imageId] = await blobToDataURL(img.blob);
      }
    }
  }
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), folders, projects, images };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

// Import file. Same id = replace. Return count of folders.
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== FORMAT) throw new Error('To nie jest plik kopii Dalmierza');
  for (const [id, url] of Object.entries(data.images || {})) {
    await db.put('images', { id, blob: await dataURLToBlob(url) });
  }
  for (const f of data.folders) await db.put('folders', f);
  for (const p of data.projects) await db.put('projects', { ...p, thumb: null });
  return data.folders.length;
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
