import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
const pepper = process.env.FAMILY_CHAT_AUTH_PEPPER;

if (!password) {
  console.error('Usage: FAMILY_CHAT_AUTH_PEPPER=your-pepper npm run hash-password -- "<family-password>"');
  process.exit(1);
}

if (!pepper) {
  console.error("FAMILY_CHAT_AUTH_PEPPER is required.");
  process.exit(1);
}

const iterations = 310000;
const salt = randomBytes(16).toString("base64url");
const hash = pbkdf2Sync(`${password}${pepper}`, salt, iterations, 32, "sha256").toString("base64url");

console.log(`pbkdf2_sha256$${iterations}$${salt}$${hash}`);
