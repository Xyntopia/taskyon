export function uint8ArrayToBase64UrlSafe(data: Uint8Array | ArrayBuffer) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]!)
  }
  return btoa(binary)
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove trailing '='
}

export function base64UrlToUint8Array(base64UrlString: unknown): Uint8Array<ArrayBuffer> {
  if (typeof base64UrlString !== 'string') {
    throw new TypeError('Expected base64UrlString to be a string')
  }
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4)
  const base64 = base64UrlString.replace(/-/g, '+').replace(/_/g, '/') + padding

  const binaryString = atob(base64)
  const len = binaryString.length
  const arr = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    arr[i] = binaryString.charCodeAt(i)
  }
  // re-wrap ensures it's `ArrayBuffer`, not `ArrayBufferLike`
  return new Uint8Array(arr)
}

export async function sha256UrlSafeHash(obj: unknown) {
  const json = JSON.stringify(obj)
  const encoder = new TextEncoder()
  const data = encoder.encode(json)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return uint8ArrayToBase64UrlSafe(hashBuffer)
}
