import { createDuplexChannel } from '@taskyon/common/modules/frpBus'
import { createTaskyonClient, processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import { callToolOverRpc, createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import type { ToolRpcCallMessage, ToolRpcResponderMessage } from '../core/toolRpc'
import type { TaskyonMessage } from '../api/taskyonProtocol'
import type { TaskNode } from '../types/taskNode'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { createCryptoSession } from '../utils/cryptoSession'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testRemoteFunctionBridgeHonorsToolTimeoutMs = async () => {
  const { x: workerPort, y: remotePort } = createDuplexChannel<
    ToolRpcCallMessage,
    ToolRpcResponderMessage
  >()
  const unsubscribe = remotePort.receive((msg) => {
    if (msg.type !== 'functionCall') return
    setTimeout(() => {
      remotePort.send({
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        response: { ok: true },
      })
    }, 30_100)
  })

  try {
    const result = await callToolOverRpc(
      {
        name: 'slowRemote',
        arguments: { timeoutMs: 31_000 },
      },
      workerPort,
    )

    assert(
      typeof result === 'object' && result !== null && 'ok' in result && result.ok === true,
      'Expected remote function response after caller-provided timeoutMs',
    )
  } finally {
    unsubscribe()
  }

  return { success: true }
}

testRemoteFunctionBridgeHonorsToolTimeoutMs.description =
  'Honors a remote tool call timeoutMs value instead of timing out all remote bridge calls after 30 seconds.'
testRemoteFunctionBridgeHonorsToolTimeoutMs.timeoutMs = 35_000

export const testTyCoreStableTaskStreamSurvivesSessionSwitch = async () => {
  const storage = createPortableTestStorage()
  const ty = await tyCore(
    () => ({
      entryFunction: 'entryNode',
    }),
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {},
    undefined,
    {
      indexTaskVectors: false,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )

  const waitForMessage = (message: string) =>
    ty.taskStream
      .filter(({ data }) => data?.content.type === 'message' && data.content.data === message)
      .wait({ timeoutMs: 1000 })

  try {
    const beforeSwitch = waitForMessage('before session switch')
    await createTaskyonClient(ty.port).task.create({
      execute: false,
      show: false,
      task: {
        role: 'user',
        content: { type: 'message', data: 'before session switch' },
      },
    })
    await beforeSwitch

    await ty.setNewSession(await createCryptoSession())

    const afterSwitch = waitForMessage('after session switch')
    await createTaskyonClient(ty.port).task.create({
      execute: false,
      show: false,
      task: {
        role: 'user',
        content: { type: 'message', data: 'after session switch' },
      },
    })
    await afterSwitch
  } finally {
    await ty.dispose('stable task stream diagnostic complete')
    storage.destroy()
  }
}

testTyCoreStableTaskStreamSurvivesSessionSwitch.description =
  'Keeps the public task stream connected across a crypto session switch without caller-side reconnects.'

export const testRemoteFunctionBridgeRegistersAndExecutesTool = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  let callCount = 0
  const echoTool = createTool({
    name: 'remoteEcho',
    description: 'Echo a message through the remote tool bridge.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string' },
      },
    } as const,
    function: ({ message }) => {
      callCount += 1
      return { echoed: message }
    },
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({ port: clientPort, tools: [echoTool] })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  assert(toolDescription.name === 'remoteEcho', 'expected remoteEcho registration')

  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise

  const responsePromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteEcho',
    requestId: 'remote-echo-1',
    arguments: {
      message: 'hello',
    },
  })
  const response = await responsePromise

  registration.destroy()
  if (response.type !== 'functionResponse') {
    throw new Error('expected functionResponse message')
  }
  assert(response.functionName === 'remoteEcho', 'expected remoteEcho response')
  assert(response.requestId === 'remote-echo-1', 'expected matching request id')
  assert(!response.error, `expected no error, got ${String(response.error)}`)
  assert(
    typeof response.response === 'object' &&
      response.response !== null &&
      'echoed' in response.response &&
      response.response.echoed === 'hello',
    'expected echoed response payload',
  )
  assert(callCount === 1, 'expected tool to run exactly once')
}

testRemoteFunctionBridgeRegistersAndExecutesTool.description =
  'Registers a remote tool over the Taskyon port and executes it through the shared RPC executor.'

