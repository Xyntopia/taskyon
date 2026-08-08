import { spawn } from 'node:child_process'
import type { InternalTool } from '@taskyon/taskyon'
import { createClientTool } from '@taskyon/taskyon'

const PYTHON_RUNNER = `
import ast
import contextlib
import io
import json
import sys

payload = json.load(sys.stdin)
tree = ast.parse(payload["code"], mode="exec")
namespace = {}
stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
        exec(compile(prefix, "<taskyon-python>", "exec"), namespace)
        result = eval(compile(ast.Expression(tree.body[-1].value), "<taskyon-python>", "eval"), namespace)
    else:
        exec(compile(tree, "<taskyon-python>", "exec"), namespace)
        result = None
json.dump({"stdout": stdout.getvalue(), "result": result}, sys.stdout, default=repr)
`

const canRunPython = (executable: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(executable, ['--version'], {
      stdio: 'ignore',
      signal: AbortSignal.timeout(2_000),
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })

const normalizeError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

export async function findNativePythonExecutable(): Promise<string | null> {
  const candidates = [process.env.TASKYON_PYTHON_PATH, 'python3', 'python'].filter(
    (candidate): candidate is string => Boolean(candidate),
  )
  for (const executable of candidates) {
    if (await canRunPython(executable)) return executable
  }
  return null
}

const executePython = (
  executable: string,
  code: string,
  signal: AbortSignal,
): Promise<{ stdout: string; result: unknown }> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, ['-I', '-c', PYTHON_RUNNER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: string) => {
      const next = current + chunk
      if (Buffer.byteLength(next) > 2 * 1024 * 1024) {
        child.kill('SIGKILL')
        throw new Error('Native Python output exceeds the configured limit')
      }
      return next
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      try {
        stdout = append(stdout, chunk)
      } catch (error) {
        reject(normalizeError(error))
      }
    })
    child.stderr.on('data', (chunk: string) => {
      try {
        stderr = append(stderr, chunk)
      } catch (error) {
        reject(normalizeError(error))
      }
    })
    child.once('error', reject)
    child.once('exit', (codeValue, exitSignal) => {
      if (codeValue !== 0) {
        reject(
          new Error(
            `Native Python exited (code=${String(codeValue)}, signal=${String(exitSignal)}): ${stderr.trim()}`,
          ),
        )
        return
      }
      try {
        resolve(JSON.parse(stdout) as { stdout: string; result: unknown })
      } catch (error) {
        reject(new Error('Native Python returned an invalid result', { cause: error }))
      }
    })
    child.stdin.end(JSON.stringify({ code }))
  })

export function createNativePythonTool(options: {
  executable: string
  authorize: () => Promise<boolean>
}): InternalTool {
  let approvedForSession = false
  return createClientTool({
    name: 'executePythonScript',
    description: 'Executes Python with an approved native CLI interpreter.',
    longDescription:
      'Runs Python with host filesystem and network authority. The CLI asks for approval before the first execution in each session.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The Python script code to execute.' },
      },
      required: ['code'],
      additionalProperties: false,
    } as const,
    function: async ({ code }, context) => {
      if (!approvedForSession) approvedForSession = await options.authorize()
      if (!approvedForSession) throw new Error('Native Python execution was not authorized')
      return await executePython(options.executable, code, context.stopSignal)
    },
  })
}
