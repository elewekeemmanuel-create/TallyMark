/* Tallymark Web Push Service Worker Handler (imported by Workbox SW)
 * Push payloads are strictly non-PII (e.g. "New payment report on INV-0007").
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'Tallymark', body: 'New document activity', url: '/app/claims', tag: 'tallymark-v2' };
  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === 'object') {
      payload = {
        title: typeof parsed.title === 'string' ? parsed.title : payload.title,
        body: typeof parsed.body === 'string' ? parsed.body : payload.body,
        url: typeof parsed.url === 'string' && parsed.url.startsWith('/') ? parsed.url : payload.url,
        tag: typeof parsed.tag === 'string' ? parsed.tag : payload.tag,
      };
    }
  } catch {
    const text = event.data.text();
    if (text) payload.body = text.slice(0, 140);
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.tag,
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    event.notification && event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/app/claims';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
