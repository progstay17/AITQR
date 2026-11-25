/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Bundle signatures cover the canonical form of `bundle`, so the admin CLI (Node) and the
 * app (browser) must produce identical bytes. Numbers follow ECMAScript `Number::toString`,
 * strings are escaped exactly as `JSON.stringify` does, and object keys are sorted by UTF-16
 * code units — which is the default `Array.prototype.sort` order.
 */

export class CanonicalError extends Error {}

function encodeString(value: string): string {
  return JSON.stringify(value);
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new CanonicalError("JSON cannot carry NaN or Infinity");
  if (Object.is(value, -0)) return "0";
  return JSON.stringify(value);
}

export function canonicalize(value: unknown): string {
  return write(value, 0);
}

function write(value: unknown, depth: number): string {
  if (depth > 64) throw new CanonicalError("value is nested too deeply");
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return encodeNumber(value);
    case "string":
      return encodeString(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((item) => write(item, depth + 1)).join(",") + "]";
      }
      const record = value as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(record);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalError("canonical JSON only supports plain objects");
      }
      const keys = Object.keys(record);
      keys.sort();
      return (
        "{" +
        keys
          .map((key) => encodeString(key) + ":" + write(record[key], depth + 1))
          .join(",") +
        "}"
      );
    }
    default:
      throw new CanonicalError(`value of type ${typeof value} is not JSON`);
  }
}

/** Bytes of the canonical form: what actually gets signed. */
export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalize(value));
}
