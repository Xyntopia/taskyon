export function joinUrl(base: string, route: string): string {
  if (/^https?:\/\//i.test(route)) return route
  // Provider routes are relative to the configured base path, including leading-slash routes.
  const left = base.replace(/\/+$/, '')
  const right = route.replace(/^\/+/, '')
  return `${left}/${right}`
}

export async function urlToFile(url: string, filename?: string): Promise<File> {
  const res = await fetch(url)

  // auto-detect MIME type from response headers
  const mimeType = res.headers.get('Content-Type') ?? 'application/octet-stream'

  const blob = await res.blob()
  return new File([blob], filename ?? url.split('/').pop() ?? 'file', { type: mimeType })
}
