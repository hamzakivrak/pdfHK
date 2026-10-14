/* PDF Okuyucu + OCR - service worker
   - Uygulama kabuğunu önbelleğe alır (çevrimdışı açılış)
   - CDN kütüphanelerini (pdf.js, Tesseract) ilk kullanımdan sonra önbelleğe alır
   - Android "Paylaş" menüsünden gelen PDF'leri (share_target) alıp uygulamaya iletir
   API istekleri (Gemini, Groq, xAI) hiçbir zaman önbelleğe alınmaz. */
const APP = 'pdfocr-app-v1';
const CDN = 'pdfocr-cdn-v1';
const SHARE = 'pdfocr-share';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== APP && k !== CDN && k !== SHARE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && /\/share-target\/?$/.test(url.pathname)) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) { e.respondWith(sameOrigin(req, url)); return; }
  if (CDN_HOSTS.includes(url.hostname)) e.respondWith(cdnFirst(req));
});

async function handleShare(req) {
  const home = new URL('index.html', self.registration.scope).href;
  try {
    const fd = await req.formData();
    const files = fd.getAll('pdf').filter(f => f && typeof f !== 'string');
    const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of files) {
      await c.put(
        new URL('shared/' + (i++), self.registration.scope).href,
        new Response(f, { headers: { 'Content-Type': 'application/pdf', 'X-Name': encodeURIComponent(f.name || 'paylasilan.pdf') } })
      );
    }
    return Response.redirect(home + '?shared=' + files.length, 303);
  } catch (err) {
    return Response.redirect(home, 303);
  }
}

// Önce ağ (GitHub'daki güncellemeler hemen görünsün), ağ yoksa önbellek
async function sameOrigin(req, url) {
  const c = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic' && !url.search) c.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const home = await c.match('./index.html');
      if (home) return home;
    }
    return Response.error();
  }
}

// Önce önbellek, yoksa ağdan al ve sakla
async function cdnFirst(req) {
  const c = await caches.open(CDN);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
  return res;
}
