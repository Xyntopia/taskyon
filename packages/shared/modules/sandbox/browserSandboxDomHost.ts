export function assertBrowserSandboxDom(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser sandbox helpers require a browser environment.')
  }
}

export function findBrowserSandboxFrame(id: string): HTMLIFrameElement | null {
  assertBrowserSandboxDom()
  const existing = document.getElementById(id)
  return existing instanceof HTMLIFrameElement ? existing : null
}

export function createBrowserSandboxFrame(args: {
  id: string
  sandboxTokens: string[]
}): HTMLIFrameElement {
  assertBrowserSandboxDom()
  const iframe = document.createElement('iframe')
  iframe.id = args.id
  iframe.style.display = 'none'
  for (const token of args.sandboxTokens) {
    iframe.sandbox.add(token)
  }
  document.body.appendChild(iframe)
  return iframe
}

export function writeBrowserSandboxDocument(iframe: HTMLIFrameElement, html: string): Document {
  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('Failed to access iframe document.')
  }
  doc.open()
  doc.write(html)
  doc.close()
  return doc
}
