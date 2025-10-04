export function joinUrl(base: string, route: string): string {
  // ensure base has trailing slash for correct relative resolution
  if (!base.endsWith('/')) base += '/'
  return new URL(route, base).toString()
}
