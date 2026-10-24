// FNV-1a over the text's UTF-8 bytes, 64 bits, as 16 hexadecimal digits:
// the hash that keys the precompiled DOMs in every library.
/**
 * @param {string} text
 * @returns {string}
 */
export function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
