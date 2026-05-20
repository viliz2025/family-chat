self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("family-chat-static-v3").then((cache) => {
      return cache.addAll(["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== "family-chat-static-v3").map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode !== "navigate") return;

  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Семейный чат",
    body: "Новое сообщение",
    url: "/"
  };

  const payload = event.data ? event.data.json() : fallback;
  const title = payload.title || fallback.title;
  const options = {
    body: payload.body || fallback.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: payload.url || fallback.url,
      messageId: payload.messageId || null
    }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      "setAppBadge" in self.registration ? self.registration.setAppBadge(1).catch(() => undefined) : Promise.resolve()
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    Promise.all([
      "clearAppBadge" in self.registration ? self.registration.clearAppBadge().catch(() => undefined) : Promise.resolve(),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const existingClient = clients.find((client) => client.url === url);
        if (existingClient) return existingClient.focus();
        return self.clients.openWindow(url);
      })
    ])
  );
});
