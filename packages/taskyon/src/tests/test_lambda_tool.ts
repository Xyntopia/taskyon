import { bind, lambda } from '../tools/lambdaTool'
import { ScopedToolDefinition, type partialTaskDraft } from '../types/taskNode'
import { FunctionCall } from '../types/tools'
import { compileScopedToolDefinition } from '../core/scopedTools'
import { createSubtasksResult, taskResult } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const requireFunctionCall = (task: partialTaskDraft | undefined) => {
  if (task?.content.type !== 'functioncall') throw new Error('Expected a function call task')
  return FunctionCall.parse(task.content.data)
}

const requireScopedDefinition = (task: partialTaskDraft | undefined) => {
  if (task?.content.type !== 'tooldefinition') throw new Error('Expected a tool definition task')
  return ScopedToolDefinition.parse(task.content.data)
}

const chooserParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedTools: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const

export const testLambdaCreatesScopedDefinitionBeforeForcedChatCompletion = () => {
  const tasks = lambda(
    {
      name: 'selectTaskyonTools',
      description: 'Select tools for the next task.',
      parameters: chooserParameters,
      code: 'async (params) => params',
    },
    { reasoning_effort: 'low' },
  )

  assert(tasks.length === 2, 'Expected a definition followed by one chat completion')
  assert(
    tasks[0]?.content.type === 'tooldefinition' &&
      tasks[0].content.data.name === 'selectTaskyonTools',
    'Expected the first task to declare the scoped tool',
  )
  const chatCall = requireFunctionCall(tasks[1])
  assert(chatCall.name === 'chatCompletion', 'Expected the lambda to call chatCompletion')
  assert(
    JSON.stringify(chatCall.arguments.allowedTools) === JSON.stringify(['selectTaskyonTools']),
    'Expected only the scoped tool to be allowed',
  )
  assert(
    JSON.stringify(chatCall.arguments.toolChoice) ===
      JSON.stringify({ type: 'tool', toolName: 'selectTaskyonTools' }),
    'Expected the scoped tool to be forced',
  )
  assert(
    chatCall.arguments.reasoning_effort === 'low',
    'Expected additional chat completion arguments to be preserved',
  )
}

testLambdaCreatesScopedDefinitionBeforeForcedChatCompletion.description =
  'Creates a task-scoped code tool followed by a chat completion forced to invoke that tool.'

export const testLambdaRejectsChatOverridesAndNativeFunctions = () => {
  let overrideRejected = false
  try {
    Reflect.apply(lambda, undefined, [
      {
        name: 'scopedTool',
        description: 'Scoped tool.',
        parameters: chooserParameters,
        code: '() => undefined',
      },
      { allowedTools: ['otherTool'] },
    ])
  } catch {
    overrideRejected = true
  }

  let functionRejected = false
  try {
    Reflect.apply(lambda, undefined, [
      {
        name: 'nativeScopedTool',
        description: 'Invalid native scoped tool.',
        parameters: chooserParameters,
        code: '() => undefined',
        function: () => undefined,
      },
    ])
  } catch {
    functionRejected = true
  }

  let overlapRejected = false
  try {
    bind({
      name: 'invalidBinding',
      description: 'Invalid binding.',
      target: 'taskyonFlow',
      fixedArguments: { allowedTools: [] },
      publicArguments: { allowedTools: {} },
    })
  } catch {
    overlapRejected = true
  }

  assert(overrideRejected, 'Expected lambda-owned chat options to reject overrides')
  assert(functionRejected, 'Expected persisted native functions to be rejected')
  assert(overlapRejected, 'Expected bound arguments not to remain publicly exposed')
}

testLambdaRejectsChatOverridesAndNativeFunctions.description =
  'Rejects lambda routing overrides and native functions in persisted scoped definitions.'

export const testBindCreatesDeclarativeBinding = () => {
  const tasks = bind(
    {
      name: 'selectTaskyonTools',
      description: 'Select tools for the next task.',
      target: 'taskyonFlow',
      fixedArguments: { use_tool_chooser: false },
      publicArguments: {
        allowedTools: { description: 'Candidate tools.', maxItems: 20 },
      },
    },
    { reasoning_effort: 'low' },
  )
  const definition = requireScopedDefinition(tasks[0])
  assert(
    'implementation' in definition &&
      definition.implementation.type === 'binding' &&
      definition.implementation.target === 'taskyonFlow',
    'Expected bind to persist a declarative target binding',
  )
  assert(
    'implementation' in definition &&
      definition.implementation.type === 'binding' &&
      definition.implementation.publicArguments.allowedTools?.maxItems === 20,
    'Expected bind to persist the public parameter patch',
  )
  assert(tasks[1]?.content.type === 'functioncall', 'Expected bind to delegate to lambda')
}

testBindCreatesDeclarativeBinding.description =
  'Builds a declarative target binding and the forced chat completion used to invoke it.'

export const testBindKeepsFixedAndPublicArgumentsSeparate = () => {
  const tasks = bind({
    name: 'selectTaskyonTools',
    description: 'Select tools for the next task.',
    target: 'taskyonFlow',
    fixedArguments: { use_tool_chooser: false },
    publicArguments: { allowedTools: {} },
  })
  const definition = requireScopedDefinition(tasks[0])
  assert(
    'implementation' in definition &&
      definition.implementation.type === 'binding' &&
      definition.implementation.fixedArguments.use_tool_chooser === false &&
      Object.hasOwn(definition.implementation.publicArguments, 'allowedTools'),
    'Expected fixed arguments and public argument selection to remain distinct',
  )
}

testBindKeepsFixedAndPublicArgumentsSeparate.description =
  'Keeps fixed binding arguments separate from the public provider-facing parameters.'

export const testDeclarativeBindingCompilesToValidatedTargetCall = async () => {
  const definition = requireScopedDefinition(
    bind({
      name: 'selectTaskyonTools',
      description: 'Select tools.',
      target: 'taskyonFlow',
      fixedArguments: { use_tool_chooser: false },
      publicArguments: { allowedTools: { maxItems: 20 } },
    })[0],
  )
  const revision = `sha256:${'a'.repeat(43)}` as const
  const compiled = await compileScopedToolDefinition(definition, () =>
    Promise.resolve({
      identity: { publisherId: 'test', name: 'taskyonFlow', revision },
      tool: {
        name: 'taskyonFlow',
        description: 'Run a flow.',
        parameters: {
          type: 'object',
          properties: {
            allowedTools: { type: 'array', items: { type: 'string' } },
            use_tool_chooser: { type: 'boolean' },
          },
          required: ['allowedTools'],
        },
        function: () => undefined,
      },
    }),
  )
  assert(compiled.tool.parameters.maxProperties === undefined, 'Expected a derived object schema')
  assert(compiled.tool.function !== undefined, 'Expected the core binding interpreter')
  const result = taskResult.parse(
    await compiled.tool.function?.({ allowedTools: ['clock'] }, {
      createSubtasksResult,
    } as Parameters<NonNullable<typeof compiled.tool.function>>[1]),
  )
  const call = requireFunctionCall(result.taskChainList[0]?.[0])
  assert(call.toolRevision === revision, 'Expected the target revision to be pinned')
  assert(call.arguments.use_tool_chooser === false, 'Expected fixed arguments to win')
}

testDeclarativeBindingCompilesToValidatedTargetCall.description =
  'Compiles a declarative binding into a pinned target call without persisted native code.'
