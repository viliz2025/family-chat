import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const ITERATIONS = 310000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string, pepper: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(`${password}${pepper}`, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, pepper: string, storedHash: string) {
  const [scheme, iterationsRaw, salt, expectedRaw] = storedHash.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expectedRaw) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;

  const expected = Buffer.from(expectedRaw, "base64url");
  const actual = pbkdf2Sync(`${password}${pepper}`, salt, iterations, expected.length, DIGEST);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