export const testRemoteFunctionBridgeRejectsExternalSecretAccess = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const secretTool = createTool({
    name: 'remoteSecretReader',
    description: 'Try to read a secret through the remote tool bridge.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: async (_args, ctx) => await ctx.getSecret('apiKey', false),
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({ port: clientPort, tools: [secretTool] })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  assert(toolDescription.name === 'remoteSecretReader', 'expected remoteSecretReader registration')

  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise

  const responsePromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteSecretReader',
    requestId: 'remote-secret-reader-1',
    arguments: {},
  })
  const response = await responsePromise

  registration.destroy()
  if (response.type !== 'functionResponse') {
    throw new Error('expected functionResponse message')
  }
  assert(response.functionName === 'remoteSecretReader', 'expected remoteSecretReader response')
  assert(response.requestId === 'remote-secret-reader-1', 'expected matching request id')
  assert(response.error !== undefined, 'expected remote secret access to fail closed')
  assert(
    JSON.stringify(response.error).includes(
      'Secret access is not implemented for external tool clients yet.',
    ),
    `expected not implemented secret error, got ${JSON.stringify(response.error)}`,
  )
}

testRemoteFunctionBridgeRejectsExternalSecretAccess.description =
  'Rejects secret access from external remote tools until a scoped secret protocol is implemented.'

export const testRemoteFunctionBridgeProvidesExternalExecutionTaskChain = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const taskChain: TaskNode[] = [
    {
      id: 'user-task',
      role: 'user',
      content: {
        type: 'message',
        data: 'hello',
      },
    },
    {
      id: 'entry-task',
      role: 'function',
      priorID: 'user-task',
      content: {
        type: 'functioncall',
        data: {
          name: 'remoteTaskChainReader',
          arguments: {},
        },
      },
    },
  ]
  let requestedTaskId: string | undefined
  const taskChainTool = createTool({
    name: 'remoteTaskChainReader',
    description: 'Read the current execution task chain through the remote tool bridge.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: async (_args, ctx) => {
      const chain = await ctx.getExecutionTaskChain()
      return chain.map((task) => task.id)
    },
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({
    port: clientPort,
    tools: [taskChainTool],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          if (!call.taskId) throw new Error('Expected task id for remote task-chain test')
          requestedTaskId = call.taskId
          return Promise.resolve(taskChain)
        },
      }),
  })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  assert(
    toolDescription.name === 'remoteTaskChainReader',
    'expected remoteTaskChainReader registration',
  )

  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise

  const responsePromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteTaskChainReader',
    requestId: 'remote-task-chain-reader-1',
    taskId: 'entry-task',
    arguments: {},
  })
  const response = await responsePromise

  registration.destroy()
  if (response.type !== 'functionResponse') {
    throw new Error('expected functionResponse message')
  }
  assert(
    response.functionName === 'remoteTaskChainReader',
    'expected remoteTaskChainReader response',
  )
  assert(response.requestId === 'remote-task-chain-reader-1', 'expected matching request id')
  assert(!response.error, `expected no error, got ${JSON.stringify(response.error)}`)
  assert(requestedTaskId === 'entry-task', `expected entry-task lookup, got ${requestedTaskId}`)
  assert(
    Array.isArray(response.response) && response.response.join(',') === 'user-task,entry-task',
    `expected task chain ids, got ${JSON.stringify(response.response)}`,
  )
}

testRemoteFunctionBridgeProvidesExternalExecutionTaskChain.description =
  'Provides getExecutionTaskChain to external remote tools when the caller supplies a task id and resolver.'

