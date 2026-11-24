// LSAT 170 offline helper (web only). Hand-written, no packages.
// - Only same-origin GET requests inside this site's own folder. Nothing else is touched
//   (the grader and the Drive mailbox are on Google, so they never come here).
// - Network first, always. A good answer from the network is also kept in the cache.
//   The cache is used only when the network fails, so a stale cache can't hide a new build.
// - Two caches: the shell (page, script, fonts, icons, the small locked files), named with
//   the build so a new build clears the old one; and lesson audio, kept across builds.
// scripts/build-web.js fills in BUILD and SHELL. To turn this off for good, see app/AGENTS.md.
const BUILD = "2feea98d3efb";
const SHELL = ["_expo/static/js/web/index-b921bfd69832a4d93f7351667905ed08.js","apple-touch-icon.png","assets/node_modules/@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.f083d3d233c60977fde5d857afec24e8.ttf","assets/node_modules/@expo-google-fonts/playfair-display/800ExtraBold/PlayfairDisplay_800ExtraBold.c474656eff24a077b81bb584c5960b04.ttf","assets/node_modules/@expo-google-fonts/source-serif-4/400Regular/SourceSerif4_400Regular.51bcc32f12d9376297dfa81f0c5b132c.ttf","assets/node_modules/@expo-google-fonts/source-serif-4/400Regular_Italic/SourceSerif4_400Regular_Italic.70a887a4d03b3efa0f22cfcd454bc0d8.ttf","assets/node_modules/@expo-google-fonts/source-serif-4/600SemiBold/SourceSerif4_600SemiBold.9e94ac7021cb903bce97849bf7d15de2.ttf","assets/node_modules/@expo-google-fonts/source-serif-4/700Bold/SourceSerif4_700Bold.f8e4f660480af96f48eea1860bdfcc50.ttf","enc/ai.bin","enc/lessons.bin","enc/salt.bin","enc/sync.bin","favicon.ico","index.html"]; // becomes a list of file paths, relative to this folder
const SHELL_CACHE = 'lsat-shell-' + BUILD;
const AUDIO_CACHE = 'lsat-audio';
const SMALL_BINS = ['lessons.bin', 'salt.bin', 'ai.bin', 'sync.bin'];

const base = () => new URL('./', self.location.href);
const inScope = (url) => url.origin === self.location.origin && url.pathname.startsWith(base().pathname);
const isAudio = (url) => {
  const rel = url.pathname.slice(base().pathname.length);
  return /^enc\/[0-9a-f]+\.bin$/.test(rel) && !SMALL_BINS.includes(rel.slice(4));
};
const keep = (res) => res && res.ok && res.status === 200 && res.type === 'basic';

// Fetch the shell into its cache. Missing files (no AI or mailbox file) are skipped.
async function fillShell() {
  const cache = await caches.open(SHELL_CACHE);
  const list = Array.isArray(SHELL) ? SHELL : [];
  let got = 0;
  for (const p of ['./', ...list]) {
    try {
      const res = await fetch(new URL(p, base()).href, { cache: 'no-cache' });
      if (keep(res)) { await cache.put(new URL(p, base()).href, res); got++; }
    } catch (e) {}
  }
  return got;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Best effort: a failed file never stops the new version from taking over.
  event.waitUntil(fillShell().catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('lsat-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0];
  if (!event.data || !port) return;
  if (event.data.type === 'version') port.postMessage({ build: BUILD });
  if (event.data.type === 'shell') fillShell().then((got) => port.postMessage({ got, build: BUILD }), () => port.postMessage({ got: 0, build: BUILD }));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!inScope(url)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (keep(res)) {
        const copy = res.clone();
        const name = isAudio(url) ? AUDIO_CACHE : SHELL_CACHE;
        event.waitUntil(caches.open(name).then((c) => c.put(req.mode === 'navigate' ? base().href : req, copy)).catch(() => {}));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = (await caches.match(base().href)) || (await caches.match(new URL('index.html', base()).href));
        if (page) return page;
      }
      throw err;
    }
  })());
});
