/* دُكّان Dukkan — Service Worker للمتاجر (وضع عدم الاتصال + تثبيت كتطبيق) */
/* IMPORTANT: عند أي نشر جديد غيّر رقم الإصدار CACHE أدناه — بهذا يُحدَّث الكاش القديم عند كل الزوار */
const CACHE = 'dukkan-store-v6';
const STATIC = ['/css/store.css', '/css/store-gen.css', '/css/store-market.css', '/css/store-neo.css', '/js/cart.js', '/img/logo.svg', '/img/placeholder.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isStatic = url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') || url.pathname.startsWith('/img/');
  const isUpload = url.pathname.startsWith('/uploads/');
  if (isStatic) {
    /* cache-first: سرعة قصوى — وتُحدَّث عند تغيير رقم الإصدار CACHE */
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match('/img/placeholder.svg'))));
  } else if (isUpload) {
    /* network-first: الصور المرفوعة حديثاً تظهر فوراً — والكاش فقط للاستخدام دون اتصال */
    e.respondWith(fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/img/placeholder.svg'))));
  }
});