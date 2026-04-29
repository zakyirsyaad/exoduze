import { createHash } from "node:crypto";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function createStableId(prefix: string, input: string): string {
  return `${prefix}_${createHash("sha1").update(input).digest("hex").slice(0, 12)}`;
}

export function hashText(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}
