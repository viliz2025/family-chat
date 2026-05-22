"use client";

import { type ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bell, Eye, Heart, ImagePlus, Lock, Pin, Plus, Send, Share2, Smile } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { MAX_MESSAGE_LENGTH } from "@/lib/validation";

type Chat = {
  id: string;
  title: string;
  slug: string;
};

type Member = {
  id: string;
  name: string;
};

type ChatMember = Member & {
  chat_id: string;
  created_at: string;
  last_seen_at: string | null;
  last_read_at: string | null;
};

type MemberEntryMode = "choice" | "new" | "existing";

type Message = {
  id: string;
  chat_id: string;
  member_id: string;
  type: "text" | "system" | "image";
  text: string;
  image_url?: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  members?: {
    name: string;
  } | null;
};

type EntryScrollTarget =
  | { type: "unread"; messageId: string }
  | { type: "bottom" };

type ScrollAlign = "start" | "end";

type ScrollDebugEvent = {
  event: string;
  t: number;
  at: string;
  data?: Record<string, unknown>;
};

type BadgeDebugEvent = {
  event: string;
  at: string;
  data?: Record<string, unknown>;
};

declare global {
  interface Window {
    __familyChatScrollDebug?: ScrollDebugEvent[];
    __familyChatBadgeDebug?: BadgeDebugEvent[];
  }
}

const MEMBER_ID_KEY = "family_chat_member_id";
const MEMBER_NAME_KEY = "family_chat_member_name";
const NOTIFICATION_SOUND_KEY = "family_chat_notification_sound";
const BADGE_DEBUG_KEY = "family_chat_debug_badge";
const BADGE_DEBUG_CACHE = "family-chat-badge-debug";
const BADGE_DEBUG_REQUEST = "/__family-chat-badge-debug";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN_PATTERN = /^\d{4}$/;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 45 * 1000;
const MESSAGE_POLL_MS = 8 * 1000;
const SYSTEM_MESSAGE_VISIBLE_MS = 5 * 1000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const QUICK_EMOJIS = [
  "😊",
  "🥰",
  "💛",
  "😂",
  "🤗",
  "😘",
  "🙏",
  "👍",
  "🎉"
];

