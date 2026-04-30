import { createHash } from "node:crypto";

export const MAX_MARKET_SLUG_LENGTH = 96;

export function slugify(
  value: string,
  options?: { maxLength?: number | undefined },
): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const maxLength = options?.maxLength;
  if (
    typeof maxLength !== "number" ||
    !Number.isFinite(maxLength) ||
    maxLength < 1 ||
    normalized.length <= Math.trunc(maxLength)
  ) {
    return normalized;
  }

  return normalized.slice(0, Math.trunc(maxLength)).replace(/-+$/g, "");
}

export function createStableId(prefix: string, input: string): string {
  return `${prefix}_${createHash("sha1").update(input).digest("hex").slice(0, 12)}`;
}

export function hashText(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}
