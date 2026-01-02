/**
 * Result of validating JavaScript code by running it in a sandboxed iframe.
 * Note: code is executed if it is syntactically valid, but only inside the iframe.
 */
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

/**
 * Ensure the API is called in a browser environment.
 * (Importing this file in SSR is fine; calling validateJavaScriptInSandbox is not.)
 */
function assertIsBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('validateJavaScriptInSandbox can only be used in a browser environment.')
  }
}

/**
 * Get or create the hidden iframe used for sandboxed JS validation.
 */
function getOrCreateJsCheckerIframe(): HTMLIFrameElement {
  assertIsBrowser()

  const existing = document.getElementById(IFRAME_ID)
  if (existing instanceof HTMLIFrameElement) {
    return existing
  }

  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  iframe.style.display = 'none'

  // To be able to access iframe.contentWindow / contentDocument, we must allow same-origin.
  // This means the iframe is not a *perfect* sandbox (it can access the parent origin).
  // It does, however, isolate DOM and global scope for executed code.
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

/**
 * Reset the iframe document to a clean, empty HTML page.
 */
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

/**
 * Create a code snippet with line numbers and a caret pointing to the error column.
 *
 * Example:
 *   >   3 |   const x = ;
 *         |             ^
 */
function makeCodeSnippet(
  code: string,
  errorLine: number,
  errorColumn: number,
  contextLines: number,
): string {
  const lines = code.split('\n')
  const lineIndex = errorLine - 1 // convert 1-based -> 0-based

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

/**
 * Validate JavaScript by loading it as a script in a sandboxed iframe.
 *
 * - If there is a *syntax error*, it is reported with line/column (relative to the provided code).
 * - If there is a *runtime error* during synchronous execution, it is also reported.
 * - If the script loads and runs synchronously without errors, `valid: true` is returned.
 *
 * IMPORTANT:
 * - The code IS EXECUTED if it is syntactically valid, but only inside the hidden iframe.
 * - This function must only be called in a browser environment.
 */
export function validateJavaScriptInSandbox(code: string): Promise<JsValidationResult> {
  return new Promise<JsValidationResult>((resolve) => {
    const iframe = getOrCreateJsCheckerIframe()
    const { win, doc } = resetIframeDocument(iframe)

    // Wrap code in a Blob so line/column numbers relate directly to the user code.
    const blob = new Blob([`${code}\n//# sourceURL=userCode.js`], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)

    let resolved = false

    const cleanup = (): void => {
      URL.revokeObjectURL(url)
      win.onerror = null
    }

    // Global error handler inside the iframe for syntax & runtime errors.
    const errorHandler: OnErrorEventHandlerNonNull = (
      message,
      source,
      lineno,
      colno,
      error,
    ): boolean => {
      // Only handle errors that originate from our blob URL.
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

      // Returning true can prevent the error from bubbling to console in some browsers.
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
