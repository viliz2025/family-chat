import { NextResponse } from "next/server";
import { chatSlug, getRequiredEnv } from "@/lib/config";
import { clearSessionCookie, setSessionCookie, hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPassword } from "@/lib/password";

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ authenticated: false });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const { data: chat, error } = await createSupabaseAdmin()
    .from("chats")
    .select("id,title,slug")
    .eq("slug", chatSlug)
    .abortSignal(controller.signal)
    .single();
  clearTimeout(timeoutId);

  if (error || !chat) {
    return NextResponse.json({ authenticated: false, error: "Чат временно недоступен" }, { status: 503 });
  }

  return NextResponse.json({ authenticated: true, chat });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const { data: chat, error } = await createSupabaseAdmin()
    .from("chats")
    .select("id,title,slug,password_hash")
    .eq("slug", chatSlug)
    .abortSignal(controller.signal)
    .single();
  clearTimeout(timeoutId);

  if (error || !chat) {
    return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  }

  const ok = verifyPassword(password, getRequiredEnv("FAMILY_CHAT_AUTH_PEPPER"), chat.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  setSessionCookie();
  return NextResponse.json({
    chat: {
      id: chat.id,
      title: chat.title,
      slug: chat.slug
    }
  });
}

export async function DELETE() {
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
