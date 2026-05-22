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
const BADGE_DEBUG_CACHE = "family-chat-badge-debug";
const BADGE_DEBUG_REQUEST = "/__family-chat-badge-debug";

function isLocalDev() {
  return self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
}

function debugBadge(message, data) {
  if (isLocalDev()) console.debug(`[sw] ${message}`, data || "");
}

async function readBadgeDebugState() {
  if (!("caches" in self)) return { enabled: false, events: [] };
  const cache = await caches.open(BADGE_DEBUG_CACHE);
  const response = await cache.match(BADGE_DEBUG_REQUEST);
  return response ? response.json().catch(() => ({ enabled: false, events: [] })) : { enabled: false, events: [] };
}

async function writeBadgeDebugState(state) {
  if (!("caches" in self)) return;
  const cache = await caches.open(BADGE_DEBUG_CACHE);
  await cache.put(BADGE_DEBUG_REQUEST, new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } }));
}

async function logBadgeEvent(event, data) {
  const state = await readBadgeDebugState();
  if (!state.enabled) return;
  const nextEvent = {
    event,
    at: new Date().toISOString(),
    data: {
      ...(data || {}),
      userAgent: self.navigator?.userAgent || "",
      platform: self.navigator?.platform || ""
    }
  };
  await writeBadgeDebugState({
    enabled: true,
    events: [...(state.events || []), nextEvent].slice(-50)
  });
}

async function closeChatNotifications() {
  if (!("getNotifications" in self.registration)) return 0;
  const notifications = await self.registration.getNotifications({ tag: CHAT_NOTIFICATION_TAG });
  notifications.forEach((notification) => notification.close());
  debugBadge("closed notifications", { count: notifications.length });
  return notifications.length;
}

async function applyUnreadBadge(unreadCount) {
  const setSupported = "setAppBadge" in self.registration;
  const clearSupported = "clearAppBadge" in self.registration;
  await logBadgeEvent("badge support", { unreadCount, setAppBadge: setSupported, clearAppBadge: clearSupported });

  if (unreadCount > 0 && setSupported) {
    await logBadgeEvent("setAppBadge called", { unreadCount });
    try {
      await self.registration.setAppBadge(unreadCount);
      await logBadgeEvent("setAppBadge success", { unreadCount });
    } catch (error) {
      await logBadgeEvent("setAppBadge error", { unreadCount, error: String(error) });
    }
    debugBadge("setAppBadge", { unreadCount });
    return;
  }

  if (unreadCount <= 0 && clearSupported) {
    await logBadgeEvent("clearAppBadge called", { reason: "push unreadCount <= 0", source: "service worker" });
    await self.registration.clearAppBadge().catch((error) => logBadgeEvent("clearAppBadge error", { reason: "push unreadCount <= 0", error: String(error) }));
    debugBadge("clearAppBadge");
  }
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
      logBadgeEvent("push received", { messageId: payload.messageId || null, unreadCount }),
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
      logBadgeEvent("clearAppBadge called", { reason: "notificationclick", source: "service worker" }),
      "clearAppBadge" in self.registration ? self.registration.clearAppBadge().catch((error) => logBadgeEvent("clearAppBadge error", { reason: "notificationclick", error: String(error) })) : Promise.resolve(),
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
  if (event.data?.type === "family-chat-badge-debug-enable") {
    event.waitUntil(
      readBadgeDebugState().then((state) => writeBadgeDebugState({ enabled: true, events: state.events || [] }))
    );
    return;
  }

  if (event.data?.type === "family-chat-test-sw-badge") {
    const unreadCount = Number(event.data?.unreadCount || 8);
    event.waitUntil(
      (async () => {
        const supported = "setAppBadge" in self.registration;
        await logBadgeEvent("test sw badge requested", { source: "service worker", unreadCount, supported });
        if (!supported) return;
        try {
          await self.registration.setAppBadge(unreadCount);
          await logBadgeEvent("test sw badge success", { source: "service worker", unreadCount, supported });
        } catch (error) {
          await logBadgeEvent("test sw badge error", { source: "service worker", unreadCount, supported, error: String(error) });
        }
      })()
    );
    return;
  }

  if (event.data?.type === "family-chat-clear-sw-badge") {
    const reason = event.data?.reason || "debug clear sw badge";
    event.waitUntil(
      (async () => {
        const supported = "clearAppBadge" in self.registration;
        await logBadgeEvent("clear SW badge requested", { source: "service worker", reason, supported });
        if (!supported) return;
        try {
          await self.registration.clearAppBadge();
          await logBadgeEvent("clear SW badge success", { source: "service worker", reason, supported });
        } catch (error) {
          await logBadgeEvent("clear SW badge error", { source: "service worker", reason, supported, error: String(error) });
        }
      })()
    );
    return;
  }

  if (event.data?.type !== "family-chat-clear-badge") return;

  const reason = event.data?.reason || "service worker message";

  event.waitUntil(
    Promise.all([
      logBadgeEvent("clearAppBadge called", { reason, source: "service worker message" }),
      "clearAppBadge" in self.registration ? self.registration.clearAppBadge().catch((error) => logBadgeEvent("clearAppBadge error", { reason, error: String(error) })) : Promise.resolve(),
      closeChatNotifications()
    ])
  );
});
