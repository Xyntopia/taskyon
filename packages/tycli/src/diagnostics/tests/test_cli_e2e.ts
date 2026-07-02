import { runTycSession } from '../../tests/cliE2eDiagnostics'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const forbiddenStartupRegressions = [
  'does not provide an export named',
  'getExecutionTaskChain is not implemented',
  'getExecutionTaskChain is not available for this external tool client',
  '[function|functioncall]\n  name: entryNode',
]

export const testCliHelloWorldProducesAssistantResponse = async () => {
  const result = await runTycSession({
    testName: 'testCliHelloWorldProducesAssistantResponse',
    steps: [
      { waitFor: 'tycli ready.', input: 'hello world\n' },
      {
        waitFor: '[assistant|message]',
        failOn: [
          '[system|error]',
          'Cannot connect to API',
          'No key configured',
          'does not provide an export named',
          'getExecutionTaskChain is not implemented',
          'getExecutionTaskChain is not available for this external tool client',
        ],
        input: '/exit\n',
      },
    ],
    env: { TYCLI_HOTKEY_MENUS: '0' },
    timeoutMs: 90_000,
    runner: 'pty',
    isolateHome: false,
  })

  assert(result.code === 0, `Expected exit code 0, got ${String(result.code)}\n${result.output}`)
  assert(
    result.output.includes('[assistant|message]'),
    `Expected assistant response in CLI output.\n${result.output}`,
  )
  for (const forbidden of forbiddenStartupRegressions) {
    assert(
      !result.output.includes(forbidden),
      `Unexpected CLI regression output "${forbidden}".\n${result.output}`,
    )
  }

  return { success: true }
}

testCliHelloWorldProducesAssistantResponse.description =
  'Starts yarn tycli, sends hello world through the configured provider, and expects an assistant response.'
testCliHelloWorldProducesAssistantResponse.timeoutMs = 110_000
