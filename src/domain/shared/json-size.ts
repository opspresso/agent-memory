const textEncoder = new TextEncoder();

export function serializedJsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? 0
    : textEncoder.encode(serialized).byteLength;
}
