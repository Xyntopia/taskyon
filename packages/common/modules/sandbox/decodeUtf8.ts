/** Stateless UTF-8 decoder for realms without TextDecoder; never imports a host constructor. */
export function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; ) {
    const first = bytes[offset++]!
    if (first < 128) {
      parts.push(String.fromCharCode(first))
      continue
    }
    const length =
      first >= 194 && first <= 223
        ? 2
        : first >= 224 && first <= 239
          ? 3
          : first >= 240 && first <= 244
            ? 4
            : 0
    if (!length) {
      parts.push('\uFFFD')
      continue
    }
    let code = first & (127 >> length)
    let valid = true
    for (let index = 1; index < length; index++) {
      const next = bytes[offset]
      const minimum = index === 1 && first === 224 ? 160 : index === 1 && first === 240 ? 144 : 128
      const maximum = index === 1 && first === 237 ? 159 : index === 1 && first === 244 ? 143 : 191
      if (next === undefined || next < minimum || next > maximum) {
        valid = false
        break
      }
      code = (code << 6) | (next & 63)
      offset++
    }
    parts.push(valid ? String.fromCodePoint(code) : '\uFFFD')
  }
  // TextDecoder's default behavior consumes a leading UTF-8 BOM.
  return parts.join('').replace(/^\uFEFF/, '')
}
