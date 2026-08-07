/* Receives Web Push messages while Pay Luke is closed or in the background. */
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || 'Pay Luke';
  const options = {
    body: payload.body || 'You have a new payment update.',
    icon: '/Brutus_Front.png',
    badge: '/Brutus_Front.png',
    tag: payload.tag || 'pay-luke-payment',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(destination);
      return;
    }
    await clients.openWindow(destination);
  })());
});
