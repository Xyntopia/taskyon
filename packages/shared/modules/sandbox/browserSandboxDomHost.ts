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

function hasUnsafeSandboxCombination(tokens: string[]): boolean {
  const values = new Set(tokens)
  return values.has('allow-scripts') && values.has('allow-same-origin')
}

export function createBrowserSandboxFrame(args: {
  id: string
  sandboxTokens: string[]
}): HTMLIFrameElement {
  assertBrowserSandboxDom()
  if (hasUnsafeSandboxCombination(args.sandboxTokens)) {
    throw new Error(
      'Unsafe iframe sandbox configuration: do not combine allow-scripts with allow-same-origin.',
    )
  }
  const iframe = document.createElement('iframe')
  iframe.id = args.id
  iframe.style.display = 'none'
  for (const token of args.sandboxTokens) {
    iframe.sandbox.add(token)
  }
  document.body.appendChild(iframe)
  return iframe
}
