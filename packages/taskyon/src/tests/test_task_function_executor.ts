import { forgeTaskChain } from '../core/createTasks'
import {
  createInvocationToolResolver,
  findCallingToolReference,
  prepareInvocationToolCall,
} from '../core/taskFunctionExecutor'
import { scopedToolIdentity } from '../core/scopedTools'
import type { partialTaskDraft } from '../types/taskNode'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testTaskFunctionExecutorResolvesRevisionPinnedScopedCaller() {
  const definitionDraft = {
    role: 'assistant',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'scopedCaller',
        description: 'A tree-local caller.',
        parameters: { type: 'object', additionalProperties: false },
        code: 'return null',
      },
    },
  } satisfies partialTaskDraft
  const [identitySource] = await forgeTaskChain([[definitionDraft]])
  assert(identitySource, 'Expected a scoped tool-definition task')
  const revision = scopedToolIdentity(identitySource, 'scopedCaller').revision
  const taskChain = await forgeTaskChain([
    [
      definitionDraft,
      {
        role: 'function',
        content: {
          type: 'functioncall',
          data: { name: 'scopedCaller', arguments: {}, toolRevision: revision },
        },
      },
      {
        role: 'function',
        content: { type: 'functioncall', data: { name: 'delegatedTool', arguments: {} } },
      },
    ],
  ])
  const caller = taskChain[1]
  const delegated = taskChain[2]
  assert(caller && delegated, 'Expected a scoped caller and delegated function call')
  assert(delegated.content.type === 'functioncall', 'Expected a delegated function call')
  const tasks = new Map(taskChain.map((task) => [task.id, task]))
  let registryLookups = 0
  const resolveInvocationTool = createInvocationToolResolver({
    getExecutionTask: (id) => Promise.resolve(tasks.get(id) ?? null),
    getTaskLineage: () => Promise.resolve(taskChain),
    resolveRegisteredTool: () => {
      registryLookups += 1
      return Promise.resolve({})
    },
  })

  const callerReference = findCallingToolReference(taskChain, delegated.content.data.name)
  assert(callerReference, 'Expected the delegated call to retain its caller reference')
  assert(callerReference.taskId === caller.id, 'Caller lookup must retain the caller task id')
  assert(callerReference.revision === revision, 'Caller lookup must retain the scoped revision')
  const resolved = await resolveInvocationTool(callerReference.name, {
    taskId: callerReference.taskId,
    toolRevision: revision,
  })

  assert(resolved.source === 'task-tree', 'Pinned scoped callers must resolve from their task tree')
  assert(resolved.tool?.code === 'return null', 'The scoped caller implementation must be returned')
  assert(registryLookups === 0, 'Scoped caller resolution must not consult the central registry')
}

testTaskFunctionExecutorResolvesRevisionPinnedScopedCaller.description =
  'Revision-pinned scoped callers retain their task identity and resolve through the same task-tree lookup used for execution.'

export async function testTaskFunctionExecutorAppliesOnlyPinnedSettings() {
  const toolRevision = `sha256:${'c'.repeat(43)}` as const
  const settingsRevision = `sha256:${'d'.repeat(43)}` as const
  let requestedSettingsRevision: string | undefined
  const prepared = await prepareInvocationToolCall(
    {
      type: 'functionCall',
      requestId: 'pinned-settings',
      functionName: 'configuredTool',
      toolRevision,
      settingsRevision,
      arguments: { explicit: true },
    },
    {
      resolveInvocationTool: () =>
        Promise.resolve({
          source: 'registry' as const,
          identity: { publisherId: 'test', name: 'configuredTool', revision: toolRevision },
          tool: {
            name: 'configuredTool',
            description: 'Configured tool.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                schemaDefault: { type: 'string', default: 'from-schema' },
                setting: { type: 'string' },
                explicit: { type: 'boolean' },
              },
            },
            function: () => undefined,
          },
        }),
      getTaskById: () => Promise.resolve(null),
      resolveToolSettings: (_name, _toolRevision, revision) => {
        requestedSettingsRevision = revision
        return Promise.resolve({ setting: 'from-pinned-snapshot' })
      },
    },
  )

  assert(requestedSettingsRevision === settingsRevision, 'Expected the exact settings revision')
  assert(
    prepared.arguments.schemaDefault === 'from-schema',
    'Expected schema defaults at execution',
  )
  assert(
    prepared.arguments.setting === 'from-pinned-snapshot',
    'Expected settings from the pinned snapshot',
  )
  assert(prepared.arguments.explicit === true, 'Expected explicit call arguments to win')
}

testTaskFunctionExecutorAppliesOnlyPinnedSettings.description =
  'Applies schema defaults and the exact pinned settings snapshot only when executing a call.'
