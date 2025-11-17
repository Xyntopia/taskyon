export function joinUrl(base: string, route: string): string {
  // ensure base has trailing slash for correct relative resolution
  if (!base.endsWith('/')) base += '/'
  return new URL(route, base).toString()
}

export async function urlToFile(url: string, filename?: string): Promise<File> {
  const res = await fetch(url)

  // auto-detect MIME type from response headers
  const mimeType = res.headers.get('Content-Type') ?? 'application/octet-stream'

  const blob = await res.blob()
  return new File([blob], filename ?? url.split('/').pop() ?? 'file', { type: mimeType })
}
