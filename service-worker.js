/* ============================================================
   军藏思维计算仪 · Service Worker
   作用：缓存页面与外部资源，实现「断网也能打开」的离线 PWA。
   更新策略：升级缓存内容时，把下方 VERSION 改掉（如 v2），
             旧缓存会在 activate 阶段自动清理。
   ============================================================ */
const VERSION = 'v4';

const CORE_CACHE = 'juncang-core-' + VERSION;
const RUNTIME_CACHE = 'juncang-runtime-' + VERSION;

/* 站点自身文件（同源，首次安装即预缓存） */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* 外部资源（CDN 脚本 + 字体 CSS），联网时预缓存，离线可用 */
const RUNTIME_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.10/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://miaoda.feishu.cn/fonts/css2?family=Noto+Serif+SC:wght@400;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap'
];

/* 跨域资源用 no-cors 拉取后 put 进缓存（opaque 响应可缓存） */
async function prefetch(cache, url) {
  try {
    const res = await fetch(url, { mode: 'no-cors', cache: 'reload' });
    if (res) await cache.put(url, res);
  } catch (e) { /* 单个资源失败不影响整体 */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const core = await caches.open(CORE_CACHE);
    await Promise.all(CORE_ASSETS.map((u) => core.add(u).catch(() => {})));
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(RUNTIME_ASSETS.map((u) => prefetch(runtime, u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* 缓存优先：命中直接返回，未命中联网并写入缓存；断网时回退缓存 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    const fallback = await caches.match(request);
    if (fallback) return fallback;
    throw e;
  }
}

/* 网络优先：页面导航用，保证联网时拿到最新版；断网回退到缓存的首页 */
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CORE_CACHE);
      cache.put('./index.html', res.clone());
    }
    return res;
  } catch (e) {
    const cached =
      (await caches.match(request)) ||
      (await caches.match('./index.html')) ||
      (await caches.match('./'));
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 云端同步接口（Supabase）不走缓存，交给浏览器正常处理 */
  if (url.hostname.endsWith('supabase.co')) return;

  /* 页面导航：网络优先 */
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  /* 其余资源：缓存优先 */
  event.respondWith(cacheFirst(req));
});
