import { NextResponse } from "next/server";
import { chatSlug } from "@/lib/config";
import { signMediaPayload } from "@/lib/media-token";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

const TOKEN_TTL_SECONDS = 5 * 60;

async function getChatId() {
  const supabase = createSupabaseAdmin();
  const { data: chat, error } = await supabase.from("chats").select("id").eq("slug", chatSlug).single();
  if (error || !chat) return null;
  return chat.id as string;
}

export async function POST(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const secret = process.env.MEDIA_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Media token secret is not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";

  if (action !== "upload" || !memberId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase.from("members").select("id").eq("id", memberId).eq("chat_id", chatId).single();
  if (!member) return NextResponse.json({ error: "Участник не найден" }, { status: 403 });

  const token = signMediaPayload(
    {
      action: "upload",
      chatId,
      memberId,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    },
    secret
  );

  return NextResponse.json({
    chat_id: chatId,
    member_id: memberId,
    token
  });
}
