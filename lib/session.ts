import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { chatSlug, getRequiredEnv } from "@/lib/config";

const COOKIE_NAME = "family_chat_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sign(value: string) {
  return createHmac("sha256", getRequiredEnv("FAMILY_CHAT_SESSION_SECRET")).update(value).digest("base64url");
}

export function createSessionValue() {
  const payload = JSON.stringify({
    slug: chatSlug,
    iat: Date.now()
  });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function setSessionCookie() {
  cookies().set(COOKIE_NAME, createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export function hasValidSession() {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return false;

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return false;

  const expected = sign(encoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.slug === chatSlug;
  } catch {
    return false;
  }
}
