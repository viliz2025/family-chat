export interface Env {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_TOKEN_SECRET: string;
  ALLOWED_ORIGIN: string;
  MAX_IMAGE_SIZE_BYTES?: string;
}

type UploadTokenPayload = {
  action: "upload";
  chatId: string;
  memberId: string;
  exp: number;
};

type ReadTokenPayload = {
  action: "read";
  path: string;
  exp: number;
};

type MediaTokenPayload = UploadTokenPayload | ReadTokenPayload;

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};
const PATH_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[0-9]+-[a-f0-9-]+\.(jpg|jpeg|png|webp)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, 200, env);
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      return handleUpload(request, env);
    }

    if (request.method === "GET" && url.pathname === "/images") {
      return handleImageRead(url, env);
    }

    return json({ error: "not found" }, 404, env);
  }
};

async function handleUpload(request: Request, env: Env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "bad request" }, 400, env);
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  const memberId = stringField(formData?.get("member_id"));
  const chatId = stringField(formData?.get("chat_id"));
  const token = stringField(formData?.get("token"));

  if (!(image instanceof File) || !memberId || !chatId || !token) {
    return json({ error: "bad request" }, 400, env);
  }

  const payload = await verifyToken(token, env.MEDIA_TOKEN_SECRET);
  if (!payload || payload.action !== "upload") {
    return json({ error: "invalid token" }, 401, env);
  }

  if (payload.chatId !== chatId || payload.memberId !== memberId) {
    return json({ error: "token mismatch" }, 403, env);
  }

  const extension = IMAGE_TYPES[image.type];
  if (!extension || image.size <= 0) {
    return json({ error: "unsupported file" }, 400, env);
  }

  const maxImageSize = Number(env.MAX_IMAGE_SIZE_BYTES || DEFAULT_MAX_IMAGE_SIZE_BYTES);
  if (image.size > maxImageSize) {
    return json({ error: "file too large" }, 413, env);
  }

  const path = `${chatId}/${memberId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  try {
    await env.MEDIA_BUCKET.put(path, image.stream(), {
      httpMetadata: { contentType: image.type },
      customMetadata: { chatId, memberId }
    });
  } catch {
    return json({ error: "upload failed" }, 500, env);
  }

  return json(
    {
      path,
      contentType: image.type,
      size: image.size
    },
    200,
    env
  );
}

async function handleImageRead(url: URL, env: Env) {
  const path = url.searchParams.get("path") || "";
  const token = url.searchParams.get("token") || "";

  if (!isSafePath(path)) {
    return json({ error: "bad request" }, 400, env);
  }

  const payload = await verifyToken(token, env.MEDIA_TOKEN_SECRET);
  if (!payload || payload.action !== "read") {
    return json({ error: "invalid token" }, 401, env);
  }

  if (payload.path !== path) {
    return json({ error: "token mismatch" }, 403, env);
  }

  const object = await env.MEDIA_BUCKET.get(path);
  if (!object || !object.body) {
    return json({ error: "not found" }, 404, env);
  }

  return new Response(object.body, {
    headers: {
      ...corsHeaders(env),
      "Content-Type": object.httpMetadata?.contentType || getContentType(path),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function isSafePath(path: string) {
  return !path.includes("..") && PATH_PATTERN.test(path);
}

function getContentType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_CONTENT_TYPES[extension] || "application/octet-stream";
}

function stringField(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" ? value : "";
}

function json(body: unknown, status: number, env: Env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

export async function signPayload(payload: MediaTokenPayload, secret: string) {
  const payloadPart = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signPart(payloadPart, secret);
  return `${payloadPart}.${signature}`;
}

async function verifyToken(token: string, secret: string): Promise<MediaTokenPayload | null> {
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return null;

  const expected = await signPart(payloadPart, secret);
  if (!safeCompare(signature, expected)) return null;

  try {
    const decoded = base64urlDecode(payloadPart);
    const payload = JSON.parse(new TextDecoder().decode(decoded)) as MediaTokenPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signPart(payloadPart: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  return base64urlEncode(new Uint8Array(signature));
}

export function base64urlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function safeCompare(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return diff === 0;
}
