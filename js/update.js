// App update. GitHub Pages sends "max-age=600", so the browser can keep old files.
// Bluefy (WKWebView) often has no service worker, so only the HTTP cache applies.
// Compare with version.json (no cache), load new files past the cache, then reload.

export async function latestVersion() {
  const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).version;
}

// Fetch again each own file this page loaded. cache: 'reload' puts the new copy in the HTTP cache
// (and, through the service worker, in its cache). The next page load then gets new files.
export async function refreshFiles() {
  const page = location.href.split('#')[0].split('?')[0];
  const urls = new Set([page, ...performance.getEntriesByType('resource').map((e) => e.name)]);
  const own = [...urls].filter((u) => u.startsWith(location.origin) && !u.includes('version.json'));
  await Promise.all(own.map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
}
