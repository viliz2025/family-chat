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

const CHAT_NOTIFICATION_TAG = "family-chat-new-message";

function isLocalDev() {
  return self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
}

function debugBadge(message, data) {
  if (isLocalDev()) console.debug(`[sw] ${message}`, data || "");
}

async function closeChatNotifications() {
  if (!("getNotifications" in self.registration)) return 0;
  const notifications = await self.registration.getNotifications({ tag: CHAT_NOTIFICATION_TAG });
  notifications.forEach((notification) => notification.close());
  debugBadge("closed notifications", { count: notifications.length });
  return notifications.length;
}

function getBadgeApi() {
  const navigatorBadge = self.navigator || {};
  const registrationBadge = self.registration || {};

  return {
    set:
      typeof navigatorBadge.setAppBadge === "function"
        ? navigatorBadge.setAppBadge.bind(navigatorBadge)
        : typeof registrationBadge.setAppBadge === "function"
          ? registrationBadge.setAppBadge.bind(registrationBadge)
          : null,
    clear:
      typeof navigatorBadge.clearAppBadge === "function"
        ? navigatorBadge.clearAppBadge.bind(navigatorBadge)
        : typeof registrationBadge.clearAppBadge === "function"
          ? registrationBadge.clearAppBadge.bind(registrationBadge)
          : null
  };
}

async function setUnreadBadge(unreadCount) {
  const badgeApi = getBadgeApi();
  if (!badgeApi.set) {
    debugBadge("setAppBadge unavailable", { unreadCount });
    return;
  }

  try {
    await badgeApi.set(unreadCount);
    debugBadge("setAppBadge", { unreadCount });
  } catch (error) {
    debugBadge("setAppBadge error", { unreadCount, error: String(error) });
  }
}

async function clearUnreadBadge(reason) {
  const badgeApi = getBadgeApi();
  if (!badgeApi.clear) {
    debugBadge("clearAppBadge unavailable", { reason });
    return;
  }

  try {
    await badgeApi.clear();
    debugBadge("clearAppBadge", { reason });
  } catch (error) {
    debugBadge("clearAppBadge error", { reason, error: String(error) });
  }
}

async function applyUnreadBadge(unreadCount) {
  if (unreadCount > 0) {
    await setUnreadBadge(unreadCount);
    return;
  }

  await clearUnreadBadge("push unreadCount <= 0");
}

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Семейный чат",
    body: "Новое сообщение",
    url: "/"
  };

  const payload = event.data ? event.data.json() : fallback;
  const title = payload.title || fallback.title;
  const unreadCount = Number(payload.unreadCount || 0);
  const options = {
    body: payload.body || fallback.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: CHAT_NOTIFICATION_TAG,
    renotify: true,
    data: {
      url: payload.url || fallback.url,
      messageId: payload.messageId || null,
      unreadCount
    }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      applyUnreadBadge(unreadCount)
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    Promise.all([
      clearUnreadBadge("notificationclick"),
      closeChatNotifications(),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const existingClient = clients.find((client) => client.url === url);
        if (existingClient) return existingClient.focus();
        return self.clients.openWindow(url);
      })
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "family-chat-clear-badge") return;

  const reason = event.data?.reason || "service worker message";

  event.waitUntil(
    Promise.all([
      clearUnreadBadge(reason),
      closeChatNotifications()
    ])
  );
});
