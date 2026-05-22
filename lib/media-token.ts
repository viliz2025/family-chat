import { createHmac, timingSafeEqual } from "crypto";

export type MediaTokenPayload =
  | {
      action: "upload";
      chatId: string;
      memberId: string;
      exp: number;
    }
  | {
      action: "read";
      path: string;
      exp: number;
    };

function base64urlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPart(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

export function signMediaPayload(payload: MediaTokenPayload, secret: string) {
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  return `${payloadPart}.${signPart(payloadPart, secret)}`;
}

export function verifyMediaToken(token: string, secret: string): MediaTokenPayload | null {
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return null;

  const expected = signPart(payloadPart, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(payloadPart)) as MediaTokenPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
