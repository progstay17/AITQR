// Strict Base45 (RFC 9285). The alphabet equals the QR "alphanumeric" mode set.
import { FormatError } from "./errors.js";

export const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const DECODE = new Map([...ALPHABET].map((c, i) => [c, i]));

/** @param {Uint8Array} data @returns {string} */
export function encode(data) {
  let out = "";
  for (let i = 0; i < data.length; i += 2) {
    if (i + 1 < data.length) {
      const n = data[i] * 256 + data[i + 1];
      out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45) % 45] + ALPHABET[Math.floor(n / 2025)];
    } else {
      out += ALPHABET[data[i] % 45] + ALPHABET[Math.floor(data[i] / 45)];
    }
  }
  return out;
}

/** @param {string} text @returns {Uint8Array} */
export function decode(text) {
  if (text.length % 3 === 1) throw new FormatError("invalid base45 length");
  const vals = [];
  for (const ch of text) {
    const v = DECODE.get(ch);
    if (v === undefined) throw new FormatError(`invalid base45 character ${JSON.stringify(ch)}`);
    vals.push(v);
  }
  const out = [];
  for (let i = 0; i < vals.length; i += 3) {
    if (i + 2 < vals.length) {
      const n = vals[i] + vals[i + 1] * 45 + vals[i + 2] * 2025;
      if (n > 0xffff) throw new FormatError("invalid base45 value");
      out.push(n >> 8, n & 0xff);
    } else {
      const n = vals[i] + vals[i + 1] * 45;
      if (n > 0xff) throw new FormatError("invalid base45 value");
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}
