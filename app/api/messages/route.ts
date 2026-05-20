import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { chatSlug } from "@/lib/config";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { cleanMessage } from "@/lib/validation";
import { sendPushToChat } from "@/lib/push";

const PHOTO_BUCKET = "family-chat-photos";
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const MESSAGE_SELECT = "id,chat_id,member_id,type,text,created_at,deleted_at,deleted_by,members!messages_member_id_fkey(name)";

async function getChatId() {
  const supabase = createSupabaseAdmin();
  const { data: chat, error } = await supabase.from("chats").select("id").eq("slug", chatSlug).single();
  if (error || !chat) return null;
  return chat.id as string;
}

export async function GET() {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: "Не удалось загрузить сообщения" }, { status: 500 });
  }

  return NextResponse.json({ messages: await withImageUrls(supabase, [...(data || [])].reverse()) });
}

export async function POST(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return createImageMessage(request);
  }

  const body = await request.json().catch(() => null);
  if (body?.prepare_image) return prepareImageUpload(body);
  if (typeof body?.image_path === "string") return createImageMessageFromPath(body);

  const text = cleanMessage(body?.text);
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  if (!text) return NextResponse.json({ error: "Сообщение пустое" }, { status: 400 });
  if (!memberId) return NextResponse.json({ error: "Нужен участник" }, { status: 400 });

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase.from("members").select("id,name").eq("id", memberId).eq("chat_id", chatId).single();
  if (!member) return NextResponse.json({ error: "Участник не найден" }, { status: 403 });

  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      member_id: memberId,
      type: "text",
      text
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Не удалось отправить сообщение" }, { status: 500 });
  }

  await supabase.from("members").update({ last_seen_at: new Date().toISOString() }).eq("id", memberId);
  await sendPushToChat({
    chatId,
    senderMemberId: memberId,
    senderName: member.name,
    messageId: data.id
  }).catch(() => undefined);
  return NextResponse.json({ message: data });
}

async function prepareImageUpload(body: any) {
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  const fileType = typeof body?.file_type === "string" ? body.file_type : "";
  const fileSize = Number(body?.file_size || 0);

  if (!memberId) return NextResponse.json({ error: "Нужен участник" }, { status: 400 });
  if (!IMAGE_TYPES[fileType] || fileSize <= 0 || fileSize > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Можно отправить только фото jpg, png или webp до 20 МБ" }, { status: 400 });
  }

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase.from("members").select("id").eq("id", memberId).eq("chat_id", chatId).single();
  if (!member) return NextResponse.json({ error: "Участник не найден" }, { status: 403 });

  const path = `${chatId}/${memberId}/${Date.now()}-${randomUUID()}.${IMAGE_TYPES[fileType]}`;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Не удалось подготовить загрузку фото" }, { status: 500 });

  return NextResponse.json({ path: data.path, token: data.token });
}

async function createImageMessageFromPath(body: any) {
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  const imagePath = typeof body?.image_path === "string" ? body.image_path : "";

  if (!memberId || !imagePath) return NextResponse.json({ error: "Нужно фото" }, { status: 400 });

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  if (!imagePath.startsWith(`${chatId}/${memberId}/`)) return NextResponse.json({ error: "Фото не найдено" }, { status: 403 });

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase.from("members").select("id,name").eq("id", memberId).eq("chat_id", chatId).single();
  if (!member) return NextResponse.json({ error: "Участник не найден" }, { status: 403 });

  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      member_id: memberId,
      type: "image",
      text: imagePath
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error || !data) return NextResponse.json({ error: "Не удалось отправить фото" }, { status: 500 });

  await supabase.from("members").update({ last_seen_at: new Date().toISOString() }).eq("id", memberId);
  await sendPushToChat({
    chatId,
    senderMemberId: memberId,
    senderName: member.name,
    messageId: data.id
  }).catch(() => undefined);
  const [message] = await withImageUrls(supabase, [data]);
  return NextResponse.json({ message });
}

async function createImageMessage(request: Request) {
  const formData = await request.formData().catch(() => null);
  const memberId = typeof formData?.get("member_id") === "string" ? String(formData.get("member_id")) : "";
  const file = formData?.get("image");

  if (!memberId) return NextResponse.json({ error: "РќСѓР¶РµРЅ СѓС‡Р°СЃС‚РЅРёРє" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "РќСѓР¶РЅРѕ С„РѕС‚Рѕ" }, { status: 400 });
  if (!IMAGE_TYPES[file.type]) return NextResponse.json({ error: "РџРѕРґРґРµСЂР¶РёРІР°СЋС‚СЃСЏ С‚РѕР»СЊРєРѕ jpg, png Рё webp" }, { status: 400 });
  if (file.size > MAX_IMAGE_SIZE) return NextResponse.json({ error: "Р¤РѕС‚Рѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РґРѕ 5 РњР‘" }, { status: 400 });

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Р§Р°С‚ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data: member } = await supabase.from("members").select("id,name").eq("id", memberId).eq("chat_id", chatId).single();
  if (!member) return NextResponse.json({ error: "РЈС‡Р°СЃС‚РЅРёРє РЅРµ РЅР°Р№РґРµРЅ" }, { status: 403 });

  const path = `${chatId}/${memberId}/${Date.now()}-${randomUUID()}.${IMAGE_TYPES[file.type]}`;
  const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  });

  if (uploadError) {
    return NextResponse.json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ С„РѕС‚Рѕ" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      member_id: memberId,
      type: "image",
      text: path
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error || !data) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return NextResponse.json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ С„РѕС‚Рѕ" }, { status: 500 });
  }

  await supabase.from("members").update({ last_seen_at: new Date().toISOString() }).eq("id", memberId);
  await sendPushToChat({
    chatId,
    senderMemberId: memberId,
    senderName: member.name,
    messageId: data.id
  }).catch(() => undefined);
  const [updatedMessage] = await withImageUrls(supabase, [data]);
  return NextResponse.json({ message: updatedMessage });
}

export async function PATCH(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const messageId = typeof body?.message_id === "string" ? body.message_id : "";
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  if (!messageId || !memberId) {
    return NextResponse.json({ error: "Нужно сообщение и участник" }, { status: 400 });
  }

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });

  const supabase = createSupabaseAdmin();
  const { data: message } = await supabase
    .from("messages")
    .select("id")
    .eq("id", messageId)
    .eq("chat_id", chatId)
    .eq("member_id", memberId)
    .in("type", ["text", "image"])
    .is("deleted_at", null)
    .single();

  if (!message) {
    return NextResponse.json({ error: "Сообщение не найдено" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("messages")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: memberId
    })
    .eq("id", messageId)
    .eq("chat_id", chatId)
    .eq("member_id", memberId)
    .select(MESSAGE_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Не удалось удалить сообщение" }, { status: 500 });
  }

  const [updatedMessage] = await withImageUrls(supabase, [data]);
  return NextResponse.json({ message: updatedMessage });
}

async function withImageUrls(supabase: ReturnType<typeof createSupabaseAdmin>, messages: any[]) {
  return Promise.all(
    messages.map(async (message) => {
      if (message.type !== "image" || message.deleted_at) return message;
      const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(message.text, 60 * 60);
      return { ...message, image_url: data?.signedUrl || null };
    })
  );
}
