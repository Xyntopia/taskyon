import { executeInWorkerSandbox } from './workerSandbox'

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

let jsValidationRunCounter = 0

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

function buildSandboxValidationCode(): string {
  return `
(code) => {
  const extractLineColumn = (rawError) => {
    const text = typeof rawError === 'string' ? rawError : '';
    const matchers = [
      /userCode\\.js:(\\d+):(\\d+)/,
      /<anonymous>:(\\d+):(\\d+)/,
    ];
    for (const matcher of matchers) {
      const match = text.match(matcher);
      if (match) {
        return {
          line: Number(match[1]),
          column: Number(match[2]),
        };
      }
    }
    return {};
  };

  try {
    const fn = new Function(String(code || '') + '\\n//# sourceURL=userCode.js');
    fn();
    return {
      valid: true,
      phase: null,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const rawError = typeof err.stack === 'string' && err.stack ? err.stack : err.message;
    const position = extractLineColumn(rawError);
    return {
      valid: false,
      phase: err.name === 'SyntaxError' ? 'syntax' : 'runtime',
      errorName: err.name || 'Error',
      message: err.message || 'Unknown error',
      line: Number.isFinite(position.line) ? position.line : undefined,
      column: Number.isFinite(position.column) ? position.column : undefined,
      rawError,
    };
  }
}
`.trim()
}

function normalizeValidationResult(code: string, raw: unknown): JsValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      phase: 'runtime',
      errorName: 'ValidationError',
      message: 'Sandbox validation returned an invalid payload.',
    }
  }

  const result = raw as Record<string, unknown>
  const line = typeof result.line === 'number' && result.line > 0 ? result.line : undefined
  const column = typeof result.column === 'number' && result.column > 0 ? result.column : undefined

  return {
    valid: result.valid === true,
    phase: result.phase === 'syntax' || result.phase === 'runtime' ? result.phase : null,
    errorName: typeof result.errorName === 'string' ? result.errorName : undefined,
    message: typeof result.message === 'string' ? result.message : undefined,
    line,
    column,
    snippet:
      line !== undefined && column !== undefined
        ? makeCodeSnippet(code, line, column, 10)
        : undefined,
    rawError: typeof result.rawError === 'string' ? result.rawError : undefined,
  }
}

export async function validateJavaScriptInSandbox(code: string): Promise<JsValidationResult> {
  const abort = new AbortController()
  const runId = `js-sandbox-validate-${Date.now()}-${jsValidationRunCounter}`
  jsValidationRunCounter += 1

  try {
    const raw = await executeInWorkerSandbox(
      {
        id: runId,
        code: buildSandboxValidationCode(),
        sourceURL: `${runId}.js`,
        stopSignal: abort.signal,
      },
      code,
    )
    return normalizeValidationResult(code, raw)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return {
      valid: false,
      phase: 'runtime',
      errorName: err.name || 'Error',
      message: err.message || 'Sandbox validation failed.',
      rawError: typeof err.stack === 'string' ? err.stack : err.message,
    }
  } finally {
    abort.abort()
  }
}
