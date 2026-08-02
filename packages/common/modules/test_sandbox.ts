import {
  createExecutableSandboxClient,
  type SandboxTransport,
} from './sandbox/executableSandbox.ts'
import { createExecutableSandbox } from './sandbox/workerSandbox.ts'
import { connectFrpSandboxService } from './sandbox/frpSandbox.ts'
import { defineFrpProtocol } from './frpBus.ts'
import { createEnvironmentWorker } from './environmentWorker.ts'
import { z } from 'zod'
import type {
  SandboxHostToRuntimeMessage,
  SandboxRuntimeToHostMessage,
} from './sandbox/workerSandboxTypes.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

type TestSandboxTransport = SandboxTransport & {
  receive(message: SandboxRuntimeToHostMessage): void
  sent: SandboxHostToRuntimeMessage[]
  terminationCount: number
}

function createTestTransport(): TestSandboxTransport {
  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()
  const sent: SandboxHostToRuntimeMessage[] = []
  const transport: TestSandboxTransport = {
    sent,
    terminationCount: 0,
    send: (message) => sent.push(message),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    receive: (message) => listeners.forEach((listener) => listener(message)),
    terminate: () => {
      transport.terminationCount += 1
    },
  }
  return transport
}

export const testExecutableSandboxCorrelatesConcurrentResults = async () => {
  const transport = createTestTransport()
  const sandbox = createExecutableSandboxClient(transport)
  const first = sandbox.execute<number>('(value) => value', [1])
  const second = sandbox.execute<number>('(value) => value', [2])
  const [firstRequest, secondRequest] = transport.sent
  if (firstRequest?.kind !== 'execute' || secondRequest?.kind !== 'execute') {
    throw new Error('Expected two execution requests.')
  }

  transport.receive({ kind: 'result', requestId: secondRequest.requestId, result: 2 })
  transport.receive({ kind: 'result', requestId: firstRequest.requestId, result: 1 })

  assert((await first) === 1, 'Expected the first result to retain its request identity.')
  assert((await second) === 2, 'Expected the second result to retain its request identity.')
  sandbox.terminate()
  return { success: true }
}

export const testExecutableSandboxSurfacesRuntimeErrors = async () => {
  const transport = createTestTransport()
  const sandbox = createExecutableSandboxClient(transport)
  const result = sandbox.execute('() => missingValue', [])
  const request = transport.sent[0]
  if (request?.kind !== 'execute') throw new Error('Expected one execution request.')
  transport.receive({
    kind: 'error',
    requestId: request.requestId,
    error: { name: 'ReferenceError', message: 'missingValue is not defined' },
  })

  let caught: unknown
  try {
    await result
  } catch (error) {
    caught = error
  }
  assert(caught instanceof Error, 'Expected an Error from the sandbox.')
  assert((caught as Error).name === 'ReferenceError', 'Expected the original error name.')
  sandbox.terminate()
  return { success: true }
}

testExecutableSandboxCorrelatesConcurrentResults.description =
  'Correlates concurrent sandbox calls even when their results arrive out of order.'
testExecutableSandboxSurfacesRuntimeErrors.description =
  'Preserves errors returned across the executable-sandbox boundary.'

export const testExecutableSandboxTerminatesAfterExecutionTimeout = async () => {
  const transport = createTestTransport()
  const sandbox = createExecutableSandboxClient(transport)
  let caught: unknown
  try {
    await sandbox.execute('async () => new Promise(() => undefined)', [], {
      maxExecutionMs: 10,
    })
  } catch (error) {
    caught = error
  }

  assert(
    caught instanceof Error && caught.message.includes('timed out'),
    'Expected a sandbox timeout error.',
  )
  assert(transport.terminationCount === 1, 'Expected timeout to invalidate the sandbox runtime.')
  return { success: true }
}

testExecutableSandboxTerminatesAfterExecutionTimeout.description =
  'Terminates a retained sandbox after an execution timeout makes its state untrustworthy.'

export const testExecutableSandboxRejectsOversizedOutput = async () => {
  const transport = createTestTransport()
  const sandbox = createExecutableSandboxClient(transport)
  const result = sandbox.execute('() => "oversized"', [], { maxOutputBytes: 4 })
  const request = transport.sent[0]
  if (request?.kind !== 'execute') throw new Error('Expected one execution request.')
  transport.receive({ kind: 'result', requestId: request.requestId, result: 'oversized' })

  let caught: unknown
  try {
    await result
  } catch (error) {
    caught = error
  }
  assert(
    caught instanceof Error && caught.message.includes('output'),
    'Expected an oversized-output error.',
  )
  assert(
    transport.terminationCount === 1,
    'Expected oversized output to invalidate the sandbox runtime.',
  )
  return { success: true }
}

testExecutableSandboxRejectsOversizedOutput.description =
  'Rejects oversized results and terminates the sandbox that produced them.'

