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
  unreadCount: number;
};

type StoredPushSubscription = {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type RecipientMember = {
  id: string;
  last_read_at: string | null;
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
    .select("id,member_id,endpoint,p256dh,auth")
    .eq("chat_id", args.chatId)
    .neq("member_id", args.senderMemberId)
    .is("disabled_at", null);

  if (error || !subscriptions?.length) return;

  const recipientIds = Array.from(new Set((subscriptions as StoredPushSubscription[]).map((subscription) => subscription.member_id)));
  const { data: members } = await supabase.from("members").select("id,last_read_at").eq("chat_id", args.chatId).in("id", recipientIds);
  const membersById = new Map((members as RecipientMember[] | null | undefined)?.map((member) => [member.id, member]) || []);

  await Promise.all(
    (subscriptions as StoredPushSubscription[]).map(async (subscription) => {
      try {
        const unreadCount = await countUnreadMessages({
          chatId: args.chatId,
          recipientMemberId: subscription.member_id,
          lastReadAt: membersById.get(subscription.member_id)?.last_read_at || null
        });
        const payload: PushPayload = {
          title: "Семейный чат",
          body: `Новое сообщение от ${args.senderName || "участника"}`,
          url: "/",
          messageId: args.messageId,
          unreadCount
        };

        if (process.env.NODE_ENV !== "production") {
          console.debug("[push] unreadCount", { memberId: subscription.member_id, unreadCount });
        }

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

  async function countUnreadMessages(args: { chatId: string; recipientMemberId: string; lastReadAt: string | null }) {
    let query = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", args.chatId)
      .neq("member_id", args.recipientMemberId)
      .is("deleted_at", null)
      .in("type", ["text", "image"]);

    if (args.lastReadAt) {
      query = query.gt("created_at", args.lastReadAt);
    }

    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  }
}
