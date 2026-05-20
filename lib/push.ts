import "server-only";
import webpush, { type PushSubscription, type WebPushError } from "web-push";
import { getRequiredEnv } from "@/lib/config";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

let vapidConfigured = false;

type PushPayload = {
  title: string;
  body: string;
  url: string;
  messageId: string;
};

type StoredPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function configureVapid() {
  if (vapidConfigured) return;

  webpush.setVapidDetails(
    getRequiredEnv("VAPID_SUBJECT"),
    getRequiredEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    getRequiredEnv("VAPID_PRIVATE_KEY")
  );
  vapidConfigured = true;
}

function toPushSubscription(subscription: StoredPushSubscription): PushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };
}

function isExpiredSubscriptionError(error: unknown) {
  const statusCode = (error as WebPushError | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function sendPushToChat(args: {
  chatId: string;
  senderMemberId: string;
  senderName: string;
  messageId: string;
}) {
  configureVapid();

  const supabase = createSupabaseAdmin();
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("chat_id", args.chatId)
    .neq("member_id", args.senderMemberId)
    .is("disabled_at", null);

  if (error || !subscriptions?.length) return;

  const payload: PushPayload = {
    title: "Семейный чат",
    body: `Новое сообщение от ${args.senderName || "участника"}`,
    url: "/",
    messageId: args.messageId
  };

  await Promise.all(
    (subscriptions as StoredPushSubscription[]).map(async (subscription) => {
      try {
        await webpush.sendNotification(toPushSubscription(subscription), JSON.stringify(payload));
      } catch (error) {
        if (!isExpiredSubscriptionError(error)) return;

        await supabase
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
      }
    })
  );
}
