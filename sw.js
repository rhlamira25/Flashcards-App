// Service worker: handles Web Push delivery and notification-click routing.
// No offline caching is implemented here -- this task is scoped to push
// notifications only, not turning the app into a full offline-capable PWA.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Payload shape sent by the send-push edge function: { title, body, url }
self.addEventListener('push', (event) => {
  let data = { title: 'تذكير بالمراجعة', body: 'لديك مراجعات بانتظارك.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // Non-JSON payload (shouldn't happen from send-push, but don't crash either way)
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    dir: 'rtl',
    lang: 'ar',
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Clicking the notification should return the user to the relevant page (the
// review hub, via the url embedded in the push payload) -- reusing an already-open
// tab if one exists, rather than always opening a fresh blank one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Reuse any existing tab on this origin -- just navigate it and focus it,
        // instead of piling up new tabs every time a notification is clicked.
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// If the browser invalidates the subscription on its own (e.g. the user cleared
// site data), re-subscribe automatically so the saved push_subscriptions row
// doesn't go silently stale without the app ever finding out.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription ? { userVisibleOnly: true, applicationServerKey: event.oldSubscription.options.applicationServerKey } : undefined)
      .then((newSub) => {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
          clientList.forEach((client) => client.postMessage({ type: 'PUSH_SUBSCRIPTION_RENEWED', subscription: newSub.toJSON() }));
        });
      })
      .catch((e) => console.error('pushsubscriptionchange re-subscribe failed:', e))
  );
});
