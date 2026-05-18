export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_NAME_LENGTH = 60;

export function cleanMessage(text: unknown) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function cleanName(name: unknown) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}
