// FNV-1a over the text's UTF-8 bytes, 64 bits, as 16 hexadecimal digits:
// the hash that keys the preparsed DOMs in every library.
/**
 * @param {string} text
 * @returns {string}
 */
export function fnv1a64(text) {
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (const byte of new TextEncoder().encode(text)) {
    low = (low ^ byte) >>> 0;
    // The prime is 2^40 + 435. The low product fits exactly in a Number.
    // Its carry and the shifted low word supply the high product modulo 2^32.
    const product = low * 435;
    high = (Math.imul(high, 435) + (low << 8) + Math.floor(product / 0x100000000)) >>> 0;
    low = product >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
