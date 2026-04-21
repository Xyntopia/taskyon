export interface JsValidationResult {
  valid: boolean
  phase: 'syntax' | 'runtime' | null
  errorName?: string | undefined
  message?: string | undefined
  line?: number | undefined
  column?: number | undefined
  snippet?: string | undefined
  rawError?: string | undefined
}

const IFRAME_ID = '__taskyonJsCheckerIframe'

function assertIsBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('validateJavaScriptInSandbox can only be used in a browser environment.')
  }
}

function getOrCreateJsCheckerIframe(): HTMLIFrameElement {
  assertIsBrowser()

  const existing = document.getElementById(IFRAME_ID)
  if (existing instanceof HTMLIFrameElement) {
    return existing
  }

  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  iframe.style.display = 'none'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')

  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('Failed to access iframe document.')
  }

  doc.open()
  doc.write('<!doctype html><html><head></head><body></body></html>')
  doc.close()

  return iframe
}

function resetIframeDocument(iframe: HTMLIFrameElement): { win: Window; doc: Document } {
  const win = iframe.contentWindow
  if (!win) {
    throw new Error('Failed to access iframe contentWindow.')
  }

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('Failed to access iframe contentDocument.')
  }

  doc.open()
  doc.write('<!doctype html><html><head></head><body></body></html>')
  doc.close()

  return { win, doc }
}

function makeCodeSnippet(
  code: string,
  errorLine: number,
  errorColumn: number,
  contextLines: number,
): string {
  const lines = code.split('\n')
  const lineIndex = errorLine - 1

  const start = Math.max(0, lineIndex - contextLines)
  const end = Math.min(lines.length, lineIndex + contextLines + 1)

  const result: string[] = []

  for (let i = start; i < end; i += 1) {
    const isErrorLine = i === lineIndex
    const prefix = isErrorLine ? '>' : ' '
    const number = String(i + 1).padStart(3, ' ')
    const line = lines[i] ?? ''
    result.push(`${prefix} ${number} | ${line}`)
    if (isErrorLine) {
      const caretPadding = ' '.repeat(Math.max(0, errorColumn - 1))
      result.push(`    | ${caretPadding}^`)
    }
  }

  return result.join('\n')
}

export function validateJavaScriptInSandbox(code: string): Promise<JsValidationResult> {
  return new Promise<JsValidationResult>((resolve) => {
    const iframe = getOrCreateJsCheckerIframe()
    const { win, doc } = resetIframeDocument(iframe)

    const blob = new Blob([`${code}\n//# sourceURL=userCode.js`], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)

    let resolved = false

    const cleanup = (): void => {
      URL.revokeObjectURL(url)
      win.onerror = null
    }

    const errorHandler: OnErrorEventHandlerNonNull = (
      message,
      source,
      lineno,
      colno,
      error,
    ): boolean => {
      if (typeof source === 'string' && source !== url) {
        return false
      }

      if (resolved) {
        return false
      }
      resolved = true
      cleanup()

      const errorObject = error instanceof Error ? error : undefined
      const messageText =
        typeof message === 'string' ? message : (errorObject?.message ?? 'Unknown error')

      const errorName =
        errorObject?.name ?? (typeof message === 'string' ? message.split(':')[0] : 'Error')

      const phase: 'syntax' | 'runtime' = errorName === 'SyntaxError' ? 'syntax' : 'runtime'

      const line = typeof lineno === 'number' && lineno > 0 ? lineno : undefined
      const column = typeof colno === 'number' && colno > 0 ? colno : undefined

      const snippet =
        line !== undefined && column !== undefined
          ? makeCodeSnippet(code, line, column, 2)
          : undefined

      const rawError = errorObject?.stack ?? messageText

      resolve({
        valid: false,
        phase,
        errorName,
        message: messageText,
        line,
        column,
        snippet,
        rawError,
      })

      return true
    }

    win.onerror = errorHandler

    const script = doc.createElement('script')
    script.src = url

    script.onload = () => {
      if (resolved) {
        return
      }
      resolved = true
      cleanup()

      resolve({
        valid: true,
        phase: null,
      })
    }

    script.onerror = (event: string | Event) => {
      if (resolved) {
        return
      }
      resolved = true
      cleanup()

      resolve({
        valid: false,
        phase: 'syntax',
        errorName: 'ScriptLoadError',
        message: 'Failed to load script for syntax check.',
        rawError: typeof event === 'string' ? event : JSON.stringify(event),
      })
    }

    doc.body.appendChild(script)
  })
}
