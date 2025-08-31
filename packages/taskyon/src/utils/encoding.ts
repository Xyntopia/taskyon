export function uint8ArrayToBase64UrlSafe(buffer: ArrayBufferLike) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return base64
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove trailing '='
}

export function base64UrlToUint8Array(base64UrlString: unknown) {
  if (typeof base64UrlString !== 'string') {
    throw new TypeError('Expected base64UrlString to be a string')
  }
  // Add padding '=' if necessary
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4)
  const base64 =
    base64UrlString
      .replace(/-/g, '+') // Convert '-' to '+'
      .replace(/_/g, '/') + // Convert '_' to '/'
    padding

  const binaryString = atob(base64)
  const len = binaryString.length
  const uint8Array = new Uint8Array(len)

  for (let i = 0; i < len; i++) {
    uint8Array[i] = binaryString.charCodeAt(i)
  }

  return uint8Array
}
