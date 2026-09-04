const textEncoder = new TextEncoder();

export function serializedJsonByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : textEncoder.encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
