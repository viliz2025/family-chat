import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

type PushSubscriptionBody = {
  member_id?: unknown;
  chat_id?: unknown;
  subscription?: {
    endpoint?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
};

export async function POST(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PushSubscriptionBody | null;
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  const chatId = typeof body?.chat_id === "string" ? body.chat_id : "";
  const endpoint = typeof body?.subscription?.endpoint === "string" ? body.subscription.endpoint : "";
  const p256dh = typeof body?.subscription?.keys?.p256dh === "string" ? body.subscription.keys.p256dh : "";
  const auth = typeof body?.subscription?.keys?.auth === "string" ? body.subscription.keys.auth : "";

  if (!memberId || !chatId || !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Нужна push-подписка" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("chat_id", chatId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Участник не найден" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      chat_id: chatId,
      member_id: memberId,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent"),
      updated_at: now,
      disabled_at: null
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: "Не удалось сохранить push-подписку" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
