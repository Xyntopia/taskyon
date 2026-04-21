const uint8ArrayToBase64UrlSafe = (data: Uint8Array | ArrayBuffer) => {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < u8.length; i += 1) {
    binary += String.fromCharCode(u8[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function cryptoKeyToUint8(publicKey: CryptoKey) {
  const exported = await crypto.subtle.exportKey('raw', publicKey)
  return new Uint8Array(exported)
}

export async function cryptoKeyToBase64(publicKey: CryptoKey): Promise<string> {
  const bytes = await cryptoKeyToUint8(publicKey)
  return uint8ArrayToBase64UrlSafe(bytes.buffer)
}
