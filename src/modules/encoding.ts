export function uuidToBase64(uuid: string) {
  // Remove dashes from the UUID
  const hex = uuid.replace(/-/g, '')

  // Convert the hex string to a binary string
  const binary = hex
    .match(/.{1,2}/g)!
    .map((byte) => String.fromCharCode(parseInt(byte, 16)))
    .join('')

  // Convert the binary string to a Base64 string
  const base64 = btoa(binary)

  // Replace `+` with `-`, `/` with `_` and remove `=`
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64ToUuid(base64: string) {
  // Add `=` padding if required
  const paddedBase64 = base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(22, '=')

  // Convert the Base64 string back to a binary string
  const binary = atob(paddedBase64)

  // Convert the binary string to a hex string
  const hex = Array.from(binary)
    .map((char) => ('0' + char.charCodeAt(0).toString(16)).slice(-2))
    .join('')

  // Insert dashes back into the UUID format
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uint8ArrayToBase64Url(uint8Array: Uint8Array) {
  let binaryString = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]!)
  }
  const base64 = btoa(binaryString)
  return base64
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove trailing '='
}

export function base64UrlToUint8Array(base64UrlString: string) {
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

export function urlSafe64BitString(bufferUuid: Buffer) {
  let base64Uuid = bufferUuid.toString('base64')

  // make UUID url safe :)
  base64Uuid = base64Uuid
    .replace(/==$/, '') // remove padding
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '.')
  return base64Uuid
}
