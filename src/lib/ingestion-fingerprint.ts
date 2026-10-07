import { createHash } from "node:crypto";

/** JSONB changes key order; fingerprints depend on field values, not object insertion order. */
function canonical(value: unknown): unknown {
  type JsonContainer = unknown[] | Record<string, unknown>;
  const copies = new WeakMap<object, JsonContainer>();
  const pending: { source: object; target: JsonContainer }[] = [];
  function copy(item: unknown): unknown {
    if (!item || typeof item !== "object") return item;
    const existing = copies.get(item);
    if (existing) return existing;
    const target: JsonContainer = Array.isArray(item) ? [] : {};
    copies.set(item, target);
    pending.push({ source: item, target });
    return target;
  }
  const root = copy(value);
  while (pending.length) {
    const { source, target } = pending.pop()!;
    if (Array.isArray(source) && Array.isArray(target)) {
      for (const item of source) target.push(copy(item));
    } else {
      const entries = Object.entries(source).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      for (const [key, item] of entries) {
        // Define data properties so special JSON keys cannot change the copy's prototype.
        Object.defineProperty(target, key, { value: copy(item), enumerable: true, configurable: true, writable: true });
      }
    }
  }
  return root;
}

export function ingestionFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
