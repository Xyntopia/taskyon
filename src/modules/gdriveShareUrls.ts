// Resolve a publicly shared Google Drive blob to an anonymous HTTPS download URL.
// Google can still return an HTML confirmation page or deny a request; callers must reject HTML.
export function getFileId(originalLink: string) {
  const url = new URL(originalLink)
  if (url.hostname !== 'drive.google.com' || url.protocol !== 'https:') {
    throw new Error('Expected a Google Drive HTTPS share URL')
  }
  const fileId =
    url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ??
    (['/uc', '/open'].includes(url.pathname) ? url.searchParams.get('id') : undefined)
  if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error('Unsupported Google Drive file link')
  }
  return fileId
}

export function gdriveDirectDownloadLink(link: string) {
  const source = new URL(link)
  const target = new URL('https://drive.google.com/uc')
  target.searchParams.set('export', 'download')
  target.searchParams.set('id', getFileId(link))
  const resourceKey = source.searchParams.get('resourcekey')
  if (resourceKey) target.searchParams.set('resourcekey', resourceKey)
  return target.toString()
}

export function publicChatDownloadUrl(link: string) {
  const source = new URL(link)
  return source.hostname === 'drive.google.com' ? gdriveDirectDownloadLink(link) : link
}