export default function HomePage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [memberEntryMode, setMemberEntryMode] = useState<MemberEntryMode>("choice");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushNotice, setPushNotice] = useState("");
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [entryScrollSettled, setEntryScrollSettled] = useState(false);
  const [unreadDividerMessageId, setUnreadDividerMessageId] = useState<string | null>(null);
  const [unreadDividerHoldUntil, setUnreadDividerHoldUntil] = useState(0);
  const [badgeDebugEvents, setBadgeDebugEvents] = useState<BadgeDebugEvent[]>([]);
  const [badgeDebugInfo, setBadgeDebugInfo] = useState({
    navigatorSet: false,
    navigatorClear: false,
    registrationSet: false,
    registrationClear: false,
    userAgent: "",
    launchMode: "",
    autoStatus: "",
    copyStatus: ""
  });
  const [badgeDebugUnlocked, setBadgeDebugUnlocked] = useState(false);
  const badgeDebugTapCountRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const unreadAnchorRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fetchingMessagesRef = useRef(false);
  const pendingMessagesFetchRef = useRef(false);
  const markReadInFlightRef = useRef(false);
  const initialMessagesLoadedRef = useRef(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const memberRef = useRef<Member | null>(null);
  const fetchMessagesRef = useRef<(options?: { initial?: boolean; forceScroll?: boolean; reason?: string }) => void>(() => undefined);
  const notificationSoundEnabledRef = useRef(false);
  const scrollOnNextMessagesRef = useRef(false);
  const entryScrollPendingRef = useRef(false);
  const entryScrollTargetRef = useRef<EntryScrollTarget>({ type: "bottom" });
  const entryScrollGuardActiveRef = useRef(false);
  const entryScrollGuardTimeoutRef = useRef<number | null>(null);
  const entryScrollFallbackTimeoutRef = useRef<number | null>(null);
  const entryScrollSettledRef = useRef(false);
  const entryReadSyncedRef = useRef(false);
  const entryUnreadPendingRef = useRef(false);
  const pushNoticeTimeoutRef = useRef<number | null>(null);
  const scrollDebugStartRef = useRef(0);

  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const memberId = member?.id;
  const chatId = chat?.id;
  const onlineCount = members.filter(isOnline).length;
  const currentChatMember = member ? members.find((chatMember) => chatMember.id === member.id) ?? null : null;
  const hasCurrentMemberReadState = Boolean(currentChatMember?.last_read_at || entryReadSyncedRef.current);
  const visibleMessages = dedupeMessages(messages).filter((message) => message.type !== "system" || now - new Date(message.created_at).getTime() < SYSTEM_MESSAGE_VISIBLE_MS);
  const firstUnreadMessage =
    member && membersLoaded && hasCurrentMemberReadState ? findFirstUnreadMessage(visibleMessages, member.id, lastReadAt) : null;
  const entryScrollTarget = useMemo<EntryScrollTarget>(() => {
    if (firstUnreadMessage) return { type: "unread", messageId: firstUnreadMessage.id };
    return { type: "bottom" };
  }, [firstUnreadMessage]);
  const activeUnreadDividerMessageId = unreadDividerMessageId ?? firstUnreadMessage?.id ?? null;
  const shouldShowUnreadDivider = Boolean(activeUnreadDividerMessageId && (firstUnreadMessage || Date.now() < unreadDividerHoldUntil));
  const shouldHideMessagesForEntryScroll = authenticated && Boolean(member) && visibleMessages.length > 0 && !entryScrollSettled;
  fetchMessagesRef.current = fetchMessages;

  useEffect(() => {
    entryScrollSettledRef.current = entryScrollSettled;
  }, [entryScrollSettled]);

  const isScrollDebugEnabled = useCallback(() => {
    try {
      return new URLSearchParams(window.location.search).get("debugScroll") === "1" || localStorage.getItem("family_chat_debug_scroll") === "1";
    } catch {
      return false;
    }
  }, []);

  const logScrollDebug = useCallback(
    (event: string, data: Record<string, unknown> = {}) => {
      if (!isScrollDebugEnabled()) return;
      if (!scrollDebugStartRef.current) scrollDebugStartRef.current = performance.now();

      const panel = listRef.current;
      const distanceFromBottom = panel ? panel.scrollHeight - panel.scrollTop - panel.clientHeight : null;
      const item: ScrollDebugEvent = {
        event,
        t: Math.round(performance.now() - scrollDebugStartRef.current),
        at: new Date().toISOString(),
        data: {
          ...data,
          entryScrollSettled: entryScrollSettledRef.current,
          entryScrollPending: entryScrollPendingRef.current,
          entryScrollTarget: entryScrollTargetRef.current,
          scrollTop: panel?.scrollTop ?? null,
          scrollHeight: panel?.scrollHeight ?? null,
          clientHeight: panel?.clientHeight ?? null,
          distanceFromBottom,
          isAtBottom: typeof distanceFromBottom === "number" ? distanceFromBottom <= 2 : null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          userAgent: navigator.userAgent
        }
      };

      const events = window.__familyChatScrollDebug ?? [];
      events.push(item);
      window.__familyChatScrollDebug = events.slice(-100);
      console.debug("[scroll-debug]", item);
    },
    [isScrollDebugEnabled]
  );

  const isBadgeDebugEnabled = useCallback(() => {
    try {
      return new URLSearchParams(window.location.search).get("debugBadge") === "1" || localStorage.getItem(BADGE_DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  }, []);
  const showBadgeDebugPanel = badgeDebugUnlocked;

  const readBadgeDebugState = useCallback(async () => {
    if (!("caches" in window)) return { enabled: false, events: [] as BadgeDebugEvent[] };
    const cache = await caches.open(BADGE_DEBUG_CACHE);
    const response = await cache.match(BADGE_DEBUG_REQUEST);
    return response ? ((await response.json().catch(() => ({ enabled: false, events: [] }))) as { enabled?: boolean; events?: BadgeDebugEvent[] }) : { enabled: false, events: [] };
  }, []);

  const writeBadgeDebugState = useCallback(async (state: { enabled?: boolean; events?: BadgeDebugEvent[] }) => {
    if (!("caches" in window)) return;
    const cache = await caches.open(BADGE_DEBUG_CACHE);
    await cache.put(BADGE_DEBUG_REQUEST, new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } }));
  }, []);

  const isPwaLaunch = useCallback(() => {
    const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
    return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || standaloneNavigator.standalone);
  }, []);

  const logBadgeDebug = useCallback(
    async (event: string, data: Record<string, unknown> = {}) => {
      if (!isBadgeDebugEnabled()) return;
      const current = await readBadgeDebugState();
      const nextEvent: BadgeDebugEvent = {
        event,
        at: new Date().toISOString(),
        data: {
          ...data,
          userAgent: navigator.userAgent,
          platform: navigator.platform
        }
      };
      const events = [...(current.events || []), nextEvent].slice(-50);
      window.__familyChatBadgeDebug = events;
      await writeBadgeDebugState({ enabled: true, events });
      console.debug("[badge-debug]", nextEvent);
    },
    [isBadgeDebugEnabled, readBadgeDebugState, writeBadgeDebugState]
  );

  useEffect(() => {
    if (isBadgeDebugEnabled()) setBadgeDebugUnlocked(true);
  }, [isBadgeDebugEnabled]);

  useEffect(() => {
    if (!isBadgeDebugEnabled()) return;
    localStorage.setItem(BADGE_DEBUG_KEY, "1");

    readBadgeDebugState()
      .then((state) => {
        const events = state.events || [];
        window.__familyChatBadgeDebug = events;
        return writeBadgeDebugState({ enabled: true, events });
      })
      .then(() => navigator.serviceWorker?.ready)
      .then((registration) => {
        registration?.active?.postMessage({ type: "family-chat-badge-debug-enable" });
      })
      .then(() => logBadgeDebug("debug enabled", { source: "app" }))
      .catch(() => undefined);
  }, [isBadgeDebugEnabled, logBadgeDebug, readBadgeDebugState, writeBadgeDebugState]);

  const refreshBadgeDebug = useCallback(async () => {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
    const badgeRegistration = registration as (ServiceWorkerRegistration & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    }) | null;
    const state = await readBadgeDebugState();
    const events = state.events || [];
    window.__familyChatBadgeDebug = events;
    setBadgeDebugEvents(events);
    setBadgeDebugInfo((current) => ({
      ...current,
      navigatorSet: typeof badgeNavigator.setAppBadge === "function",
      navigatorClear: typeof badgeNavigator.clearAppBadge === "function",
      registrationSet: typeof badgeRegistration?.setAppBadge === "function",
      registrationClear: typeof badgeRegistration?.clearAppBadge === "function",
      launchMode: isPwaLaunch() ? "PWA" : "Safari",
      userAgent: navigator.userAgent
    }));
  }, [isPwaLaunch, readBadgeDebugState]);

  useEffect(() => {
    if (!isBadgeDebugEnabled()) return;
    refreshBadgeDebug().catch(() => undefined);
  }, [isBadgeDebugEnabled, refreshBadgeDebug]);

  const testAppBadge = useCallback(async () => {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
    };
    const supported = typeof badgeNavigator.setAppBadge === "function";
    await logBadgeDebug("test app badge requested", { source: "app", value: 7, supported });
    if (!supported) {
      await refreshBadgeDebug();
      return;
    }
    try {
      await badgeNavigator.setAppBadge?.(7);
      await logBadgeDebug("test app badge success", { source: "app", value: 7, supported });
    } catch (error) {
      await logBadgeDebug("test app badge error", { source: "app", value: 7, supported, error: String(error) });
    }
    await refreshBadgeDebug();
  }, [logBadgeDebug, refreshBadgeDebug]);

  const clearAppBadgeDebug = useCallback(async () => {
    const badgeNavigator = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
    };
    const supported = typeof badgeNavigator.clearAppBadge === "function";
    await logBadgeDebug("clear app badge requested", { source: "app", reason: "debug panel", supported });
    if (supported) {
      try {
        await badgeNavigator.clearAppBadge?.();
        await logBadgeDebug("clear app badge success", { source: "app", reason: "debug panel", supported });
      } catch (error) {
        await logBadgeDebug("clear app badge error", { source: "app", reason: "debug panel", supported, error: String(error) });
      }
    }
    await refreshBadgeDebug();
  }, [logBadgeDebug, refreshBadgeDebug]);

  const postBadgeDebugMessage = useCallback(async (message: Record<string, unknown>) => {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
    registration?.active?.postMessage(message);
  }, []);

  const testSwBadge = useCallback(async () => {
    await logBadgeDebug("test sw badge requested", { source: "app", value: 8 });
    await postBadgeDebugMessage({ type: "family-chat-test-sw-badge", unreadCount: 8 });
    window.setTimeout(() => refreshBadgeDebug().catch(() => undefined), 300);
  }, [logBadgeDebug, postBadgeDebugMessage, refreshBadgeDebug]);

  const clearSwBadge = useCallback(async () => {
    await logBadgeDebug("clear sw badge requested", { source: "app", reason: "debug panel" });
    await postBadgeDebugMessage({ type: "family-chat-clear-sw-badge", reason: "debug panel" });
    window.setTimeout(() => refreshBadgeDebug().catch(() => undefined), 300);
  }, [logBadgeDebug, postBadgeDebugMessage, refreshBadgeDebug]);

  const runAutomaticBadgeCheck = useCallback(async () => {
    setBadgeDebugInfo((current) => ({ ...current, autoStatus: "Проверяем..." }));
    await refreshBadgeDebug();

    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
    };
    const pwa = isPwaLaunch();
    const appSupported = typeof badgeNavigator.setAppBadge === "function";
    await logBadgeDebug("automatic badge check started", { source: "app", pwa, appSupported });

    let appResult = appSupported ? "success" : "unsupported";
    if (appSupported) {
      try {
        await badgeNavigator.setAppBadge?.(7);
        await logBadgeDebug("test app badge success", { source: "app", value: 7, supported: true, automatic: true });
      } catch (error) {
        appResult = `error: ${String(error)}`;
        await logBadgeDebug("test app badge error", { source: "app", value: 7, supported: true, automatic: true, error: String(error) });
      }
    } else {
      await logBadgeDebug("test app badge unsupported", { source: "app", value: 7, supported: false, automatic: true });
    }

    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
    const badgeRegistration = registration as (ServiceWorkerRegistration & {
      setAppBadge?: (contents?: number) => Promise<void>;
    }) | null;
    const swSupported = typeof badgeRegistration?.setAppBadge === "function";
    await logBadgeDebug("automatic sw badge check", { source: "app", swSupported });
    await postBadgeDebugMessage({ type: "family-chat-test-sw-badge", unreadCount: 8 });
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await refreshBadgeDebug();

    setBadgeDebugInfo((current) => ({
      ...current,
      autoStatus: `Готово: приложение ${appResult === "success" ? "успех" : appResult}; SW ${swSupported ? "команда отправлена" : "API недоступен"}`
    }));
  }, [isPwaLaunch, logBadgeDebug, postBadgeDebugMessage, refreshBadgeDebug]);

  const copyBadgeDebug = useCallback(async () => {
    const state = await readBadgeDebugState();
    const events = state.events || badgeDebugEvents;
    const summary = buildBadgeDebugSummary(badgeDebugInfo, events);
    await navigator.clipboard?.writeText(summary);
    setBadgeDebugInfo((current) => ({ ...current, copyStatus: "Скопировано" }));
  }, [badgeDebugEvents, badgeDebugInfo, readBadgeDebugState]);

  const unlockBadgeDebug = useCallback(() => {
    localStorage.setItem(BADGE_DEBUG_KEY, "1");
    setBadgeDebugUnlocked(true);
    badgeDebugTapCountRef.current = 0;
    readBadgeDebugState()
      .then((state) => writeBadgeDebugState({ enabled: true, events: state.events || [] }))
      .then(() => refreshBadgeDebug())
      .then(() => logBadgeDebug("debug unlocked from header taps", { source: "app" }))
      .catch(() => undefined);
  }, [logBadgeDebug, readBadgeDebugState, refreshBadgeDebug, writeBadgeDebugState]);

  const openBadgeDebugPanel = useCallback(() => {
    localStorage.setItem(BADGE_DEBUG_KEY, "1");
    setBadgeDebugUnlocked(true);
    badgeDebugTapCountRef.current = 0;
    readBadgeDebugState()
      .then((state) => writeBadgeDebugState({ enabled: true, events: state.events || [] }))
      .then(() => refreshBadgeDebug())
      .then(() => logBadgeDebug("debug opened from button", { source: "app" }))
      .catch(() => undefined);
  }, [logBadgeDebug, readBadgeDebugState, refreshBadgeDebug, writeBadgeDebugState]);

  const handleChatTitleTap = useCallback(() => {
    if (showBadgeDebugPanel) return;
    badgeDebugTapCountRef.current += 1;
    if (badgeDebugTapCountRef.current >= 7) unlockBadgeDebug();
  }, [showBadgeDebugPanel, unlockBadgeDebug]);

  const clearAppBadgeCount = useCallback((reason = "other") => {
    void logBadgeDebug("clearAppBadge called", { reason, source: "app" });
    const badgeNavigator = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
    };
    badgeNavigator.clearAppBadge?.().catch((error) => void logBadgeDebug("clearAppBadge error", { reason, error: String(error) }));
    if (process.env.NODE_ENV !== "production") console.debug("[badge] clearAppBadge");

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: "family-chat-clear-badge", reason });
        return registration.getNotifications?.({ tag: "family-chat-new-message" });
      })
      .then((notifications) => {
        if (!notifications) return;
        notifications.forEach((notification) => notification.close());
        if (process.env.NODE_ENV !== "production") console.debug("[badge] closed notifications", notifications.length);
      })
      .catch(() => undefined);
  }, [logBadgeDebug]);

  const clearUnreadIndicators = useCallback((reason = "other") => {
    setNewMessageCount(0);
    clearAppBadgeCount(reason);
  }, [clearAppBadgeCount]);

  const markChatRead = useCallback(async () => {
    if (!member || document.hidden) {
      logScrollDebug("mark_read skipped", { reason: !member ? "no member" : "document hidden" });
      return;
    }
    if (markReadInFlightRef.current) {
      logScrollDebug("mark_read skipped", { reason: "in flight" });
      return;
    }

    const readAt = new Date().toISOString();
    markReadInFlightRef.current = true;
    logScrollDebug("mark_read called", { memberId: member.id, readAt });
    if (process.env.NODE_ENV !== "production") {
      console.debug("[unread] mark_read", { memberId: member.id, readAt });
    }

    const response = await fetch("/api/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: member.id, mark_read: true })
    }).catch(() => undefined);

    markReadInFlightRef.current = false;
    if (!response?.ok) {
      logScrollDebug("mark_read failed", { status: response?.status ?? null });
      return;
    }

    setLastReadAt((current) => getLatestTimestamp(current, readAt));
    setMembers((current) =>
      current.map((chatMember) =>
        chatMember.id === member.id
          ? {
              ...chatMember,
              last_seen_at: getLatestTimestamp(chatMember.last_seen_at, readAt) ?? readAt,
              last_read_at: getLatestTimestamp(chatMember.last_read_at, readAt) ?? readAt
            }
          : chatMember
      )
    );
    entryReadSyncedRef.current = true;
    entryUnreadPendingRef.current = false;
    clearUnreadIndicators("mark_read");
  }, [member, clearUnreadIndicators, logScrollDebug]);

  const scrollToElement = useCallback(
    (
      getElement: () => HTMLElement | null,
      afterScroll?: (success: boolean) => void,
      options: { align?: ScrollAlign; behavior?: ScrollBehavior } = {}
    ) => {
      const align = options.align ?? "start";
      const behavior = options.behavior ?? "smooth";
      let didRetry = false;

      const run = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const target = getElement();
            const panel = listRef.current;

            if (target && panel) {
              const panelRect = panel.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();
              const targetTop =
                align === "end"
                  ? panel.scrollTop + targetRect.bottom - panelRect.bottom + 8
                  : panel.scrollTop + targetRect.top - panelRect.top - 8;

              const nextTop = Math.max(targetTop, 0);
              const before = panel.scrollTop;
              if (behavior === "auto") {
                panel.scrollTop = nextTop;
              } else {
                panel.scrollTo({
                  top: nextTop,
                  behavior
                });
              }
              logScrollDebug("scroll attempt", {
                kind: "anchor",
                align,
                behavior,
                before,
                after: panel.scrollTop,
                targetTop: nextTop
              });
              afterScroll?.(true);
              return;
            }

            if (!didRetry) {
              didRetry = true;
              window.setTimeout(run, 150);
              return;
            }

            afterScroll?.(false);
          });
        });
      };

      run();
    },
    [logScrollDebug]
  );

  const scrollToAnchor = useCallback(
    (anchorRef: { current: HTMLElement | null }, afterScroll?: (success: boolean) => void, options?: { align?: ScrollAlign; behavior?: ScrollBehavior }) => {
      scrollToElement(() => anchorRef.current, afterScroll, options);
    },
    [scrollToElement]
  );

  const scrollMessagesToBottom = useCallback((afterScroll?: (success: boolean) => void) => {
    let attempts = 0;
    let completed = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeScheduled = false;
    let run: () => void = () => undefined;
    const maxAttempts = 3;

    const cleanup = () => {
      completed = true;
      resizeObserver?.disconnect();
    };

    const finish = (success: boolean) => {
      cleanup();
      afterScroll?.(success);
    };

    const scheduleRun = (delay = 0) => {
      if (completed) return;
      window.setTimeout(run, delay);
    };

    const observeHeightChanges = (panel: HTMLElement) => {
      if (resizeObserver || typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(() => {
        if (completed || resizeScheduled || attempts >= maxAttempts) return;
        resizeScheduled = true;
        window.setTimeout(() => {
          resizeScheduled = false;
          attempts += 1;
          run();
        }, 150);
      });
      resizeObserver.observe(panel.firstElementChild ?? panel);
    };

    run = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const panel = listRef.current;

          if (!panel) {
            if (attempts < 2) {
              attempts += 1;
              scheduleRun(150);
              return;
            }
            finish(false);
            return;
          }

          observeHeightChanges(panel);
          const before = panel.scrollTop;
          panel.scrollTop = Math.max(panel.scrollHeight - panel.clientHeight, 0);

          const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
          const isAtBottom = distanceFromBottom <= 2;
          logScrollDebug("scroll attempt", {
            kind: "bottom",
            attempt: attempts + 1,
            before,
            after: panel.scrollTop,
            distanceFromBottom,
            isAtBottom
          });

          if (isAtBottom || attempts >= maxAttempts - 1) {
            finish(isAtBottom);
            return;
          }

          attempts += 1;
          scheduleRun(150);
        });
      });
    };

    run();
  }, [logScrollDebug]);

  const scrollToLatestMessage = useCallback(
    (afterScroll?: () => void) => {
      scrollToAnchor(bottomAnchorRef, () => afterScroll?.());
    },
    [scrollToAnchor]
  );

  const scrollUnreadAnchorInstant = useCallback(() => {
    const panel = listRef.current;
    const anchor = unreadAnchorRef.current;
    if (!panel || !anchor) return false;

    const panelRect = panel.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    panel.scrollTop = Math.max(panel.scrollTop + anchorRect.top - panelRect.top - 8, 0);
    return true;
  }, []);

  const scrollBottomInstant = useCallback(() => {
    const panel = listRef.current;
    if (!panel) return false;
    panel.scrollTop = Math.max(panel.scrollHeight - panel.clientHeight, 0);
    return true;
  }, []);

  const scheduleScrollDriftChecks = useCallback(
    (target: EntryScrollTarget) => {
      [100, 300, 700].forEach((delay) => {
        window.setTimeout(() => {
          const panel = listRef.current;
          if (!panel) return;

          if (target.type === "bottom") {
            const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
            logScrollDebug("post-entry scroll check", {
              delay,
              target,
              distanceFromBottom,
              ok: distanceFromBottom <= 2
            });
            if (distanceFromBottom > 2) logScrollDebug("scroll drift detected", { delay, target, distanceFromBottom });
            return;
          }

          const anchor = unreadAnchorRef.current;
          if (!anchor) return;
          const panelRect = panel.getBoundingClientRect();
          const anchorRect = anchor.getBoundingClientRect();
          const offset = anchorRect.top - panelRect.top;
          logScrollDebug("post-entry scroll check", {
            delay,
            target,
            offset,
            ok: Math.abs(offset - 8) <= 16
          });
          if (Math.abs(offset - 8) > 16) logScrollDebug("scroll drift detected", { delay, target, offset });
        }, delay);
      });
    },
    [logScrollDebug]
  );

  const completeEntryScroll = useCallback(
    (success: boolean) => {
      if (entryScrollFallbackTimeoutRef.current) {
        window.clearTimeout(entryScrollFallbackTimeoutRef.current);
        entryScrollFallbackTimeoutRef.current = null;
      }

      if (!success && entryScrollTargetRef.current.type === "unread") {
        scrollMessagesToBottom(() => {
          setEntryScrollSettled(true);
          logScrollDebug("entry scroll settled", { success: false, fallback: "bottom", target: entryScrollTargetRef.current });
          scheduleScrollDriftChecks({ type: "bottom" });
          if (entryScrollGuardTimeoutRef.current) window.clearTimeout(entryScrollGuardTimeoutRef.current);
          entryScrollGuardTimeoutRef.current = window.setTimeout(() => {
            entryScrollGuardActiveRef.current = false;
            entryScrollGuardTimeoutRef.current = null;
          }, 2500);
        });
        return;
      }

      setEntryScrollSettled(true);
      logScrollDebug("entry scroll settled", { success, target: entryScrollTargetRef.current });
      scheduleScrollDriftChecks(entryScrollTargetRef.current);
      if (entryScrollGuardTimeoutRef.current) window.clearTimeout(entryScrollGuardTimeoutRef.current);
      entryScrollGuardTimeoutRef.current = window.setTimeout(() => {
        entryScrollGuardActiveRef.current = false;
        entryScrollGuardTimeoutRef.current = null;
      }, 2500);
    },
    [logScrollDebug, scheduleScrollDriftChecks, scrollMessagesToBottom]
  );

  const performEntryScroll = useCallback(
    (shouldSettle: boolean) => {
      if (entryScrollPendingRef.current) entryScrollTargetRef.current = entryScrollTarget;

      const target = entryScrollTargetRef.current;
      entryUnreadPendingRef.current = target.type === "unread";

      if (target.type === "unread") {
        scrollToAnchor(unreadAnchorRef, shouldSettle ? completeEntryScroll : undefined, { align: "start", behavior: "auto" });
        return;
      }

      scrollMessagesToBottom(shouldSettle ? completeEntryScroll : undefined);
    },
    [completeEntryScroll, entryScrollTarget, scrollMessagesToBottom, scrollToAnchor]
  );

  useEffect(() => {
    const savedSoundPermission = localStorage.getItem(NOTIFICATION_SOUND_KEY) === "1";
    setNotificationSoundEnabled(savedSoundPermission);
    notificationSoundEnabledRef.current = savedSoundPermission;

    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
      logScrollDebug("scroll restoration manual");
    }

    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      } else {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => registration.unregister());
        });
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      if (pushNoticeTimeoutRef.current) window.clearTimeout(pushNoticeTimeoutRef.current);
    };
  }, [logScrollDebug]);

  useEffect(() => {
    if (!emojiOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (emojiPanelRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) return;
      setEmojiOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [emojiOpen]);

  useEffect(() => {
    if (!messages.some((message) => message.type === "system")) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [messages]);

  useEffect(() => {
    if (firstUnreadMessage) {
      setUnreadDividerMessageId(firstUnreadMessage.id);
      setUnreadDividerHoldUntil(Date.now() + 5000);
      return;
    }

    if (!unreadDividerMessageId) return;

    const remainingMs = unreadDividerHoldUntil - Date.now();
    if (remainingMs <= 0) {
      setUnreadDividerMessageId(null);
      return;
    }

    const timeoutId = window.setTimeout(() => setUnreadDividerMessageId(null), remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [firstUnreadMessage, unreadDividerMessageId, unreadDividerHoldUntil]);

  useEffect(() => {
    async function restoreSession() {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);

      try {
        const storedMember = readStoredMember();
        const response = await fetch("/api/auth", {
          signal: controller.signal
        });
        if (response.ok) {
          const data = await response.json();
          if (data.authenticated) {
            if (!storedMember) {
              setAuthenticated(false);
              setChat(null);
              setMember(null);
              setConnectionError("");
              setLoginError("");
              return;
            }
            if (!data.chat) {
              setConnectionError(data.error || "Не удалось подключиться к чату. Попробуйте обновить страницу.");
              setLoginError(data.error || "Не удалось подключиться к чату. Попробуйте обновить страницу.");
              return;
            }
            const verifiedMember = await verifyStoredMember(storedMember);
            logScrollDebug("member restored", { memberId: verifiedMember?.id ?? null, memberName: verifiedMember?.name ?? null });
            setAuthenticated(true);
            setChat(data.chat);
            setMember(verifiedMember);
          } else if (storedMember) {
            setConnectionError("Сессия входа устарела. Введите общий пароль снова.");
            setLoginError("Сессия входа устарела. Введите общий пароль снова.");
          }
        } else if (storedMember) {
          setConnectionError("Не удалось проверить сессию. Сохраненный участник не удален.");
          setLoginError("Не удалось проверить сессию. Сохраненный участник не удален.");
        }
      } catch {
        if (readStoredMember()) {
          setConnectionError("Ошибка подключения. Сохраненный участник не удален.");
          setLoginError("Ошибка подключения. Сохраненный участник не удален.");
        }
      } finally {
        window.clearTimeout(timeoutId);
        logScrollDebug("restoreSession done", { storedMember: Boolean(readStoredMember()) });
        setLoadingSession(false);
      }
    }

    restoreSession();
  }, [logScrollDebug]);

  useEffect(() => {
    if (!authenticated || !chat) return;
    logScrollDebug("entry phase started", { chatId: chat.id });
    setMembersLoaded(false);
    setNewMessageCount(0);
    setLastReadAt(null);
    setUnreadDividerMessageId(null);
    setUnreadDividerHoldUntil(0);
    setEntryScrollSettled(false);
    initialMessagesLoadedRef.current = false;
    knownMessageIdsRef.current = new Set();
    notifiedMessageIdsRef.current = new Set();
    entryScrollPendingRef.current = true;
    entryScrollTargetRef.current = { type: "bottom" };
    entryScrollGuardActiveRef.current = true;
    if (entryScrollGuardTimeoutRef.current) window.clearTimeout(entryScrollGuardTimeoutRef.current);
    entryScrollGuardTimeoutRef.current = null;
    if (entryScrollFallbackTimeoutRef.current) window.clearTimeout(entryScrollFallbackTimeoutRef.current);
    entryScrollFallbackTimeoutRef.current = null;
    entryReadSyncedRef.current = false;
    entryUnreadPendingRef.current = false;
    fetchMessagesRef.current({ initial: true, reason: "initial" });
    loadMembers();
  }, [authenticated, chat, clearUnreadIndicators, logScrollDebug]);

  useEffect(() => {
    if (!authenticated || !memberId || !chatId) {
      setPushEnabled(false);
      return;
    }

    let cancelled = false;

    const checkExistingPushSubscription = async () => {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setPushEnabled(false);
        return;
      }

      if (Notification.permission !== "granted") {
        if (!cancelled) setPushEnabled(false);
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => null);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);
      if (!cancelled) setPushEnabled(Boolean(subscription));
    };

    checkExistingPushSubscription();

    return () => {
      cancelled = true;
    };
  }, [authenticated, memberId, chatId]);

  useEffect(() => {
    memberRef.current = member;
    if (!member) {
      setLastReadAt(null);
      return;
    }
    if (!membersLoaded) return;
    if (!currentChatMember) {
      setLastReadAt(null);
      return;
    }
    logScrollDebug("current member read state", {
      memberId: member.id,
      memberName: member.name,
      lastReadAt: currentChatMember.last_read_at,
      firstUnreadId: firstUnreadMessage?.id ?? null,
      firstUnreadCreatedAt: firstUnreadMessage?.created_at ?? null,
      entryScrollTarget
    });
    setLastReadAt((current) => getLatestTimestamp(current, currentChatMember?.last_read_at ?? null));
  }, [member, membersLoaded, currentChatMember, firstUnreadMessage, entryScrollTarget, logScrollDebug]);

  useEffect(() => {
    if (!authenticated || !member || !membersLoaded || !entryScrollSettled) return;

    const markRead = () => {
      if (entryUnreadPendingRef.current) {
        logScrollDebug("mark_read skipped", { reason: "entry unread pending" });
        return;
      }
      if (!isMessagesPanelNearBottom()) {
        logScrollDebug("mark_read skipped", { reason: "not near bottom" });
        return;
      }
      markChatRead();
    };

    markRead();
    const handleVisible = () => {
      if (!document.hidden) markRead();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [authenticated, member, membersLoaded, entryScrollSettled, visibleMessages.length, markChatRead, logScrollDebug]);

  useEffect(() => {
    if (!authenticated || !member) return;

    const touchMember = async () => {
      if (document.hidden) return;

      const response = await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id })
      });

      if (response.status === 403) {
        clearStoredMember();
        setMember(null);
        return;
      }

      if (response.ok) loadMembers();
      if (!response.ok && response.status !== 403) {
        setConnectionError("Ошибка подключения. Сохраненный участник не удален.");
      }
    };

    touchMember();
    const intervalId = window.setInterval(touchMember, HEARTBEAT_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) touchMember();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authenticated, member]);

  useEffect(() => {
    if (!authenticated || !chat || !supabase) return;

    const channel = supabase
      .channel(`family-chat-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`
        },
        () => {
          if (!entryScrollSettledRef.current) {
            logScrollDebug("realtime fetch skipped", { reason: "entry phase", event: "INSERT" });
            return;
          }
          logScrollDebug("realtime fetch", { event: "INSERT" });
          fetchMessagesRef.current({ reason: "realtime insert" });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`
        },
        () => {
          if (!entryScrollSettledRef.current) {
            logScrollDebug("realtime fetch skipped", { reason: "entry phase", event: "UPDATE" });
            return;
          }
          logScrollDebug("realtime fetch", { event: "UPDATE" });
          fetchMessagesRef.current({ reason: "realtime update" });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authenticated, chat, chatId, logScrollDebug, supabase]);

  useEffect(() => {
    if (!authenticated || !member) return;

    const fetchAfterEntry = (reason: string) => {
      if (!entryScrollSettledRef.current) {
        logScrollDebug(`${reason} fetch skipped`, { reason: "entry phase" });
        return;
      }
      logScrollDebug(`${reason} fetch`);
      fetchMessagesRef.current({ reason });
    };

    const intervalId = window.setInterval(() => fetchAfterEntry("polling"), MESSAGE_POLL_MS);
    const handleFocus = () => fetchAfterEntry("focus");
    const handleOnline = () => fetchAfterEntry("online");
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchAfterEntry("visibilitychange");
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authenticated, member, memberId, logScrollDebug]);

  useEffect(() => {
    document.title = newMessageCount > 0 ? `(${newMessageCount}) Семейный чат` : "Семейный чат";
  }, [newMessageCount]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!authenticated || !member) return;
    console.debug("[unread] state", {
      memberId: member.id,
      memberName: member.name,
      currentMemberLastReadAt: currentChatMember?.last_read_at ?? null,
      usedLastReadAt: lastReadAt,
      hasCurrentMemberReadState,
      firstUnreadId: firstUnreadMessage?.id ?? null,
      firstUnreadCreatedAt: firstUnreadMessage?.created_at ?? null,
      entryScrollTarget
    });
  }, [authenticated, member, currentChatMember?.last_read_at, lastReadAt, hasCurrentMemberReadState, firstUnreadMessage, entryScrollTarget]);

  useEffect(() => {
    if (!scrollOnNextMessagesRef.current) return;
    if (entryScrollPendingRef.current) return;
    scrollOnNextMessagesRef.current = false;
    scrollToLatestMessage();
  }, [visibleMessages.length, scrollToLatestMessage]);

  useEffect(() => {
    if (!authenticated || !member || !entryScrollSettled) return;
    const panel = listRef.current;
    if (!panel) return;

    const handleScroll = () => {
      if (document.visibilityState === "visible" && isMessagesPanelNearBottom()) {
        markChatRead();
      } else {
        logScrollDebug("mark_read skipped", { reason: "scroll not readable", visible: document.visibilityState === "visible" });
      }
    };

    panel.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => panel.removeEventListener("scroll", handleScroll);
  }, [authenticated, member, entryScrollSettled, visibleMessages.length, markChatRead, logScrollDebug]);

  useLayoutEffect(() => {
    if (!authenticated || !member || !membersLoaded || entryScrollSettled || !entryScrollPendingRef.current) return;
    if (!currentChatMember) return;
    if (!initialMessagesLoadedRef.current) return;

    entryScrollTargetRef.current = entryScrollTarget;
    entryScrollPendingRef.current = false;
    logScrollDebug("entry scroll target selected", {
      target: entryScrollTarget,
      firstUnreadId: firstUnreadMessage?.id ?? null,
      firstUnreadCreatedAt: firstUnreadMessage?.created_at ?? null,
      lastReadAt
    });
    if (entryScrollFallbackTimeoutRef.current) window.clearTimeout(entryScrollFallbackTimeoutRef.current);
    entryScrollFallbackTimeoutRef.current = window.setTimeout(() => {
      const target = entryScrollTargetRef.current;
      const success = target.type === "unread" ? scrollUnreadAnchorInstant() : scrollBottomInstant();
      completeEntryScroll(success);
    }, 1500);
    performEntryScroll(true);
  }, [
    authenticated,
    member,
    membersLoaded,
    currentChatMember,
    entryScrollSettled,
    entryScrollTarget,
    completeEntryScroll,
    performEntryScroll,
    scrollBottomInstant,
    scrollUnreadAnchorInstant,
    firstUnreadMessage,
    lastReadAt,
    logScrollDebug
  ]);

  useEffect(() => {
    if (!authenticated || !member || !membersLoaded || !currentChatMember) return;
    if (!initialMessagesLoadedRef.current) return;

    const repeatEntryScrollIfNeeded = () => {
      if (!entryScrollPendingRef.current && !entryScrollGuardActiveRef.current) {
        logScrollDebug("entry repeat skipped", { reason: "not in entry phase" });
        return;
      }
      logScrollDebug("entry repeat scroll", { settle: !entryScrollSettled });
      performEntryScroll(!entryScrollSettled);
    };

    const handlePageShow = () => {
      logScrollDebug("pageshow");
      repeatEntryScrollIfNeeded();
    };
    const handleVisibilityChange = () => {
      logScrollDebug("visibilitychange", { state: document.visibilityState });
      if (document.visibilityState === "visible") repeatEntryScrollIfNeeded();
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authenticated, member, membersLoaded, currentChatMember, entryScrollSettled, performEntryScroll, logScrollDebug]);

  function readStoredMember() {
    const id = localStorage.getItem(MEMBER_ID_KEY);
    const storedName = localStorage.getItem(MEMBER_NAME_KEY);
    if (!id && !storedName) return null;
    if (!id || !storedName || !UUID_PATTERN.test(id)) {
      clearStoredMember();
      return null;
    }
    return { id, name: storedName };
  }

  function saveStoredMember(nextMember: Member) {
    localStorage.setItem(MEMBER_ID_KEY, nextMember.id);
    localStorage.setItem(MEMBER_NAME_KEY, nextMember.name);
  }

  function clearStoredMember() {
    localStorage.removeItem(MEMBER_ID_KEY);
    localStorage.removeItem(MEMBER_NAME_KEY);
  }

  async function verifyStoredMember(storedMember: Member): Promise<Member | null> {
    const response = await fetch(`/api/members?member_id=${encodeURIComponent(storedMember.id)}`).catch(() => null);
    if (!response) {
      setConnectionError("Ошибка подключения. Сохраненный участник не удален.");
      return storedMember;
    }
    if (response.status === 404 || response.status === 403) {
      clearStoredMember();
      setMember(null);
      setConnectionError("");
      return null;
    }
    if (!response.ok) {
      setConnectionError("Не удалось проверить участника. Сохраненная сессия не удалена.");
      return storedMember;
    }
    const data = await response.json().catch(() => ({}));
    if (data.member?.id && data.member?.name) {
      const verifiedMember = { id: data.member.id, name: data.member.name };
      saveStoredMember(verifiedMember);
      setConnectionError("");
      return verifiedMember;
    }
    return storedMember;
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 9000);
    let response: Response;
    let data: any = {};

    try {
      response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: controller.signal
      });
      data = await response.json().catch(() => ({}));
    } catch {
      setLoginError("Не удалось открыть чат. Попробуйте обновить страницу.");
      setIsLoggingIn(false);
      window.clearTimeout(timeoutId);
      return;
    }

    setIsLoggingIn(false);
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      setLoginError(data.error || "Неверный пароль");
      return;
    }

    setAuthenticated(true);
    setChat(data.chat);
    setConnectionError("");
    const storedMember = readStoredMember();
    if (storedMember) {
      setMember(await verifyStoredMember(storedMember));
    }
  }

  async function handleCreateMember(event: FormEvent) {
    event.preventDefault();
    setNameError("");
    setIsSavingMember(true);

    if (!PIN_PATTERN.test(pin)) {
      setNameError("PIN должен состоять из 4 цифр");
      setIsSavingMember(false);
      return;
    }

    if (memberEntryMode === "new" && pin !== pinConfirm) {
      setNameError("PIN не совпадает");
      setIsSavingMember(false);
      return;
    }

    const response = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: memberEntryMode === "existing" ? "existing" : "new",
        name,
        pin
      })
    });
    const data = await response.json().catch(() => ({}));
    setIsSavingMember(false);

    if (!response.ok) {
      setNameError(data.error || "Введите имя");
      return;
    }

    saveStoredMember({ id: data.member.id, name: data.member.name });
    setMembersLoaded(false);
    setMember({ id: data.member.id, name: data.member.name });
    setMemberEntryMode("choice");
    setPin("");
    setPinConfirm("");
    setName("");
    setMembers((current) => {
      if (current.some((chatMember) => chatMember.id === data.member.id)) return current;
      return [...current, data.member];
    });
    loadMembers();
  }

  async function fetchMessages(options: { initial?: boolean; forceScroll?: boolean; reason?: string } = {}) {
    if (fetchingMessagesRef.current) {
      pendingMessagesFetchRef.current = true;
      logScrollDebug("messages fetch queued", { reason: options.reason ?? "unknown" });
      return;
    }

    fetchingMessagesRef.current = true;
    logScrollDebug("messages fetch started", { reason: options.reason ?? "unknown", initial: Boolean(options.initial) });

    try {
      const response = await fetch("/api/messages");
      if (!response.ok) {
        logScrollDebug("messages fetch failed", { reason: options.reason ?? "unknown", status: response.status });
        return;
      }
      const data = await response.json();
      const nextMessages = dedupeMessages(data.messages || []);
      const isInitialLoad = options.initial || !initialMessagesLoadedRef.current;
      const wasNearBottom = isMessagesPanelNearBottom();
      const nextKnownIds = new Set(nextMessages.map((message) => message.id));
      const currentMember = memberRef.current;
      const newForeignMessages =
        currentMember && !isInitialLoad
          ? nextMessages.filter(
              (message) =>
                isNotifiableMessage(message, currentMember.id) &&
                !knownMessageIdsRef.current.has(message.id) &&
                !notifiedMessageIdsRef.current.has(message.id)
            )
          : [];

      setMessages(dedupeMessages(nextMessages));
      knownMessageIdsRef.current = nextKnownIds;
      logScrollDebug("messages loaded", {
        reason: options.reason ?? "unknown",
        initial: isInitialLoad,
        count: nextMessages.length,
        newForeignCount: newForeignMessages.length,
        wasNearBottom
      });

      if (isInitialLoad) {
        initialMessagesLoadedRef.current = true;
        nextMessages.forEach((message) => notifiedMessageIdsRef.current.add(message.id));
        return;
      }

      if (options.forceScroll || (newForeignMessages.length > 0 && wasNearBottom)) scrollOnNextMessagesRef.current = true;

      if (newForeignMessages.length === 0) return;

      newForeignMessages.forEach((message) => notifiedMessageIdsRef.current.add(message.id));
      if (document.visibilityState === "visible" && entryScrollSettled && wasNearBottom) {
        clearUnreadIndicators("visible_near_bottom");
        return;
      }

      setNewMessageCount((count) => count + newForeignMessages.length);
      playNotificationCue();
      navigator.vibrate?.(120);
    } finally {
      fetchingMessagesRef.current = false;
      if (pendingMessagesFetchRef.current) {
        pendingMessagesFetchRef.current = false;
        fetchMessages({ reason: "queued" });
      }
    }
  }

  async function loadMembers() {
    logScrollDebug("members fetch started");
    const response = await fetch("/api/members");
    if (!response.ok) {
      setConnectionError("Ошибка подключения. Сохраненный участник не удален.");
      return;
    }
    const data = await response.json();
    setMembers(data.members || []);
    setMembersLoaded(true);
    logScrollDebug("members loaded", {
      count: data.members?.length ?? 0,
      currentMemberId: memberRef.current?.id ?? null,
      currentMemberLastReadAt: (data.members || []).find((chatMember: ChatMember) => chatMember.id === memberRef.current?.id)?.last_read_at ?? null
    });
    setConnectionError("");
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !member) return;

    setSendError("");
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_id: member.id,
        text
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 403) {
        clearStoredMember();
        setMember(null);
      }
      setSendError(data.error || "Не удалось отправить");
      return;
    }

    setDraft("");
    setEmojiOpen(false);
    loadMembers();
    knownMessageIdsRef.current.add(data.message.id);
    notifiedMessageIdsRef.current.add(data.message.id);
    scrollOnNextMessagesRef.current = true;
    setMessages((current) => {
      if (current.some((message) => message.id === data.message.id)) return current;
      return dedupeMessages([...current, data.message]);
    });
  }

  function handleQuickEmoji(value: string) {
    setDraft((current) => {
      const separator = current.length > 0 && !current.endsWith(" ") ? " " : "";
      return `${current}${separator}${value}`.slice(0, MAX_MESSAGE_LENGTH);
    });
  }

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !member) return;

    if (!IMAGE_TYPES.includes(file.type)) {
      setSendError("Можно отправить только jpg, png или webp");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setSendError("Фото должно быть до 20 МБ");
      return;
    }

    setSendError("");
    setEmojiOpen(false);
    setIsUploadingImage(true);

    const prepareResponse = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_id: member.id,
        prepare_image: true,
        file_type: file.type,
        file_size: file.size
      })
    });
    const prepared = await prepareResponse.json().catch(() => ({}));

    if (!prepareResponse.ok || !prepared.path || !prepared.token) {
      setIsUploadingImage(false);
      setSendError(getImageUploadError(prepareResponse.status, prepared.error));
      return;
    }

    if (!supabase) {
      setIsUploadingImage(false);
      setSendError("Не удалось загрузить фото");
      return;
    }

    const { error: uploadError } = await supabase.storage.from("family-chat-photos").uploadToSignedUrl(prepared.path, prepared.token, file);
    if (uploadError) {
      setIsUploadingImage(false);
      setSendError("Не удалось загрузить фото");
      return;
    }

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_id: member.id,
        image_path: prepared.path
      })
    });
    const data = await response.json().catch(() => ({}));
    setIsUploadingImage(false);

    if (!response.ok) {
      if (response.status === 403) {
        clearStoredMember();
        setMember(null);
      }
      setSendError(getImageUploadError(response.status, data.error));
      return;
    }

    loadMembers();
    knownMessageIdsRef.current.add(data.message.id);
    notifiedMessageIdsRef.current.add(data.message.id);
    scrollOnNextMessagesRef.current = true;
    setMessages((current) => {
      if (current.some((message) => message.id === data.message.id)) return current;
      return dedupeMessages([...current, data.message]);
    });
  }

  function getImageUploadError(status: number, error?: string) {
    if (status === 400) return "Можно отправить только фото jpg, png или webp до 20 МБ";
    if (status === 403) return "Сессия устарела. Войдите в чат снова.";
    return error && !error.includes("Р") ? error : "Не удалось загрузить фото";
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !isTouchLike()) {
      event.preventDefault();
      handleSend();
    }
  }

  function isTouchLike() {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    clearStoredMember();
    setAuthenticated(false);
    setChat(null);
    setMember(null);
    setMessages([]);
    setMembers([]);
    setMembersLoaded(false);
    setMembersOpen(false);
    setLogoutOpen(false);
    setLastReadAt(null);
    setPassword("");
    setName("");
    setDraft("");
    setLoginError("");
    setNameError("");
    setSendError("");
    setEmojiOpen(false);
    setImageViewerUrl(null);
    setIsUploadingImage(false);
    clearUnreadIndicators("logout");
    setEntryScrollSettled(false);
    fetchingMessagesRef.current = false;
    pendingMessagesFetchRef.current = false;
    initialMessagesLoadedRef.current = false;
    knownMessageIdsRef.current = new Set();
    notifiedMessageIdsRef.current = new Set();
    memberRef.current = null;
    scrollOnNextMessagesRef.current = false;
    entryScrollPendingRef.current = false;
    entryScrollTargetRef.current = { type: "bottom" };
    entryScrollGuardActiveRef.current = false;
    if (entryScrollGuardTimeoutRef.current) window.clearTimeout(entryScrollGuardTimeoutRef.current);
    entryScrollGuardTimeoutRef.current = null;
    if (entryScrollFallbackTimeoutRef.current) window.clearTimeout(entryScrollFallbackTimeoutRef.current);
    entryScrollFallbackTimeoutRef.current = null;
    entryReadSyncedRef.current = false;
    entryUnreadPendingRef.current = false;
  }

  async function handleDeleteMessage() {
    if (!messageToDelete || !member) return;

    const targetMessage = messageToDelete;
    setMessageToDelete(null);

    const response = await fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: targetMessage.id,
        member_id: member.id
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setSendError(data.error || "Не удалось удалить сообщение");
      return;
    }

    setMessages((current) => dedupeMessages(current.map((message) => (message.id === data.message.id ? data.message : message))));
  }

  async function handleInstallClick() {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => undefined);
      setInstallPrompt(null);
      return;
    }

    setInstallHelpOpen(true);
  }

  function enableNotificationSound() {
    localStorage.setItem(NOTIFICATION_SOUND_KEY, "1");
    notificationSoundEnabledRef.current = true;
    setNotificationSoundEnabled(true);
    playNotificationCue();
  }

  function showPushNotice(message: string, autoHide = true) {
    if (pushNoticeTimeoutRef.current) {
      window.clearTimeout(pushNoticeTimeoutRef.current);
      pushNoticeTimeoutRef.current = null;
    }

    setPushNotice(message);
    if (!autoHide) return;

    pushNoticeTimeoutRef.current = window.setTimeout(() => {
      setPushNotice("");
      pushNoticeTimeoutRef.current = null;
    }, 4000);
  }

  async function enablePushNotifications() {
    if (!member || !chat) return;

    setIsEnablingPush(true);
    setPushNotice("");

    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        showPushNotice("Оповещения не поддерживаются");
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
      if (!vapidPublicKey) {
        showPushNotice("Не удалось включить оповещения");
        return;
      }

      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        showPushNotice("Оповещения запрещены в браузере");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: member.id,
          chat_id: chat.id,
          subscription: subscription.toJSON()
        })
      });

      if (!response.ok) {
        showPushNotice("Не удалось включить оповещения");
        return;
      }

      setPushEnabled(true);
      showPushNotice("Оповещения включены");
    } catch {
      showPushNotice("Не удалось включить оповещения");
    } finally {
      setIsEnablingPush(false);
    }
  }

  function handleNewMessageClick() {
    clearUnreadIndicators("new_message_click");
    scrollOnNextMessagesRef.current = true;
    scrollToLatestMessage();
  }

  function isMessagesPanelNearBottom() {
    const panel = listRef.current;
    if (!panel) return true;
    return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
  }

  function playNotificationCue() {
    if (!notificationSoundEnabledRef.current) return;

    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(980, audioContext.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.18);
      window.setTimeout(() => audioContext.close().catch(() => undefined), 250);
    } catch {
      // Browser audio permissions differ, so notification sound is best-effort.
    }
  }

  function renderMemberEntryPrompt() {
    if (memberEntryMode === "choice") {
      return (
        <div className="name-modal">
          <h2>Как войти?</h2>
          <button className="primary-button" type="button" onClick={() => setMemberEntryMode("new")}>
            Я новый участник
          </button>
          <button className="secondary-button" type="button" onClick={() => setMemberEntryMode("existing")}>
            Я уже участник
          </button>
          {connectionError && <p className="error-text">{connectionError}</p>}
        </div>
      );
    }

    return (
      <form className="name-modal" onSubmit={handleCreateMember}>
        <h2>Как вас зовут?</h2>
        <label className="field-label" htmlFor="member-name">
          Ваше имя
        </label>
        <input
          className="text-input"
          id="member-name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="field-label" htmlFor="member-pin">
          PIN из 4 цифр
        </label>
        <input
          className="text-input"
          id="member-pin"
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]{4}"
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        {memberEntryMode === "new" && (
          <>
            <label className="field-label" htmlFor="member-pin-confirm">
              Повторите PIN
            </label>
            <input
              className="text-input"
              id="member-pin-confirm"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]{4}"
              type="password"
              value={pinConfirm}
              onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </>
        )}
        <p className="error-text">{nameError}</p>
        <button className="primary-button" type="submit" disabled={isSavingMember}>
          Войти в чат
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setMemberEntryMode("choice");
            setNameError("");
            setPin("");
            setPinConfirm("");
          }}
        >
          Назад
        </button>
      </form>
    );
  }

  const lastAppBadgeTest = getLastBadgeEvent(badgeDebugEvents, ["test app badge success", "test app badge error", "test app badge unsupported"]);
  const lastSwBadgeTest = getLastBadgeEvent(badgeDebugEvents, ["test sw badge success", "test sw badge error", "test sw badge requested"]);
  const lastClearBadge = getLastBadgeEvent(badgeDebugEvents, [
    "clearAppBadge called",
    "clear app badge success",
    "clear SW badge success",
    "clear sw badge requested",
    "clearAppBadge error"
  ]);
  const lastPushBadge = getLastBadgeEvent(badgeDebugEvents, ["push received"]);
  const readableBadgeSummary = buildBadgeDebugSummary(badgeDebugInfo, badgeDebugEvents);

  if (loadingSession) {
    return (
      <main className="app-shell">
        <div className="phone-frame login-frame">
          <div className="loading">Открываем семейный чат...</div>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="app-shell">
        <div className="phone-frame login-frame">
          <section className="screen login-screen">
            <div className="login-art" aria-hidden="true">
              <img className="family-hero-image" src="/family-hero.png" alt="" />
            </div>

            <div className="hero-copy">
              <div className="heart-mark">♥</div>
              <h1>Семейный чат</h1>
              <p className="subtitle">Уютное место для общения с близкими</p>
            </div>

            <form className="login-form" onSubmit={handleLogin}>
              <label className="input-wrap" htmlFor="password">
                <Lock size={24} />
                <span className="sr-only">Пароль</span>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Пароль"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Eye size={25} />
              </label>
              <p className="error-text">{loginError}</p>
              <button className="primary-button" type="submit" disabled={isLoggingIn}>
                {isLoggingIn ? "Входим..." : "Войти"}
              </button>
              <button className="secondary-button" type="button" onClick={handleInstallClick}>
                <Plus size={24} />
                Добавить на телефон
              </button>
              <p className="install-hint">Чтобы открывать чат с иконки на главном экране</p>
            </form>

            <div className="footer-note">
              <span />
              <Heart size={18} fill="currentColor" />
              <span />
            </div>
            <p className="footer-text">Только для своих</p>
          </section>
        </div>
        {installHelpOpen && <InstallHelp onClose={() => setInstallHelpOpen(false)} />}
      </main>
    );
  }

  if (!member) {
    return (
      <main className="app-shell">
        <div className="phone-frame login-frame">
          <section className="screen login-screen">{renderMemberEntryPrompt()}</section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell chat-app-shell">
      <div className="phone-frame chat-frame">
        <section className="chat-screen">
          <div className="chat-decor" aria-hidden="true">
            <span className="decor-heart decor-heart-a">♥</span>
            <span className="decor-heart decor-heart-b">♥</span>
            <span className="decor-heart decor-heart-c">♥</span>
            <span className="decor-leaf decor-leaf-a">⌇</span>
            <span className="decor-leaf decor-leaf-b">⌇</span>
            <span className="decor-leaf decor-leaf-c">⌇</span>
            <span className="decor-leaf decor-leaf-d">⌇</span>
          </div>
          <div className="chat-top">
          <header className="chat-header">
            <button className="back-button" type="button" aria-label="Назад" onClick={() => setLogoutOpen(true)}>
              ‹
            </button>
            <div>
              <h1 className="chat-title" onClick={handleChatTitleTap}>Семейный чат</h1>
              <p className="chat-subtitle">
                <span /> для своих
              </p>
            </div>
            <img className="header-icon" src="/icons/icon-192.png" alt="" />
          </header>
          <button className="chat-subtitle members-toggle" type="button" onClick={() => setMembersOpen((open) => !open)}>
            <span /> {formatMembersSummary(members.length, onlineCount)}
          </button>
          {!notificationSoundEnabled && (
            <button className="notification-sound-button" type="button" onClick={enableNotificationSound}>
              Включить звук уведомлений
            </button>
          )}
          {member && (!pushEnabled || pushNotice) && (
            <>
              {!pushEnabled && (
                <button className="notification-sound-button" type="button" onClick={enablePushNotifications} disabled={isEnablingPush}>
                  <Bell size={18} />
                  {isEnablingPush ? "Включаем..." : "Включить push-уведомления"}
                </button>
              )}
              {pushNotice && <p className="install-hint">{pushNotice}</p>}
            </>
          )}
          {member && (
            <button className="badge-debug-open-button" type="button" onClick={openBadgeDebugPanel}>
              Диагностика badge
            </button>
          )}
          {showBadgeDebugPanel && (
            <section className="badge-debug-panel" aria-label="Badge debug">
              <p className="badge-debug-title">Проверка badge на iPhone</p>
              {badgeDebugInfo.launchMode === "Safari" && (
                <p className="badge-debug-warning">Badge на iPhone работает только у приложения, добавленного на экран Домой. Открой чат с иконки на рабочем столе.</p>
              )}
              {!badgeDebugInfo.navigatorSet && (
                <p className="badge-debug-warning">Этот запуск PWA не даёт доступ к badge API. Реальный push не сможет поставить цифру на иконку, пока этот тест не станет доступен.</p>
              )}
              <div className="badge-debug-grid">
                <span>Режим запуска</span>
                <strong>{badgeDebugInfo.launchMode ? (badgeDebugInfo.launchMode === "PWA" ? "Открыто как PWA" : "Открыто в Safari") : "Определяем..."}</strong>
                <span>navigator.setAppBadge</span>
                <strong>{badgeDebugInfo.navigatorSet ? "доступен" : "недоступен"}</strong>
                <span>serviceWorkerRegistration.setAppBadge</span>
                <strong>{badgeDebugInfo.registrationSet ? "доступен" : "недоступен"}</strong>
                <span>Последний тест app badge</span>
                <strong>{getBadgeEventStatus(lastAppBadgeTest)}</strong>
                <span>Последний тест SW badge</span>
                <strong>{getBadgeEventStatus(lastSwBadgeTest)}</strong>
                <span>Последний clear badge</span>
                <strong>{getLastClearText(lastClearBadge)}</strong>
                <span>Последний push</span>
                <strong>{getLastPushText(lastPushBadge)}</strong>
              </div>
              <p className="badge-debug-agent">{badgeDebugInfo.userAgent || "userAgent loading..."}</p>
              <div className="badge-debug-actions">
                <button type="button" onClick={runAutomaticBadgeCheck}>Проверить badge автоматически</button>
                <button type="button" onClick={testAppBadge}>Test app badge 7</button>
                <button type="button" onClick={clearAppBadgeDebug}>Clear app badge</button>
                <button type="button" onClick={testSwBadge}>Test SW badge 8</button>
                <button type="button" onClick={clearSwBadge}>Clear SW badge</button>
                <button type="button" onClick={() => refreshBadgeDebug().catch(() => undefined)}>Обновить</button>
                <button type="button" onClick={() => copyBadgeDebug().catch(() => undefined)}>Скопировать результат проверки</button>
              </div>
              {badgeDebugInfo.autoStatus && <p className="badge-debug-status">{badgeDebugInfo.autoStatus}</p>}
              {badgeDebugInfo.copyStatus && <p className="badge-debug-status">{badgeDebugInfo.copyStatus}</p>}
              <pre className="badge-debug-log">{readableBadgeSummary}</pre>
            </section>
          )}
          {newMessageCount > 0 && (
            <button className="new-message-banner" type="button" onClick={handleNewMessageClick}>
              Новое сообщение {newMessageCount > 1 ? newMessageCount : ""}
            </button>
          )}
          {membersOpen && (
            <div className="members-panel">
              <p className="members-title">Кто в чате</p>
              <div className="members-list">
                {members.map((chatMember) => (
                  <div className="member-row" key={chatMember.id}>
                    <span className={`member-dot ${isOnline(chatMember) ? "online" : ""}`} />
                    <span className="member-name">{chatMember.name}</span>
                    <span className="member-status">{isOnline(chatMember) ? "онлайн" : "был(а) недавно"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          <div className="family-note">
            <div className="note-heart">♥</div>
            <div>
              <p>Уютное место для близких</p>
              <span>Только для своих ♥</span>
            </div>
            <Pin className="note-pin" size={24} aria-hidden="true" />
          </div>

          <div className={`messages-panel ${shouldHideMessagesForEntryScroll ? "entry-scroll-hidden" : ""}`} ref={listRef}>
            {visibleMessages.length === 0 ? (
              <p className="empty-state">История хранится 15 дней, чтобы чат оставался лёгким, быстрым и приватным.</p>
            ) : (
              <div className="message-list">
                {visibleMessages.map((message, index) => (
                  <div className="message-item" data-message-id={message.id} key={message.id}>
                  {shouldShowDateSeparator(visibleMessages, index) && (
                    <div className="date-separator">{formatDateSeparator(message.created_at)}</div>
                  )}
                  {activeUnreadDividerMessageId === message.id && shouldShowUnreadDivider && (
                    <div className="unread-anchor" ref={unreadAnchorRef}>
                      <div className="unread-separator">Непрочитанные сообщения</div>
                    </div>
                  )}
                  {message.type === "system" ? (
                  <div className="system-message">
                    {message.text}
                  </div>
                  ) : (
                  <article className="message-row">
                    <div className="message-stack">
                      <div className={`message-author ${message.member_id === member?.id ? "own" : ""}`}>
                        {message.members?.name || "Семья"}
                      </div>
                        <div className={`message ${message.member_id === member?.id ? "own" : "other"} ${message.deleted_at ? "deleted" : ""} ${message.type === "image" ? "image" : ""}`}>
                          {message.deleted_at ? (
                            <span className="message-text">Сообщение удалено</span>
                          ) : message.type === "image" ? (
                            message.image_url ? (
                              <button className="message-image-button" type="button" onClick={() => setImageViewerUrl(message.image_url || null)}>
                                <img className="message-image" src={message.image_url} alt="Фото в чате" />
                              </button>
                            ) : (
                              <span className="message-text">Фото недоступно</span>
                            )
                          ) : (
                            <span className="message-text">{message.text}</span>
                          )}
                          <time className="message-time">{formatTime(message.created_at)}</time>
                        </div>
                        {!message.deleted_at && message.member_id === member?.id && (
                          <button className="delete-message-button" type="button" onClick={() => setMessageToDelete(message)}>
                            Удалить
                          </button>
                        )}
                      </div>
                    </article>
                  )}
                  </div>
                ))}
              </div>
            )}
            <div className="bottom-anchor" ref={bottomAnchorRef} aria-hidden="true" />
          </div>

          <div>
            {sendError && <p className="error-text">{sendError}</p>}
            <div className="composer">
              <button
                className="composer-smile emoji-toggle"
                type="button"
                aria-label="Quick emojis"
                ref={emojiButtonRef}
                onClick={() => setEmojiOpen((open) => !open)}
              >
                <Smile size={25} aria-hidden="true" />
              </button>
              {emojiOpen && (
                <div className="quick-emoji-panel" ref={emojiPanelRef}>
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      aria-label={`Добавить ${emoji}`}
                      className="quick-emoji"
                      key={emoji}
                      onClick={() => handleQuickEmoji(emoji)}
                      type="button"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="message-input"
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Написать сообщение..."
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleMessageKeyDown}
              />
              <input
                ref={imageInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleImageSelect}
              />
              <button
                className="image-upload-button"
                type="button"
                aria-label="Добавить фото"
                disabled={isUploadingImage}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlus size={22} />
              </button>
              <button className="send-button" type="button" aria-label="Отправить" onClick={handleSend}>
                <Send size={24} fill="currentColor" />
              </button>
            </div>
          </div>
        </section>
      </div>

      {logoutOpen && (
        <div className="logout-backdrop">
          <div className="logout-modal">
            <h2>Выйти из чата?</h2>
            <p className="small-note">Чтобы вернуться, введите пароль и имя снова.</p>
            <div className="logout-actions">
              <button className="secondary-button" type="button" onClick={() => setLogoutOpen(false)}>
                Остаться
              </button>
              <button className="primary-button" type="button" onClick={handleLogout}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

      {messageToDelete && (
        <div className="confirm-backdrop">
          <div className="confirm-modal">
            <h2>Удалить сообщение?</h2>
            <p className="small-note">Это действие нельзя будет отменить.</p>
            <div className="confirm-actions">
              <button className="secondary-button" type="button" onClick={() => setMessageToDelete(null)}>
                Отмена
              </button>
              <button className="primary-button" type="button" onClick={handleDeleteMessage}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {imageViewerUrl && (
        <div className="image-viewer-backdrop" onClick={() => setImageViewerUrl(null)}>
          <button className="image-viewer-close" type="button" aria-label="Закрыть фото">
            ×
          </button>
          <img className="image-viewer" src={imageViewerUrl} alt="Фото в чате" />
        </div>
      )}
    </main>
  );
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function shouldShowDateSeparator(messages: Message[], index: number) {
  if (index === 0) return true;
  return getDateKey(messages[index].created_at) !== getDateKey(messages[index - 1].created_at);
}

function formatDateSeparator(value: string) {
  const key = getDateKey(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (key === getDateKey(today.toISOString())) return "Сегодня";
  if (key === getDateKey(yesterday.toISOString())) return "Вчера";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function getDateKey(value: string) {
  return new Intl.DateTimeFormat("sv-SE").format(new Date(value));
}

function isOnline(member: ChatMember) {
  if (!member.last_seen_at) return false;
  return Date.now() - new Date(member.last_seen_at).getTime() <= ONLINE_WINDOW_MS;
}

function isNotifiableMessage(message: Message, memberId: string) {
  return (
    (message.type === "text" || message.type === "image") &&
    !message.deleted_at &&
    message.member_id !== memberId
  );
}

function findFirstUnreadMessage(messages: Message[], memberId: string, lastReadAt: string | null) {
  return messages.find((message) => isEntryUnread(message, memberId, lastReadAt)) ?? null;
}

function isEntryUnread(message: Message, memberId: string, lastReadAt: string | null) {
  if (!isNotifiableMessage(message, memberId)) return false;
  if (!lastReadAt) return true;
  return new Date(message.created_at).getTime() > new Date(lastReadAt).getTime();
}

function getLatestTimestamp(first: string | null, second: string | null) {
  if (!first) return second;
  if (!second) return first;
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second;
}

function dedupeMessages(messages: Message[]) {
  return Array.from(new Map(messages.map((message) => [message.id, message])).values()).sort(
    (first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  );
}

function getLastBadgeEvent(events: BadgeDebugEvent[], names: string[]) {
  return [...events].reverse().find((event) => names.includes(event.event)) ?? null;
}

function getBadgeEventStatus(event: BadgeDebugEvent | null) {
  if (!event) return "не запускался";
  if (event.event.includes("success")) return `успех (${formatDebugTime(event.at)})`;
  if (event.event.includes("unsupported")) return `недоступен (${formatDebugTime(event.at)})`;
  if (event.event.includes("error")) return `ошибка: ${String(event.data?.error || "неизвестно")} (${formatDebugTime(event.at)})`;
  return `запущен (${formatDebugTime(event.at)})`;
}

function getLastClearText(event: BadgeDebugEvent | null) {
  if (!event) return "нет событий очистки";
  return `${String(event.data?.reason || event.event)} · ${formatDebugTime(event.at)}`;
}

function getLastPushText(event: BadgeDebugEvent | null) {
  if (!event) return "push ещё не записан";
  return `unreadCount: ${String(event.data?.unreadCount ?? "нет")}; messageId: ${String(event.data?.messageId ?? "нет")}; ${formatDebugTime(event.at)}`;
}

function buildBadgeDebugSummary(
  info: { navigatorSet: boolean; navigatorClear: boolean; registrationSet: boolean; registrationClear: boolean; launchMode: string; userAgent: string },
  events: BadgeDebugEvent[]
) {
  const lastAppBadgeTest = getLastBadgeEvent(events, ["test app badge success", "test app badge error", "test app badge unsupported"]);
  const lastSwBadgeTest = getLastBadgeEvent(events, ["test sw badge success", "test sw badge error", "test sw badge requested"]);
  const lastClear = getLastBadgeEvent(events, ["clearAppBadge called", "clear app badge success", "clear SW badge success", "clear sw badge requested", "clearAppBadge error"]);
  const lastPush = getLastBadgeEvent(events, ["push received"]);
  const clearAfterPush = Boolean(lastClear && lastPush && new Date(lastClear.at).getTime() >= new Date(lastPush.at).getTime());

  return [
    `Устройство: ${info.userAgent.includes("iPhone") ? "iPhone" : "не iPhone / неизвестно"}`,
    `Режим: ${info.launchMode || "не определён"}`,
    `navigator.setAppBadge: ${info.navigatorSet ? "доступен" : "недоступен"}`,
    `navigator.clearAppBadge: ${info.navigatorClear ? "доступен" : "недоступен"}`,
    `SW setAppBadge: ${info.registrationSet ? "доступен" : "недоступен"}`,
    `SW clearAppBadge: ${info.registrationClear ? "доступен" : "недоступен"}`,
    `app badge test: ${getBadgeEventStatus(lastAppBadgeTest)}`,
    `SW badge test: ${getBadgeEventStatus(lastSwBadgeTest)}`,
    `Последний push unreadCount: ${lastPush ? String(lastPush.data?.unreadCount ?? "нет") : "push ещё не записан"}`,
    `Последний push messageId: ${lastPush ? String(lastPush.data?.messageId ?? "нет") : "push ещё не записан"}`,
    `clear badge после push: ${clearAfterPush ? `да, ${String(lastClear?.data?.reason || lastClear?.event)}` : "нет"}`,
    `Последний clear: ${getLastClearText(lastClear)}`,
    `UserAgent: ${info.userAgent || "не определён"}`
  ].join("\n");
}

function formatDebugTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatMembersSummary(total: number, online: number) {
  return `${total} ${pluralize(total, "участник", "участника", "участников")} · ${online} онлайн`;
}

function pluralize(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="install-backdrop" onClick={onClose}>
      <div className="install-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Добавить на телефон</h2>
        <p className="small-note">
          На Android установка появится автоматически, если браузер поддерживает PWA. На iPhone добавление делается
          вручную через Safari.
        </p>
        <ol>
          <li>Нажмите «Поделиться»</li>
          <li>Выберите «На экран Домой»</li>
          <li>Нажмите «Добавить»</li>
        </ol>
        <button className="secondary-button" type="button" onClick={onClose}>
          <Share2 size={20} />
          Понятно
        </button>
      </div>
    </div>
  );
}
