// public/sw.js
const CACHE_NAME = 'clipsync-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// --- PWA Share Target Handler ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept POST to /share-target from the OS Share Menu
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Ignore WebSocket and non-HTTP requests
  if (event.request.url.includes('/ws') || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;

        const fetchRequest = event.request.clone();
        return fetch(fetchRequest).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
  );
});

// Handle incoming share from OS share menu
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const sharedText = formData.get('text') || formData.get('title') || formData.get('url') || '';
    const sharedFile = formData.get('file');

    // Store shared data in IndexedDB for the app to pick up
    const db = await openShareDB();
    const tx = db.transaction('pending_shares', 'readwrite');
    const store = tx.objectStore('pending_shares');

    if (sharedFile && sharedFile.size > 0) {
      const buffer = await sharedFile.arrayBuffer();
      store.add({
        type: 'file',
        name: sharedFile.name,
        mime: sharedFile.type || 'application/octet-stream',
        size: sharedFile.size,
        data: buffer,
        timestamp: Date.now()
      });
    } else if (sharedText) {
      store.add({
        type: 'text',
        content: sharedText,
        timestamp: Date.now()
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    db.close();
  } catch (e) {
    console.error('Share target handler error:', e);
  }

  // Redirect user to the app homepage
  return Response.redirect('/', 303);
}

function openShareDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('clipsync_shares', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending_shares')) {
        db.createObjectStore('pending_shares', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}
