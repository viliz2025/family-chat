import { hashPassword, verifyPassword } from "@/lib/password";
import { getRequiredEnv } from "@/lib/config";

const PIN_PATTERN = /^\d{4}$/;

export function isValidPin(pin: string) {
  return PIN_PATTERN.test(pin);
}

export function hashMemberPin(pin: string) {
  return hashPassword(pin, getRequiredEnv("FAMILY_CHAT_AUTH_PEPPER"));
}

export function verifyMemberPin(pin: string, storedHash: string | null) {
  if (!storedHash || !isValidPin(pin)) return false;
  return verifyPassword(pin, getRequiredEnv("FAMILY_CHAT_AUTH_PEPPER"), storedHash);
}
