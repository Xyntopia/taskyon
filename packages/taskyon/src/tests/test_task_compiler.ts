import { createMapCrudWrapper } from '../utils/crudWrapper'
import { createTool } from '../types/toolApi'
import { createToolManager, type ToolStorageRecord } from '../core/toolManager'
import {
  createInvocationRevisionResolver,
  createToolSettingsManager,
  type ToolSettingsRecord,
} from '../core/toolSettings'
import { compileTaskChain } from '../core/taskCompiler'
import { ensureValidTaskId } from '../core/createTasks'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testTaskCompilerPinsOpaqueInvocationRevisions() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const settingsManager = createToolSettingsManager(
    createMapCrudWrapper<ToolSettingsRecord>(new Map()),
  )
  await toolManager.installTool(
    createTool({
      name: 'configuredTool',
      description: 'Configured tool.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { explicit: { type: 'boolean' }, model: { type: 'string' } },
      },
      function: () => undefined,
    }),
    { approveReplacement: true },
  )
  const resolveInvocationRevisions = createInvocationRevisionResolver({
    resolveTool: toolManager.resolveTool,
    getToolSettings: () => ({ model: 'private-runtime-setting' }),
    settingsManager,
  })

  const [compiled] = await compileTaskChain(
    [
      {
        role: 'function',
        content: {
          type: 'functioncall',
          data: { name: 'configuredTool', arguments: { explicit: true } },
        },
      },
    ],
    {
      lineage: [],
      parentID: 'parent-task',
      toolManager,
      resolveInvocationRevisions,
    },
  )

  assert(compiled !== undefined, 'Expected one compiled task')
  assert(compiled.content.type === 'functioncall', 'Expected a function call')
  assert(compiled.parentID === 'parent-task', 'Expected the compiler to link the parent')
  assert(compiled.content.data.toolRevision !== undefined, 'Expected a tool revision')
  assert(compiled.content.data.settingsRevision !== undefined, 'Expected a settings revision')
  assert(
    compiled.content.data.arguments.model === undefined,
    'Persisted calls must not expose settings values',
  )
  assert(compiled.content.data.arguments.explicit === true, 'Explicit arguments must be preserved')
  assert((await ensureValidTaskId(compiled)).id === compiled.id, 'Compiled id must be verifiable')
}

testTaskCompilerPinsOpaqueInvocationRevisions.description =
  'Compiles linked, verifiable tasks while persisting opaque per-tool revisions instead of settings values.'

export async function testTaskCompilerRejectsAnIdOnADraft() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  let error: unknown
  try {
    await compileTaskChain(
      [
        {
          id: 'already-hashed',
          role: 'assistant',
          content: { type: 'message', data: 'not a draft' },
        },
      ],
      {
        lineage: [],
        toolManager,
        resolveInvocationRevisions: () => Promise.resolve(null),
      },
    )
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, 'Expected a supplied id to be rejected')
}

testTaskCompilerRejectsAnIdOnADraft.description =
  'Keeps compilation of unhashed drafts separate from verification of completed task nodes.'

export async function testTaskCompilerRejectsAnUnresolvedToolCall() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  let error: unknown
  try {
    await compileTaskChain(
      [
        {
          role: 'function',
          content: {
            type: 'functioncall',
            data: { name: 'missingTool', arguments: {} },
          },
        },
      ],
      {
        lineage: [],
        toolManager,
        resolveInvocationRevisions: () => Promise.resolve(null),
      },
    )
  } catch (caught) {
    error = caught
  }

  assert(error instanceof Error, 'Expected an unresolved tool call to fail compilation')
  assert(
    error.message.includes('missingTool'),
    'Expected the compilation error to identify the unresolved tool',
  )
}

testTaskCompilerRejectsAnUnresolvedToolCall.description =
  'Rejects function calls that cannot be pinned to immutable invocation revisions before hashing.'