export const testInstalledSandboxModuleSharesOnlyItsOwnState = async () => {
  const suffix = `${Date.now()}-${Math.random()}`
  const first = await createExecutableSandbox({
    id: `counter-a-${suffix}`,
    reuse: { mode: 'disposable' },
  })
  const second = await createExecutableSandbox({
    id: `counter-b-${suffix}`,
    reuse: { mode: 'disposable' },
  })
  const source = '(() => { let value = 0; return () => ++value })()'
  try {
    await Promise.all([
      first.installModule('counter', source),
      second.installModule('counter', source),
    ])
    assert((await first.executeModule('counter', [])) === 1, 'Expected first module state.')
    assert((await first.executeModule('counter', [])) === 2, 'Expected retained module state.')
    assert((await second.executeModule('counter', [])) === 1, 'Expected isolated sandbox state.')
    assert((await first.execFunc((value: number) => value * 2, [21])) === 42, 'Expected execFunc.')
    let immutableError: unknown
    try {
      await first.installModule('counter', '() => 99')
    } catch (error) {
      immutableError = error
    }
    assert(
      immutableError instanceof Error && immutableError.message.includes('immutable'),
      'Expected an installed module identity to reject different source.',
    )
    return { success: true }
  } finally {
    first.terminate()
    second.terminate()
  }
}

testInstalledSandboxModuleSharesOnlyItsOwnState.description =
  'Retains installed module globals within one sandbox while isolating different sandboxes.'

export const testNodeSandboxClonesInputsIntoItsVmContext = async () => {
  const sandbox = await createExecutableSandbox({
    id: `vm-input-${Date.now()}-${Math.random()}`,
    reuse: { mode: 'disposable' },
  })
  try {
    const processType = await sandbox.execute<string>(
      '(value) => value.constructor.constructor("return typeof process")()',
      [{}],
    )
    assert(processType === 'undefined', 'Expected sandbox inputs to use VM-owned prototypes.')
    return { success: true }
  } finally {
    sandbox.terminate()
  }
}

testNodeSandboxClonesInputsIntoItsVmContext.description =
  'Clones host inputs before Node sandbox code can inspect their prototypes.'

export const testExecutableSandboxCancelsOnlyOneConcurrentCall = async () => {
  const transport = createTestTransport()
  const diagnostics: string[] = []
  const sandbox = createExecutableSandboxClient(transport, {
    onDiagnostic: (message) => diagnostics.push(message),
  })
  const controller = new AbortController()
  const cancelled = sandbox.execute('async () => undefined', [], { signal: controller.signal })
  const active = sandbox.execute<number>('() => 7', [])
  const activeRequest = transport.sent.find(
    (message, index) => index === 1 && message.kind === 'execute',
  )
  if (!activeRequest || activeRequest.kind !== 'execute') {
    throw new Error('Expected the active execution request.')
  }

  controller.abort('cancel one')
  transport.receive({ kind: 'result', requestId: activeRequest.requestId, result: 7 })
  let cancellation: unknown
  try {
    await cancelled
  } catch (error) {
    cancellation = error
  }
  assert((cancellation as Error)?.name === 'AbortError', 'Expected a per-call abort error.')
  assert((await active) === 7, 'Expected the other concurrent call to complete.')
  assert(
    transport.sent.some((message) => message.kind === 'cancel'),
    'Expected cancellation to reach the runtime.',
  )
  assert(diagnostics.length === 0, 'Expected no hidden protocol diagnostics.')
  sandbox.terminate()
  return { success: true }
}

testExecutableSandboxCancelsOnlyOneConcurrentCall.description =
  'Cancels one execution without terminating another call in the same sandbox.'

export const testExecutableSandboxProvidesTypedFrpService = async () => {
  const protocol = defineFrpProtocol({
    id: 'taskyon.test.sandbox.echo',
    version: '1',
    commands: {
      echo: { request: z.object({ value: z.string() }), response: z.string() },
    },
  })
  const sandbox = await createExecutableSandbox({
    id: `frp-service-${Date.now()}-${Math.random()}`,
    reuse: { mode: 'disposable' },
  })
  try {
    const service = await connectFrpSandboxService({
      sandbox,
      protocol,
      installerSource: `(port) => {
        port.onmessage = ({ data }) => port.postMessage({
          type: 'echoResponse',
          requestId: data.requestId,
          result: data.value,
        })
      }`,
    })
    try {
      assert((await service.client.echo({ value: 'hello' })) === 'hello', 'Expected FRP echo.')
      return { success: true }
    } finally {
      service.destroy()
    }
  } finally {
    sandbox.terminate()
  }
}

testExecutableSandboxProvidesTypedFrpService.description =
  'Connects a typed FRP client without exposing the sandbox transport to its consumer.'

export const testEnvironmentWorkerUsesFrpCapabilitiesConcurrently = async () => {
  const worker = createEnvironmentWorker<number, number>({
    id: `environment-frp-${Date.now()}-${Math.random()}`,
    handleRequest: (request, postMessage) => postMessage(request * 2),
  })
  const results: number[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Environment worker timed out.')), 5_000)
      worker.onerror = (event) =>
        reject(event.error instanceof Error ? event.error : new Error(event.message))
      worker.onmessage = (event) => {
        results.push(event.data)
        if (results.length === 2) {
          clearTimeout(timeout)
          resolve()
        }
      }
      worker.postMessage(2)
      worker.postMessage(3)
    })
    results.sort((left, right) => left - right)
    assert(results[0] === 4 && results[1] === 6, 'Expected both FRP worker responses.')
    return { success: true }
  } finally {
    worker.terminate()
  }
}

testEnvironmentWorkerUsesFrpCapabilitiesConcurrently.description =
  'Routes concurrent environment-worker calls through isolated FRP capability channels.'
