// 离线缓存：App Shell 预缓存；运行时缓存其余资源（含 assets 插画）
const CACHE = 'wasteland-tycoon-v56';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css', './css/board-v2.css',
  './js/main.js', './js/config.js', './js/paths.js', './js/icons.js', './js/assets-art.js', './js/audio.js',
  './js/state.js', './js/data.js', './js/rules-core.js', './js/rules.js', './js/view-util.js',
  './js/view-core.js', './js/view-setup.js', './js/view-modal.js', './js/view-manage.js', './js/view-save.js',
  './js/view-legacy.js', './js/legacy.js', './js/mutators.js', './js/narrative.js',
  './js/view.js', './js/game.js', './js/campaign.js', './js/fx.js', './js/fx-events.js', './js/tts.js', './js/step-tts.js', './js/capacitor-tts.js',
  './js/difficulty.js', './js/missions.js', './js/nuke.js',
  './content/tiles.json', './content/events.json',
  './logo.svg'
];

function withCorp(resp) {
  if (!resp) return resp;
  const h = new Headers(resp.headers);
  if (!h.has('Cross-Origin-Resource-Policy')) {
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h,
  });
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return withCorp(cached);
      return fetch(e.request).then((resp) => {
        if (!resp || resp.status !== 200) return resp;
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return resp;
      }).catch(() => caches.match('./index.html').then(withCorp));
    })
  );
});
