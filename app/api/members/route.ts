import { NextResponse } from "next/server";
import { chatSlug } from "@/lib/config";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { cleanName } from "@/lib/validation";
import { hashMemberPin, isValidPin, verifyMemberPin } from "@/lib/member-pin";

async function getChatId() {
  const supabase = createSupabaseAdmin();
  const { data: chat, error } = await supabase.from("chats").select("id").eq("slug", chatSlug).single();
  if (error || !chat) return null;
  return chat.id as string;
}

export async function GET(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const chatId = await getChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  }

  const supabase = createSupabaseAdmin();
  const memberId = new URL(request.url).searchParams.get("member_id");

  if (memberId) {
    const { data: member, error } = await supabase
      .from("members")
      .select("id,chat_id,name,created_at,last_seen_at,last_read_at")
      .eq("id", memberId)
      .eq("chat_id", chatId)
      .single();

    if (error || !member) {
      return NextResponse.json({ error: "Участник не найден" }, { status: 404 });
    }

    return NextResponse.json({ member });
  }

  const { data, error } = await supabase
    .from("members")
    .select("id,chat_id,name,created_at,last_seen_at,last_read_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Не удалось загрузить участников" }, { status: 500 });
  }

  return NextResponse.json({ members: data || [] });
}

export async function POST(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = cleanName(body?.name);
  const mode = body?.mode === "existing" ? "existing" : "new";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!name) {
    return NextResponse.json({ error: "Введите имя" }, { status: 400 });
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "PIN должен состоять из 4 цифр" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  const chatId = await getChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  }

  if (mode === "existing") {
    const { data: candidates, error } = await supabase
      .from("members")
      .select("id,chat_id,name,created_at,last_seen_at,last_read_at,pin_hash")
      .eq("chat_id", chatId)
      .eq("name", name)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Не удалось проверить участника" }, { status: 500 });
    }

    const member = (candidates || []).find((candidate) => verifyMemberPin(pin, candidate.pin_hash));
    if (!member) {
      return NextResponse.json({ error: "Имя или PIN не совпадают" }, { status: 401 });
    }

    await supabase
      .from("members")
      .update({
        last_seen_at: new Date().toISOString(),
        last_read_at: new Date().toISOString()
      })
      .eq("id", member.id)
      .eq("chat_id", chatId);

    const { pin_hash: _pinHash, ...safeMember } = member;
    return NextResponse.json({ member: safeMember });
  }

  const { data: member, error } = await supabase
    .from("members")
    .insert({
      chat_id: chatId,
      name,
      pin_hash: hashMemberPin(pin),
      last_seen_at: new Date().toISOString(),
      last_read_at: new Date().toISOString()
    })
    .select("id,chat_id,name,created_at,last_seen_at,last_read_at")
    .single();

  if (error || !member) {
    return NextResponse.json({ error: "Не удалось создать участника" }, { status: 500 });
  }

  await supabase.from("messages").insert({
    chat_id: chatId,
    member_id: member.id,
    type: "system",
    text: `${member.name} теперь в чате 💛`
  });

  return NextResponse.json({ member });
}

export async function PATCH(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  if (!memberId) {
    return NextResponse.json({ error: "Нужен участник" }, { status: 400 });
  }

  const chatId = await getChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  }

  const supabase = createSupabaseAdmin();
  const now = new Date().toISOString();
  const update: { last_seen_at: string; last_read_at?: string } = { last_seen_at: now };
  if (body?.mark_read === true) update.last_read_at = now;

  const { data, error } = await supabase
    .from("members")
    .update(update)
    .eq("id", memberId)
    .eq("chat_id", chatId)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Участник не найден" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
