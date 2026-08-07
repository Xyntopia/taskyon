import { createExternalToolContext } from '@taskyon/taskyon'
import { createNativePythonTool, findNativePythonExecutable } from '../../cli/nativePythonTool'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function nativePythonToolRequiresApprovalAndExecutesDetectedInterpreter() {
  const executable = await findNativePythonExecutable()
  if (!executable) return
  let approvals = 0
  const tool = createNativePythonTool({
    executable,
    authorize: () => {
      approvals += 1
      return Promise.resolve(true)
    },
  })
  assert(tool.function, 'Native Python tool must provide a host implementation')
  const context = createExternalToolContext(new AbortController().signal)
  const first = (await tool.function({ code: "print('hello')\n6 * 7" }, context)) as {
    stdout: string
    result: unknown
  }
  const second = (await tool.function({ code: '21 * 2' }, context)) as {
    result: unknown
  }

  assert(first.stdout === 'hello\n', 'Native Python must return captured stdout')
  assert(first.result === 42 && second.result === 42, 'Native Python returned the wrong result')
  assert(approvals === 1, 'Native Python approval must be reused only for the current CLI session')
}

nativePythonToolRequiresApprovalAndExecutesDetectedInterpreter.description =
  'The CLI exposes detected native Python only through an explicitly approved host tool.'