export const testRemoteFunctionBridgeAllowsExplicitExternalSecretContext = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const secrets = new Map<string, string>()
  const secretTool = createTool({
    name: 'remoteSecretWriter',
    description: 'Read and write a secret through an explicitly provided local context.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value'],
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
    } as const,
    function: async ({ key, value }, ctx) => {
      await ctx.setSecret(key, value)
      return await ctx.getSecret(key, false)
    },
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({
    port: clientPort,
    tools: [secretTool],
    createContext: (call, stopSignal) => ({
      getExecutionTaskChain: () => Promise.resolve([]),
      createSubtasksResult,
      getSecret: (name) => Promise.resolve(secrets.get(`${call.functionName}:${name}`) ?? null),
      setSecret: (name, value) => {
        secrets.set(`${call.functionName}:${name}`, value)
        return Promise.resolve()
      },
      stopSignal,
      toolId: call.functionName,
    }),
  })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  assert(toolDescription.name === 'remoteSecretWriter', 'expected remoteSecretWriter registration')

  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise

  const responsePromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteSecretWriter',
    requestId: 'remote-secret-writer-1',
    arguments: {
      key: 'apiKey',
      value: 'local-secret-value',
    },
  })
  const response = await responsePromise

  registration.destroy()
  if (response.type !== 'functionResponse') {
    throw new Error('expected functionResponse message')
  }
  assert(response.functionName === 'remoteSecretWriter', 'expected remoteSecretWriter response')
  assert(response.requestId === 'remote-secret-writer-1', 'expected matching request id')
  assert(!response.error, `expected no error, got ${JSON.stringify(response.error)}`)
  assert(response.response === 'local-secret-value', 'expected explicit secret context response')
  assert(
    secrets.get('remoteSecretWriter:apiKey') === 'local-secret-value',
    'expected secret to be scoped by remote function name',
  )
}

testRemoteFunctionBridgeAllowsExplicitExternalSecretContext.description =
  'Allows trusted external tool registrations to provide an explicit local secret context while keeping the default fail-closed.'

export const testRemoteFunctionBridgeRegistersAndExecutesCodeTool = async () => {
  const storage = createPortableTestStorage()
  const ty = await tyCore(
    () => ({
      entryFunction: 'entryNode',
    }),
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {},
    undefined,
    {
      indexTaskVectors: false,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  const codeTool = createTool({
    name: 'remoteCodeSecretEcho',
    description: 'Echo a message and persist a secret through a remote code-backed tool.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['message', 'secret'],
      properties: {
        message: { type: 'string' },
        secret: { type: 'string' },
      },
    } as const,
    code: `async ({ message, secret }, ctx) => {
      await ctx.setSecret('test-secret', secret)
      return {
        echoed: message,
        secret: await ctx.getSecret('test-secret', false),
        source: 'core-code',
      }
    }`,
  })

  const registration = await registerToolRpcTools({ port: ty.port, tools: [codeTool] })
  const result = await processTasksDetailed(ty.port)(
    [
      [
        toolCall({
          name: 'remoteCodeSecretEcho',
          arguments: {
            message: 'hello',
            secret: 'stored-by-core-code',
          },
        }),
      ],
    ],
    'toolresult',
    {
      timeoutMs: 10_000,
      interruptOnSettle: (reason) => ty.cancelCurrentRun(reason),
    },
  )

  registration.destroy()
  await ty.dispose('remote code tool diagnostic complete')
  storage.destroy()
  const response =
    result.status === 'matched' && result.result.content.type === 'toolresult'
      ? result.result.content.data
      : undefined
  assert(
    typeof response === 'object' &&
      response !== null &&
      'echoed' in response &&
      response.echoed === 'hello' &&
      'secret' in response &&
      response.secret === 'stored-by-core-code' &&
      'source' in response &&
      response.source === 'core-code',
    'expected core-executed code-backed response payload with secret access',
  )
}

testRemoteFunctionBridgeRegistersAndExecutesCodeTool.description =
  'Registers a code-backed remote tool into Taskyon core and executes it through the core sandbox with secret access.'

export const testRemoteFunctionBridgeDoesNotExecuteCodeToolsOnClient = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const codeTool = createTool({
    name: 'remoteClientSideCodeBlock',
    description: 'A code-backed tool that must not execute on the registering client.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    code: `() => ({ shouldNotRunOnClient: true })`,
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({ port: clientPort, tools: [codeTool] })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  assert(
    toolDescription.name === 'remoteClientSideCodeBlock',
    'expected remoteClientSideCodeBlock registration',
  )
  assert(toolDescription.code === codeTool.code, 'expected code to be advertised')

  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise

  let receivedResponse = false
  const unsubscribe = taskyonPort.receive((message) => {
    if (message.type === 'functionResponse') receivedResponse = true
  })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteClientSideCodeBlock',
    requestId: 'remote-client-side-code-block-1',
    arguments: {},
  })
  await new Promise((resolve) => setTimeout(resolve, 50))

  unsubscribe()
  registration.destroy()
  assert(!receivedResponse, 'expected code-backed tools not to execute on the registering client')
}

testRemoteFunctionBridgeDoesNotExecuteCodeToolsOnClient.description =
  'Registers code-backed remote tools without installing a client-side executor for them.'
