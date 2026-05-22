import { NextResponse } from "next/server";
import { chatSlug } from "@/lib/config";
import { signMediaPayload } from "@/lib/media-token";
import { hasValidSession } from "@/lib/session";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

const PHOTO_BUCKET = "family-chat-photos";
const TOKEN_TTL_SECONDS = 5 * 60;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

async function getChatId() {
  const supabase = createSupabaseAdmin();
  const { data: chat, error } = await supabase.from("chats").select("id").eq("slug", chatSlug).single();
  if (error || !chat) return null;
  return chat.id as string;
}

function getContentType(path: string, fileType?: string) {
  if (fileType) return fileType;
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_CONTENT_TYPES[extension] || "application/octet-stream";
}

export async function GET(request: Request) {
  if (!hasValidSession()) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const path = new URL(request.url).searchParams.get("path") || "";
  if (!path) return NextResponse.json({ error: "Нужен path" }, { status: 400 });

  const chatId = await getChatId();
  if (!chatId) return NextResponse.json({ error: "Чат не настроен" }, { status: 500 });
  if (!path.startsWith(`${chatId}/`)) {
    return NextResponse.json({ error: "Фото недоступно" }, { status: 403 });
  }

  const supabase = createSupabaseAdmin();
  const { data: message } = await supabase
    .from("messages")
    .select("id")
    .eq("chat_id", chatId)
    .eq("type", "image")
    .eq("text", path)
    .is("deleted_at", null)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  }

  const mediaProxyBaseUrl = process.env.MEDIA_PROXY_BASE_URL?.replace(/\/+$/, "");
  if (mediaProxyBaseUrl) {
    const secret = process.env.MEDIA_TOKEN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Media token secret is not configured" }, { status: 500 });
    }

    const token = signMediaPayload(
      {
        action: "read",
        path,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
      },
      secret
    );
    const redirectUrl = `${mediaProxyBaseUrl}/images?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
    return NextResponse.redirect(redirectUrl, 302);
  }

  const { data: file, error } = await supabase.storage.from(PHOTO_BUCKET).download(path);
  if (error || !file) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  }

  return new NextResponse(file, {
    headers: {
      "Content-Type": getContentType(path, file.type),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
