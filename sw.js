// Tenarai service worker — caches the whole app shell on install so the
// page (kana charts, kanji list, phrases, writing canvas, and the
// built-in dictionary) all work with no network connection at all.
// The only thing that ever needs the network is the optional "live"
// dictionary lookup, which already fails gracefully in index.html.

const CACHE_NAME = 'tenarai-v14';
const APP_VERSION = '1.0.14';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

// ---------------------------------------------------------------
// WORD OF THE DAY notifications
// This list mirrors WORD_OF_DAY_POOL in index.html, and the same
// day-index formula, so the service worker can pick *today's* word
// on its own — without needing the page open — for periodic
// background sync and for the "show on next app open" fallback.
// ---------------------------------------------------------------
const WORD_OF_DAY_POOL = [
  {jp:'水', kana:'みず', romaji:'mizu', en:'water'},
  {jp:'火', kana:'ひ', romaji:'hi', en:'fire'},
  {jp:'食べる', kana:'たべる', romaji:'taberu', en:'to eat'},
  {jp:'飲む', kana:'のむ', romaji:'nomu', en:'to drink'},
  {jp:'友達', kana:'ともだち', romaji:'tomodachi', en:'friend'},
  {jp:'家族', kana:'かぞく', romaji:'kazoku', en:'family'},
  {jp:'今日', kana:'きょう', romaji:'kyou', en:'today'},
  {jp:'明日', kana:'あした', romaji:'ashita', en:'tomorrow'},
  {jp:'先生', kana:'せんせい', romaji:'sensei', en:'teacher'},
  {jp:'学生', kana:'がくせい', romaji:'gakusei', en:'student'},
  {jp:'猫', kana:'ねこ', romaji:'neko', en:'cat'},
  {jp:'犬', kana:'いぬ', romaji:'inu', en:'dog'},
  {jp:'本', kana:'ほん', romaji:'hon', en:'book'},
  {jp:'食べ物', kana:'たべもの', romaji:'tabemono', en:'food'},
  {jp:'元気', kana:'げんき', romaji:'genki', en:'energetic, well'},
  {jp:'仕事', kana:'しごと', romaji:'shigoto', en:'job, work'},
  {jp:'言葉', kana:'ことば', romaji:'kotoba', en:'word, language'},
  {jp:'毎日', kana:'まいにち', romaji:'mainichi', en:'every day'},
  {jp:'見る', kana:'みる', romaji:'miru', en:'to see, to watch'},
  {jp:'話す', kana:'はなす', romaji:'hanasu', en:'to speak'}
];

function todaysWordSW(){
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const idx = ((daysSinceEpoch % WORD_OF_DAY_POOL.length) + WORD_OF_DAY_POOL.length) % WORD_OF_DAY_POOL.length;
  return WORD_OF_DAY_POOL[idx];
}

function todayKeySW(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); // local date (12:00am rollover)
}

async function showWordOfDayNotification(){
  const already = await self.registration.getNotifications({ tag: 'tenarai-wotd' });
  // Avoid stacking duplicate notifications for the same day if one is
  // already showing (e.g. periodic sync firing close together with an
  // app-open check).
  if (already.length && already[0].data && already[0].data.day === todayKeySW()) return;
  // The dashboard's word of the day is chosen once per local day with a
  // no-repeat picker, so we keep the background notification generic and
  // let the page reveal today's word when it's opened.
  await self.registration.showNotification('今日 · Word of the day', {
    body: 'A new word of the day is waiting — open Tenarai to see it.',
    tag: 'tenarai-wotd',
    renotify: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { day: todayKeySW(), url: './' }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => {
      // Notify all clients that a new version is active
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION });
        });
      });
    }).then(() => self.clients.claim())
  );
});

// Cache-first for anything in the app shell (same-origin GET requests).
// Everything else (e.g. the optional live dictionary API) goes straight
// to the network and is simply left alone if it fails — index.html
// already handles that failure with its own try/catch.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (dictionary API) pass through untouched

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((networkRes) => {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return networkRes;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

// Fires automatically (Chrome/Android, installed PWA, once the OS decides
// conditions are right — roughly once a day, no guaranteed exact time).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tenarai-word-of-day') {
    event.waitUntil(showWordOfDayNotification());
  }
});

// Older/experimental one-shot equivalent some browsers expose instead.
self.addEventListener('sync', (event) => {
  if (event.tag === 'tenarai-word-of-day-once') {
    event.waitUntil(showWordOfDayNotification());
  }
});

// The page asks the service worker to show today's word notification —
// used right after permission is granted, and as the fallback path for
// browsers (iOS Safari, most desktop browsers) that don't support
// Periodic Background Sync: the page checks once per session whether
// today's word has already been shown, and if not, asks here.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_WORD_OF_DAY') {
    event.waitUntil(showWordOfDayNotification());
  }
  if (event.data && event.data.type === 'CHECK_VERSION') {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
