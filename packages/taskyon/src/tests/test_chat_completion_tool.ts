import {
  convertTaskNodesToOpenAIChat,
  createChatCompletionTool,
  getCommandFromStructuredResponse,
  prepareChatCompletionContext,
  resolveToolDefinitionsForTaskChain,
} from '../tools/chatCompletionTool'
import { createChatCompletionRecordingFetch } from '../tools/chatCompletionTrace'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { findContinuationLeafTaskIds, selectTaskChainIds } from '../core/taskChainSelection'
import { createTaskVariablePresentationService } from '../core/taskVariables'
import {
  buildChatProviderRequest,
  normalizeNativeStructuredOutputSchema,
} from '../tools/chatCompletion/providerRequest'
import { CODEX_MODELS_CLIENT_VERSION, fetchModelsForProvider } from '../llm/modelDiscovery'
import {
  convertProviderSourceToAnnotation,
  interpretAssistantMessage,
  parseStructuredResponseWithTrailingText,
  validateStructuredResponse,
} from '../tools/chatCompletion/response'
import { classifyStreamingFailure } from '../tools/chatCompletion/streamResult'
import {
  resolveChatCompletionConnection,
  type ChatCompletionProviderSettings,
  type ProviderRequestTrace,
} from '../types/chatCompletion'
import { getTaskyonCosts } from '../taskyon.space/taskyon.space_api'
import { taskPlanner } from '../tools/TaskPlannerTool'
import { webResearchPlanner } from '../tools/webResearchTool'
import { jsonSchema, streamText } from 'ai'
import type { JSONSchema7 } from 'json-schema'
import { Annotation, type TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const providerSettings = (
  provider: string,
  baseURL: string,
  networkTransport: 'auto' | 'direct' | 'wss' | 'custom-proxy' = 'auto',
): ChatCompletionProviderSettings => ({
  provider,
  name: provider,
  model: 'test-model',
  baseURL,
  streamSupport: true,
  networkTransport,
  recommendedTransport: provider === 'chatgpt-codex' ? 'wss' : 'direct',
  routes: { chatCompletion: '/chat/completions', models: '/models' },
})

export const testChatCompletionPreservesTextFollowingStructuredJson = () => {
  const parsed = parseStructuredResponseWithTrailingText(
    '{"candidates":[{"title":"Official rules"}]}\n\nThe selected document is ready.',
  )
  const data = parsed.data as { candidates?: { title?: string }[] }

  assert(data.candidates?.[0]?.title === 'Official rules', 'Expected the structured data')
  assert(
    parsed.trailingText === 'The selected document is ready.',
    'Expected trailing assistant text to remain available',
  )
  return { success: true }
}

export const testChatCompletionRetainsAdditionalStructuredFields = () => {
  const value = {
    candidates: [{ title: 'Official rules' }],
    providerNote: 'Useful extra response data.',
  }
  const validated = validateStructuredResponse(value, {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      },
    },
    required: ['candidates'],
  }) as typeof value

  assert(
    validated.providerNote === value.providerNote,
    'Expected extra response data to be retained',
  )
  assert(
    validated.candidates[0]?.title === 'Official rules',
    'Expected schema fields to remain validated',
  )
  let rejectedInvalidOutput = false
  try {
    validateStructuredResponse(
      { providerNote: 'missing candidates' },
      {
        type: 'object',
        properties: { candidates: { type: 'array' } },
        required: ['candidates'],
      },
    )
  } catch {
    rejectedInvalidOutput = true
  }
  assert(rejectedInvalidOutput, 'Expected missing required fields to remain an error')
  return { success: true }
}

export const testNativeStructuredOutputSchemaAddsClosedObjectBoundaries = () => {
  const schema: JSONSchema7 = {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            finding: { type: 'string' },
          },
          required: ['path', 'finding'],
        },
      },
    },
    required: ['findings'],
  }

  const normalized = normalizeNativeStructuredOutputSchema(schema)
  assert(normalized?.additionalProperties === false, 'Expected the root object to be closed')
  const properties = normalized.properties
  assert(
    typeof properties === 'object' && properties !== null && !Array.isArray(properties),
    'Expected normalized schema properties',
  )
  const findings = 'findings' in properties ? properties.findings : undefined
  assert(
    typeof findings === 'object' && findings !== null && !Array.isArray(findings),
    'Expected the findings schema',
  )
  assert('items' in findings, 'Expected findings schema items')
  const item = Array.isArray(findings.items) ? findings.items[0] : findings.items
  assert(
    typeof item === 'object' && item !== null && item.additionalProperties === false,
    'Expected nested object items to be closed',
  )
  assert(!('additionalProperties' in schema), 'Expected normalization not to mutate input')
}

export const testNativeStructuredOutputSchemaRejectsPermissiveOrOptionalObjects = () => {
  assert(
    normalizeNativeStructuredOutputSchema({
      type: 'object',
      additionalProperties: true,
      properties: { value: { type: 'string' } },
      required: ['value'],
    }) === undefined,
    'Expected explicit additional properties to use prompted structured output instead',
  )
  assert(
    normalizeNativeStructuredOutputSchema({
      type: 'object',
      properties: { requiredValue: { type: 'string' }, optionalValue: { type: 'string' } },
      required: ['requiredValue'],
    }) === undefined,
    'Expected optional object fields to use prompted structured output instead',
  )
}

const task = (node: TaskNode) => node

export const testChatCompletionToolSchemaExplainsTaskyonUseMapping = async () => {
  const context = await prepareChatCompletionContext({
    taskChain: [
      task({
        id: 'variable-tool-user',
        role: 'user',
        content: { type: 'message', data: 'Create a project from the prior node.' },
      }),
    ],
    allowedTools: ['projectTool'],
    toolDefinitions: {
      projectTool: {
        name: 'projectTool',
        description: 'Create a project.',
        parameters: {
          type: 'object',
          properties: { rootNodeId: { type: 'string' } },
        },
      },
    },
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: () => Promise.resolve(null),
  })

  const schema = JSON.stringify(context.tools.projectTool)
  assert(
    schema.includes('omit') && schema.includes('literal arguments'),
    'Expected the provider tool contract to say $use-mapped arguments must be omitted from literal arguments',
  )
  return { success: true }
}

testChatCompletionToolSchemaExplainsTaskyonUseMapping.description =
  'Explains to the model that $use supplies a value instead of a literal tool argument.'

export const testChatCompletionDiscoversScopedToolsWithoutRenderingTheirDefinitions = async () => {
  const hiddenReferencedTask = task({
    id: 'hidden-definition-reference',
    role: 'system',
    content: { type: 'message', data: 'PRIVATE DEFINITION IMPLEMENTATION INPUT' },
  })
  const scopedToolTask = task({
    id: 'scoped-tool-definition',
    role: 'system',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'localClock',
        description: 'Read a local clock.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        code: `() => '_t:${hiddenReferencedTask.id}'`,
      },
    },
  })
  const userTask = task({
    id: 'scoped-tool-user',
    role: 'user',
    priorID: scopedToolTask.id,
    content: { type: 'message', data: 'What time is it?' },
  })
  const registeredClock: ToolBase = {
    name: 'localClock',
    description: 'Read the registered clock.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }
  const definitions = await resolveToolDefinitionsForTaskChain([scopedToolTask, userTask], {
    localClock: registeredClock,
  })
  const prepared = await prepareChatCompletionContext({
    taskChain: [scopedToolTask, userTask],
    allowedTools: ['localClock'],
    toolDefinitions: definitions,
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: (id) =>
      Promise.resolve(id === hiddenReferencedTask.id ? hiddenReferencedTask : null),
  })
  const renderedMessages = JSON.stringify(prepared.messages)

  assert(
    definitions.localClock?.description === 'Read a local clock.',
    'Expected the nearest scoped definition to shadow the registered definition',
  )
  assert('localClock' in prepared.tools, 'Expected the scoped public contract in provider tools')
  assert(
    !renderedMessages.includes('Read a local clock.'),
    'Expected no definition metadata in messages',
  )
  assert(
    !renderedMessages.includes('PRIVATE DEFINITION'),
    'Expected definition refs to stay hidden',
  )
  assert(
    !renderedMessages.includes(hiddenReferencedTask.id),
    'Expected definition IDs to stay hidden',
  )
}

testChatCompletionDiscoversScopedToolsWithoutRenderingTheirDefinitions.description =
  'Discovers lineage-scoped tools while excluding their metadata, code, and references from provider messages.'

export const testChatCompletionScopesPlannerSubtasksToTheirDelegatedObjective = async () => {
  const tasks = [
    task({
      id: 'planner-parent-request',
      role: 'user',
      content: {
        type: 'message',
        data: 'Parent request: use taskPlanner once to inspect and summarize the project.',
      },
    }),
    task({
      id: 'planner-parent-call',
      role: 'function',
      priorID: 'planner-parent-request',
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: { tasks: [] } } },
    }),
    task({
      id: 'planner-child-objective',
      role: 'user',
      parentID: 'planner-parent-call',
      content: { type: 'message', data: 'Task objective: inspect the README and summarize it.' },
    }),
  ]
  const context = await prepareChatCompletionContext({
    taskChain: tasks,
    allowedTools: [],
    toolDefinitions: { taskPlanner },
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: () => Promise.resolve(null),
  })
  const renderedMessages = JSON.stringify(context.messages)

  assert(
    renderedMessages.includes('Task objective: inspect the README and summarize it.'),
    'Expected a delegated task objective to remain in its model context',
  )
  assert(
    !renderedMessages.includes('Parent request: use taskPlanner once'),
    'Expected delegated tasks not to repeat the parent planning instruction',
  )

  const researchContext = await prepareChatCompletionContext({
    taskChain: [
      task({
        id: 'research-parent-request',
        role: 'user',
        content: {
          type: 'message',
          data: 'Parent request: use webResearchPlanner once and save the official PDF.',
        },
      }),
      task({
        id: 'research-parent-call',
        role: 'function',
        priorID: 'research-parent-request',
        content: { type: 'functioncall', data: { name: 'webResearchPlanner', arguments: {} } },
      }),
      task({
        id: 'research-child-objective',
        role: 'user',
        parentID: 'research-parent-call',
        content: {
          type: 'message',
          data: 'Research objective: find and verify the official current rules PDF.',
        },
      }),
    ],
    allowedTools: [],
    toolDefinitions: { webResearchPlanner },
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: () => Promise.resolve(null),
  })
  const researchMessages = JSON.stringify(researchContext.messages)
  assert(
    researchMessages.includes(
      'Research objective: find and verify the official current rules PDF.',
    ),
    'Expected the web research subtask objective to remain in its model context',
  )
  assert(
    !researchMessages.includes('Parent request: use webResearchPlanner once'),
    'Expected the web research subtask not to repeat the parent planner request',
  )

  const parentContinuation = await prepareChatCompletionContext({
    taskChain: [
      ...tasks,
      task({
        id: 'planner-child-result',
        role: 'assistant',
        parentID: 'planner-parent-call',
        priorID: 'planner-child-objective',
        content: { type: 'message', data: 'README summary handoff.' },
      }),
      task({
        id: 'planner-parent-continuation',
        role: 'user',
        priorID: 'planner-parent-call',
        content: { type: 'message', data: 'Summarize the completed delegated work.' },
      }),
    ],
    allowedTools: [],
    toolDefinitions: { taskPlanner },
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: () => Promise.resolve(null),
    subtaskHandoffTaskIds: new Set(['planner-child-objective', 'planner-child-result']),
  })
  const continuationMessages = JSON.stringify(parentContinuation.messages)
  assert(
    continuationMessages.includes('Parent request: use taskPlanner once') &&
      continuationMessages.includes('README summary handoff.') &&
      continuationMessages.includes('Summarize the completed delegated work.'),
    'Expected parent continuation to retain its request and the completed subtask handoff',
  )
}

testChatCompletionScopesPlannerSubtasksToTheirDelegatedObjective.description =
  'Starts a delegated planner task from its own objective instead of replaying the parent planning request.'

export const testChatCompletionPreservesEvidenceWithinResearchStages = async () => {
  const context = await prepareChatCompletionContext({
    taskChain: [
      task({
        id: 'research-stage-call',
        role: 'function',
        content: {
          type: 'functioncall',
          data: { name: 'webResearchPipeline', arguments: { stage: 'artifact' } },
        },
      }),
      task({
        id: 'research-stage-storage-call',
        role: 'function',
        parentID: 'research-stage-call',
        content: {
          type: 'functioncall',
          data: { name: 'storage', arguments: { action: 'read', id: 'rules.pdf' } },
        },
      }),
      task({
        id: 'research-stage-storage-result',
        role: 'function',
        parentID: 'research-stage-storage-call',
        content: {
          type: 'toolresult',
          data: { id: 'rules.pdf', text: 'Verified PDF text from Rule 4.' },
        },
      }),
      task({
        id: 'research-stage-prompt',
        role: 'user',
        parentID: 'research-stage-call',
        priorID: 'research-stage-storage-result',
        content: { type: 'message', data: 'Verify the downloaded artifact.' },
      }),
    ],
    allowedTools: [],
    toolDefinitions: {},
    appendSystemPrompts: [],
    prependSystemPrompts: [],
    useVisionModels: false,
    getTaskById: () => Promise.resolve(null),
  })

  assert(
    JSON.stringify(context.messages).includes('Verified PDF text from Rule 4.'),
    'Expected a research stage to retain its preceding storage evidence',
  )
  return { success: true }
}

testChatCompletionPreservesEvidenceWithinResearchStages.description =
  'Keeps prior tool evidence in internal research-stage completions.'

export const testHiddenScopedSelectorDoesNotRenderMissingToolResponse = async () => {
  const scopedSelector = task({
    id: 'hidden-selector-definition',
    role: 'system',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'toolSearcher',
        description: 'Select relevant tools.',
        renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
        implementation: {
          type: 'binding',
          target: 'toolSearcher',
          targetRevision: 'sha256:selector-target-revision',
          fixedArguments: { analyze: true },
          publicArguments: {
            query: { type: 'string' },
          },
        },
      },
    },
  })
  const selectorCall = task({
    id: 'hidden-selector-call',
    role: 'function',
    parentID: scopedSelector.id,
    content: {
      type: 'functioncall',
      data: { name: 'toolSearcher', arguments: { query: 'workspace exploration' } },
    },
  })
  const definitions = await resolveToolDefinitionsForTaskChain([scopedSelector, selectorCall], {
    toolSearcher: {
      name: 'toolSearcher',
      description: 'Search tools.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          analyze: { type: 'boolean' },
        },
      },
    },
  })
  assert(
    definitions.toolSearcher?.renderOptions?.hideLlm === true,
    'Expected scoped selector render options to survive binding resolution',
  )
  const messages = await convertTaskNodesToOpenAIChat(
    [scopedSelector, selectorCall],
    undefined,
    false,
    true,
    definitions,
  )
  assert(
    !JSON.stringify(messages).includes('No response was recorded from the tool.'),
    'Expected hidden selector continuations not to render a fake missing tool result',
  )
  return { messages }
}

testHiddenScopedSelectorDoesNotRenderMissingToolResponse.description =
  'Keeps hidden selector continuations out of provider tool-call history instead of inserting a fake missing result.'

export const testChatCompletionConnectionIsAnImmutableCreationSnapshot = () => {
  const providerSettings = {
    provider: 'openai',
    name: 'openai',
    baseURL: 'https://api.openai.com',
    defaultHeaders: {
      'HTTP-Referer': 'https://taskyon.space',
      'X-Title': 'Taskyon',
    },
    streamSupport: true,
    routes: {
      chatCompletion: '/v1/chat/completions',
      models: '/v1/models',
    },
    model: 'gpt-5',
  }
  const connection = resolveChatCompletionConnection(providerSettings)
  providerSettings.baseURL = 'https://attacker.example'
  providerSettings.defaultHeaders['HTTP-Referer'] = 'https://attacker.example'
  providerSettings.routes.chatCompletion = '/capture'
  providerSettings.model = 'gpt-5.1'

  assert(connection.baseURL === 'https://api.openai.com', 'Expected a captured target URL')
  assert(
    connection.defaultHeaders?.['HTTP-Referer'] === 'https://taskyon.space',
    'Expected captured provider headers',
  )
  assert(
    connection.routes.chatCompletion === '/v1/chat/completions',
    'Expected captured connection routes',
  )
  assert(!('model' in connection), 'Model must remain a materialized tool parameter')

  const unavailable = () => {
    throw new Error('Not used by this schema-boundary test.')
  }
  const { chatCompletion } = createChatCompletionTool(connection, {
    getTaskChain: unavailable,
    getTaskChainSelection: unavailable,
    getTask: unavailable,
    listToolDefinitions: unavailable,
    metaUpsert: unavailable,
  })
  const properties = chatCompletion.parameters.properties

  assert('model' in properties, 'Expected model to remain in chatCompletion parameters')
  assert(!('provider' in properties), 'Provider must not be an executable tool parameter')
  assert(!('baseURL' in properties), 'Target URL must not be an executable tool parameter')
  assert(
    !('defaultHeaders' in properties),
    'Provider headers must not be executable tool parameters',
  )
  assert(!('routes' in properties), 'Connection routes must not be executable tool parameters')
}

const createTaskAccess = (tasks: TaskNode[]) => {
  const tasksById = new Map(tasks.map((node) => [node.id, node]))
  const directChildrenByParent = new Map<string, string[]>()
  const nextSiblingByPrior = new Map<string, Set<string>>()

  for (const node of tasks) {
    if (node.parentID && !node.priorID) {
      const children = directChildrenByParent.get(node.parentID) ?? []
      children.push(node.id)
      directChildrenByParent.set(node.parentID, children)
    }
    if (node.priorID) {
      const siblings = nextSiblingByPrior.get(node.priorID) ?? new Set<string>()
      siblings.add(node.id)
      nextSiblingByPrior.set(node.priorID, siblings)
    }
  }

  const getTask = (taskId: string) => Promise.resolve(tasksById.get(taskId) ?? null)
  const findSiblingLeafTasks = (taskId: string) =>
    findContinuationLeafTaskIds(taskId, getTask, (id) =>
      Promise.resolve(nextSiblingByPrior.get(id) ?? new Set()),
    )

  return {
    getTask,
    getFlattenedChain: () => {
      throw new Error('Flattened task-chain selection is not used by these tests.')
    },
    searchAllDirectChildren: (taskId: string) =>
      Promise.resolve(new Set(directChildrenByParent.get(taskId) ?? [])),
    findSiblingLeafTasks,
  }
}

export const testChatCompletionContextUsesLineageAndTerminalSubtaskResults = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Collect battery spec sheets.' },
    }),
    task({
      id: 'planner-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'webResearchPlanner', arguments: {} } },
    }),
    task({
      id: 'branch-a-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 3,
      content: { type: 'message', data: 'Noisy branch A prompt.' },
    }),
    task({
      id: 'branch-a-internal-tool',
      role: 'function',
      parentID: 'planner-call',
      priorID: 'branch-a-start',
      created_at: 4,
      content: { type: 'functioncall', data: { name: 'downloadFile', arguments: {} } },
    }),
    task({
      id: 'nested-noise-start',
      role: 'user',
      parentID: 'branch-a-internal-tool',
      created_at: 5,
      content: { type: 'message', data: 'Nested branch internals must stay hidden.' },
    }),
    task({
      id: 'nested-noise-result',
      role: 'assistant',
      parentID: 'branch-a-internal-tool',
      priorID: 'nested-noise-start',
      created_at: 6,
      content: { type: 'message', data: 'Nested result should not be pulled into parent chat.' },
    }),
    task({
      id: 'branch-a-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-a-internal-tool',
      created_at: 7,
      content: { type: 'message', data: 'Branch A final summary.' },
    }),
    task({
      id: 'branch-a-return',
      role: 'system',
      parentID: 'planner-call',
      priorID: 'branch-a-result',
      created_at: 8,
      content: { type: 'return', data: 'done' },
    }),
    task({
      id: 'branch-b-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 9,
      content: { type: 'message', data: 'Noisy branch B prompt.' },
    }),
    task({
      id: 'branch-b-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-b-start',
      created_at: 10,
      content: { type: 'structured', data: { result: 'Branch B final summary.' } },
    }),
    task({
      id: 'branch-c-entry',
      role: 'function',
      parentID: 'planner-call',
      created_at: 11,
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    }),
    task({
      id: 'branch-c-completion',
      role: 'function',
      parentID: 'branch-c-entry',
      created_at: 12,
      content: { type: 'functioncall', data: { name: 'chatCompletion', arguments: {} } },
    }),
    task({
      id: 'branch-c-message',
      role: 'assistant',
      parentID: 'branch-c-completion',
      created_at: 13,
      content: { type: 'message', data: 'Branch C visible summary.' },
    }),
    task({
      id: 'branch-c-structured-result',
      role: 'assistant',
      parentID: 'branch-c-completion',
      priorID: 'branch-c-message',
      created_at: 14,
      content: { type: 'structured', data: { result: 'Branch C contracted handoff.' } },
    }),
    task({
      id: 'continue-user',
      role: 'user',
      priorID: 'planner-call',
      created_at: 15,
      content: { type: 'message', data: 'Continue from the research results.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'continue-user',
    1e9,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) ===
      JSON.stringify([
        'root-user',
        'planner-call',
        'branch-a-start',
        'branch-a-result',
        'branch-b-start',
        'branch-b-result',
        'branch-c-structured-result',
        'continue-user',
      ]),
    `Expected lineage plus terminal direct subtask results, got ${JSON.stringify(selectedIds)}`,
  )

  assert(
    selectedIds.includes('branch-a-start') && !selectedIds.includes('branch-a-internal-tool'),
    'Expected the delegated objective but not intermediate branch internals',
  )
  assert(
    !selectedIds.includes('nested-noise-result'),
    'Expected nested subtask output to stay hidden from the parent chat context',
  )
  assert(
    !selectedIds.includes('branch-c-entry') &&
      !selectedIds.includes('branch-c-completion') &&
      !selectedIds.includes('branch-c-message'),
    'Expected only the terminal visible result from a nested task chain',
  )

  const selectedTasks = selectedIds.flatMap((id) => {
    const selected = tasks.find((candidate) => candidate.id === id)
    return selected ? [selected] : []
  })
  const messages = await convertTaskNodesToOpenAIChat(
    selectedTasks,
    undefined,
    false,
    true,
    {},
    {
      subtaskHandoffTaskIds: new Set([
        'branch-a-start',
        'branch-a-result',
        'branch-b-start',
        'branch-b-result',
        'branch-c-structured-result',
      ]),
    },
  )
  const rendered = JSON.stringify(messages)
  assert(
    rendered.includes('Subtask handoff') &&
      rendered.includes('Objective: Noisy branch A prompt.') &&
      rendered.includes('Status: completed') &&
      rendered.includes('Branch A final summary.'),
    'Expected delegated objectives and terminal results to render as completed handoffs',
  )

  return { success: true }
}

export const testChatCompletionContextLabelsEmptyToolSearchAsNoMatch = async () => {
  const tasks = [
    task({
      id: 'empty-search-call',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'entryNodeToolSearch', arguments: {} } },
    }),
    task({
      id: 'empty-search-result',
      role: 'system',
      parentID: 'empty-search-call',
      content: {
        type: 'toolresult',
        data: {
          'Here are the matching tools': [],
          'Search status':
            'No registered tool matched this query; no requested operation was executed.',
        },
      },
    }),
  ]
  const messages = await convertTaskNodesToOpenAIChat(
    tasks,
    undefined,
    false,
    true,
    {},
    { subtaskHandoffTaskIds: new Set(tasks.map(({ id }) => id)) },
  )
  const searchHandoff = messages.find(
    (message) => typeof message.content === 'string' && message.content.includes('Search status'),
  )
  const rendered = searchHandoff?.content
  assert(
    typeof rendered === 'string' && rendered.includes('Status: no matching capability'),
    'Expected an empty tool search handoff to be labeled as unavailable',
  )
  assert(
    typeof rendered === 'string' && !rendered.includes('Status: completed'),
    'Expected an empty tool search handoff not to be labeled as completed',
  )
  return { success: true }
}

testChatCompletionContextLabelsEmptyToolSearchAsNoMatch.description =
  'Labels an empty tool-search handoff as unavailable instead of completed.'

export const testChatCompletionContextSizeTrimsAfterLineageSelection = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Root.' },
    }),
    task({
      id: 'tool-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: {} } },
    }),
    task({
      id: 'child-start',
      role: 'user',
      parentID: 'tool-call',
      created_at: 3,
      content: { type: 'message', data: 'Child.' },
    }),
    task({
      id: 'child-result',
      role: 'assistant',
      parentID: 'tool-call',
      priorID: 'child-start',
      created_at: 4,
      content: { type: 'message', data: 'Child result.' },
    }),
    task({
      id: 'next-user',
      role: 'user',
      priorID: 'tool-call',
      created_at: 5,
      content: { type: 'message', data: 'Next.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'next-user',
    2,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) === JSON.stringify(['child-result', 'next-user']),
    `Expected maxFollow to trim after terminal child results are inserted, got ${JSON.stringify(
      selectedIds,
    )}`,
  )

  return { success: true }
}

export const testOrphanedToolResultRendersAsSystemContext = async () => {
  const toolResult = task({
    id: 'terminal-tool-result',
    role: 'system',
    parentID: 'hidden-tool-call',
    created_at: 3,
    content: { type: 'toolresult', data: { summary: 'Terminal branch result.' } },
  })
  const tools: Record<string, ToolBase> = {}

  const messages = await convertTaskNodesToOpenAIChat(
    [toolResult],
    () => Promise.resolve(undefined),
    false,
    true,
    tools,
  )

  assert(messages.length === 1, `Expected one rendered message, got ${messages.length}`)
  assert(
    messages[0]?.role === 'system',
    'Expected orphaned tool result to render as system context',
  )

  return { success: true }
}

export const testHiddenToolCallResultRendersAsSystemContext = async () => {
  const hiddenToolCall = task({
    id: 'hidden-docs-provider-call',
    role: 'function',
    created_at: 2,
    content: {
      type: 'functioncall',
      data: { name: 'getTaskyonDocumentationDocuments', arguments: {} },
    },
  })
  const toolResult = task({
    id: 'hidden-docs-provider-result',
    role: 'system',
    parentID: hiddenToolCall.id,
    created_at: 3,
    content: { type: 'toolresult', data: { documents: [{ id: 'taskyon.md' }] } },
  })
  const tools: Record<string, ToolBase> = {
    getTaskyonDocumentationDocuments: {
      name: 'getTaskyonDocumentationDocuments',
      description: 'Hidden docs provider',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      renderOptions: { hideLlm: true },
    },
  }

  const messages = await convertTaskNodesToOpenAIChat(
    [hiddenToolCall, toolResult],
    () => Promise.resolve(undefined),
    false,
    true,
    tools,
  )

  assert(messages.length === 1, `Expected one rendered message, got ${messages.length}`)
  assert(messages[0]?.role === 'system', 'Expected hidden tool result to render as system context')

  return { success: true }
}

export const testSerializeObjectTruncationNoticeIsOptIn = () => {
  const value = { a: 1, b: 2, c: 3 }

  const defaultSerialized = serializeObject(value, {
    format: 'yaml',
    maxObjectKeys: 1,
  })
  const noticeSerialized = serializeObject(value, {
    format: 'yaml',
    maxObjectKeys: 1,
    includeTruncationNotice: true,
  })

  assert(
    !defaultSerialized.startsWith('Note: this serialized value was truncated'),
    'Expected truncation notice to be opt-in',
  )
  assert(
    noticeSerialized.startsWith('Note: this serialized value was truncated'),
    'Expected opt-in truncation notice when object keys are omitted',
  )

  return { success: true }
}

export const testToolResultRenderingUsesBoundedSerializationForLlm = async () => {
  const toolResult = task({
    id: 'large-tool-result',
    role: 'system',
    created_at: 4,
    content: {
      type: 'toolresult',
      data: {
        rows: Array.from({ length: 65 }, (_, index) => ({
          index,
          value: `row-${index}`,
        })),
      },
    },
  })

  const messages = await convertTaskNodesToOpenAIChat(
    [toolResult],
    () => Promise.resolve(undefined),
    false,
    false,
    {},
  )

  const content = messages[0]?.content
  assert(typeof content === 'string', 'Expected tool result to render as text context')
  assert(
    content.includes('Note: this serialized value was truncated'),
    'Expected LLM-facing tool result to state when data was truncated',
  )
  assert(content.includes('__omittedItems: 5'), 'Expected omitted array item count in tool result')

  return { success: true }
}

export const testChooseToolPlainTextResponseDoesNotThrow = () => {
  const response = 'I cannot provide the current time.'
  const commands = getCommandFromStructuredResponse(response)

  assert(Array.isArray(commands), 'Expected command parser to return an array')
  assert(commands.length === 0, 'Expected plain text chooser response to produce no commands')

  return {
    response,
    commands,
  }
}

export const testChatCompletionContextVariableNamesAreInvocationScoped = async () => {
  const contextTask = task({
    id: 'context-message',
    role: 'user',
    created_at: 1,
    content: { type: 'message', data: 'Stable context.' },
  })
  const prepare = () =>
    prepareChatCompletionContext({
      taskChain: [contextTask],
      allowedTools: [],
      toolDefinitions: {},
      appendSystemPrompts: [],
      prependSystemPrompts: [],
      useVisionModels: false,
      getTaskById: () => Promise.resolve(null),
    })

  const first = await prepare()
  const second = await prepare()

  assert(
    JSON.stringify(first.messages) === JSON.stringify(second.messages),
    'Expected independent chat invocations to render identical context messages',
  )
  assert(
    first.variableService !== second.variableService,
    'Expected each chat invocation to own its variable-presentation state',
  )

  return { success: true }
}

export const testChatCompletionMixedTextAndNativeToolCallContinuesWithTool = () => {
  const toolDefinition: ToolBase = {
    name: 'clock',
    description: 'Read the clock.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  }
  const outcome = interpretAssistantMessage(
    [],
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will check.' },
        {
          type: 'tool-call',
          toolCallId: 'clock-call',
          toolName: 'clock',
          input: {},
        },
      ],
    },
    true,
    { clock: toolDefinition },
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'tool-calls', 'Expected native tool call to control continuation')
  assert(outcome.calls.length === 1, 'Expected one interpreted tool call')
  assert(outcome.calls[0]?.name === 'clock', 'Expected the clock tool call')
  assert(
    outcome.assistantMessages?.[0]?.content === 'I will check.',
    'Expected visible assistant commentary to be preserved with the tool call',
  )

  return { success: true }
}

export const testChatCompletionPreservesSearchSourcesWithNativeToolCall = () => {
  const source = {
    type: 'url' as const,
    title: 'HTTP Status Code Registry',
    url: 'https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml',
  }
  const toolDefinition: ToolBase = {
    name: 'executeJavaScript',
    description: 'Execute JavaScript.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    },
  }
  const outcome = interpretAssistantMessage(
    [source],
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'javascript-call',
          toolName: 'executeJavaScript',
          input: { code: "return '2025-09-15'.split('').reverse().join('')" },
        },
      ],
    },
    true,
    { executeJavaScript: toolDefinition },
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'tool-calls', 'Expected native tool call to control continuation')
  assert(
    outcome.assistantMessages?.[0]?.annotations?.some(
      (annotation) => annotation.type === 'url' && annotation.url === source.url,
    ) === true,
    'Expected hosted-search sources to survive a response containing only a tool call',
  )
  assert(
    outcome.assistantMessages?.[0]?.content === '',
    'Expected source annotations to stand on their own without synthetic assistant text',
  )

  return { success: true }
}

export const testChatCompletionPreservesSourcesWithoutTextOrToolCalls = () => {
  const source = {
    type: 'url' as const,
    title: 'HTTP Status Code Registry',
    url: 'https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml',
  }
  const outcome = interpretAssistantMessage(
    [source],
    { role: 'assistant', content: [] },
    true,
    {},
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'answers', 'Expected sources-only output to finish as an answer')
  assert(outcome.answers[0]?.content === '', 'Expected an empty source-bearing assistant message')
  assert(
    outcome.answers[0]?.annotations?.[0] === source,
    'Expected sources-only output to retain its annotations',
  )

  return { success: true }
}

export const testChatCompletionConvertsDocumentSourcesWithoutDroppingDetails = () => {
  const annotation = Annotation.parse(
    convertProviderSourceToAnnotation({
      type: 'source',
      sourceType: 'document',
      id: 'document-1',
      title: 'HTTP Specification',
      filename: 'http.pdf',
      mediaType: 'application/pdf',
    }),
  )

  assert(annotation.type === 'document', 'Expected a document annotation')
  assert(annotation.title === 'HTTP Specification', 'Expected the document title to be retained')
  assert(annotation.filename === 'http.pdf', 'Expected the filename to be retained')
  assert(annotation.mediaType === 'application/pdf', 'Expected the media type to be retained')
  assert(annotation.id === 'document-1', 'Expected the provider source ID to be retained')

  return { success: true }
}

export const testChatCompletionPreservesSourceLessSearchWithNativeToolCall = () => {
  const outcome = interpretAssistantMessage(
    [],
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'javascript-call',
          toolName: 'executeJavaScript',
          input: { code: "return '2025-09-15'.split('').reverse().join('')" },
        },
      ],
    },
    true,
    {
      executeJavaScript: {
        name: 'executeJavaScript',
        description: 'Execute JavaScript.',
        parameters: { type: 'object', properties: {} },
      },
    },
    createTaskVariablePresentationService(),
    true,
  )

  assert(outcome.kind === 'tool-calls', 'Expected native tool call to control continuation')
  assert(
    outcome.assistantMessages?.[0]?.content === 'Hosted web search activity was reported.',
    'Expected source-less provider search to remain visible to the continuation',
  )

  return { success: true }
}

export const testChatCompletionRendersAssistantSourcesInFollowingContext = async () => {
  const sourceUrl = 'https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml'
  const messages = await convertTaskNodesToOpenAIChat(
    [
      task({
        id: 'searched-answer',
        role: 'assistant',
        created_at: 1,
        content: {
          type: 'message',
          data: 'Hosted web search completed.',
          ann: [
            {
              type: 'url',
              title: 'HTTP Status Code Registry',
              url: sourceUrl,
              content: 'The registry was updated on 2025-09-15.',
            },
            {
              type: 'document',
              id: 'document-1',
              title: 'HTTP Specification',
              filename: 'http.pdf',
              mediaType: 'application/pdf',
              content: 'The specification defines HTTP semantics.',
            },
          ],
        },
      }),
    ],
    undefined,
    false,
    true,
    {},
  )

  assert(messages[0]?.role === 'assistant', 'Expected assistant search context')
  assert(
    typeof messages[0]?.content === 'string' && messages[0].content.includes(sourceUrl),
    'Expected the following completion to see the hosted-search source URL',
  )
  assert(
    typeof messages[0]?.content === 'string' &&
      messages[0].content.includes('The registry was updated on 2025-09-15.'),
    'Expected the following completion to see the URL source excerpt',
  )
  assert(
    typeof messages[0]?.content === 'string' &&
      messages[0].content.includes('HTTP Specification') &&
      messages[0].content.includes('http.pdf') &&
      messages[0].content.includes('application/pdf') &&
      messages[0].content.includes('The specification defines HTTP semantics.'),
    'Expected the following completion to see document source details',
  )

  return { success: true }
}

export const testChatCompletionRejectsToolArgumentsOutsideDeclaredSchema = () => {
  let validationError:
    | (Error & {
        toolName?: unknown
        validationErrors?: unknown
        receivedArguments?: unknown
      })
    | undefined

  try {
    interpretAssistantMessage(
      [],
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'malformed-planner-call',
            toolName: 'taskPlanner',
            input: {
              tasks: [['List available tools', 'Get the weather'], 'parallel=false] }'],
            },
          },
        ],
      },
      true,
      { taskPlanner },
      createTaskVariablePresentationService(),
    )
  } catch (error) {
    if (error instanceof Error) validationError = error
  }

  assert(
    validationError?.name === 'ToolArgumentsValidationError' &&
      validationError.toolName === 'taskPlanner',
    'Expected malformed planner arguments to produce a structured validation error',
  )
  assert(
    Array.isArray(validationError?.validationErrors) &&
      validationError.validationErrors.some(
        (error) =>
          typeof error === 'object' &&
          error !== null &&
          'instancePath' in error &&
          error.instancePath === '/tasks/1',
      ),
    'Expected structured validation details to retain the invalid task path',
  )
  assert(
    typeof validationError?.receivedArguments === 'object' &&
      validationError.receivedArguments !== null &&
      'tasks' in validationError.receivedArguments &&
      Array.isArray(validationError.receivedArguments.tasks) &&
      validationError.receivedArguments.tasks[1] === 'parallel=false] }',
    'Expected structured validation details to retain the received arguments',
  )

  return { success: true }
}

export const testChatCompletionIgnoresBlankProviderArgumentKeys = () => {
  const outcome = interpretAssistantMessage(
    [],
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'blank-argument-key',
          toolName: 'clock',
          input: { value: 'ok', '': 'provider artifact' },
        },
      ],
    },
    true,
    {
      clock: {
        name: 'clock',
        description: 'Read the clock.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'tool-calls', 'Expected the valid tool call to continue')
  assert(outcome.calls.length === 1, 'Expected one normalized tool call')
  assert(
    JSON.stringify(outcome.calls[0]?.arguments) === JSON.stringify({ value: 'ok' }),
    'Expected blank provider argument keys to be removed before schema validation',
  )

  return { success: true }
}

export const testChatCompletionAcceptsDeclaredTaskyonUseMapping = () => {
  const outcome = interpretAssistantMessage(
    [],
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'taskyon-use-call',
          toolName: 'clock',
          input: { $use: {} },
        },
      ],
    },
    true,
    {
      clock: {
        name: 'clock',
        description: 'Read the clock.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'tool-calls', 'Expected the declared Taskyon $use mapping to be valid')
  assert(outcome.calls[0]?.name === 'clock', 'Expected the clock tool call')

  return { success: true }
}

export const testChatCompletionOpenAIWebSearchIsAvailableWithoutBeingForced = async () => {
  const request = await buildChatProviderRequest({
    messages: [{ role: 'user', content: 'Find current information.' }],
    tools: {
      python: {
        description: 'Run Python code.',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
      },
    },
    selectedModel: 'gpt-5.6-luna',
    api: {
      provider: 'openai',
      name: 'openai',
      model: 'gpt-5.6-luna',
      baseURL: 'https://example.test/v1',
      streamSupport: true,
      networkTransport: 'auto',
      routes: { chatCompletion: '/responses', models: '/models' },
    },
    apiKey: 'diagnostic-key',
    webSearch: { maxResults: 5, searchContextSize: 'medium' },
  })

  assert(
    request.tools?.python !== undefined,
    'Expected the ordinary Python tool to remain available',
  )
  assert(request.tools?.web_search !== undefined, 'Expected OpenAI web search to be available')
  assert(request.toolChoice === undefined, 'Expected automatic tool choice for optional web search')
  return { success: true }
}

export const testChatCompletionOpenAIWebSearchCanBeRequired = async () => {
  const request = await buildChatProviderRequest({
    messages: [{ role: 'user', content: 'Search this now.' }],
    tools: {},
    selectedModel: 'gpt-5.6-luna',
    api: {
      provider: 'openai',
      name: 'openai',
      model: 'gpt-5.6-luna',
      baseURL: 'https://example.test/v1',
      streamSupport: true,
      networkTransport: 'auto',
      routes: { chatCompletion: '/responses', models: '/models' },
    },
    apiKey: 'diagnostic-key',
    webSearch: { maxResults: 5, searchContextSize: 'medium', mode: 'required' },
  })

  const toolChoice = request.toolChoice
  assert(
    typeof toolChoice === 'object' &&
      toolChoice.type === 'tool' &&
      toolChoice.toolName === 'web_search',
    'Expected required OpenAI web search to select the provider tool',
  )
  return { success: true }
}

export const testChatCompletionOpenRouterWebSearchIsAProviderTool = async () => {
  const request = await buildChatProviderRequest({
    messages: [{ role: 'user', content: 'Find current information.' }],
    tools: {
      python: {
        description: 'Run Python code.',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
      },
    },
    selectedModel: 'openai/gpt-5.6',
    api: {
      provider: 'openrouter.ai',
      name: 'openrouter.ai',
      model: 'openai/gpt-5.6',
      baseURL: 'https://example.test',
      streamSupport: true,
      networkTransport: 'auto',
      routes: { chatCompletion: '/chat/completions', models: '/models' },
    },
    apiKey: 'diagnostic-key',
    webSearch: { maxResults: 5, searchContextSize: 'medium' },
  })

  assert(
    request.tools?.python !== undefined,
    'Expected the ordinary Python tool to remain available',
  )
  const webSearchTool = request.tools?.web_search
  assert(
    webSearchTool?.type === 'provider',
    'Expected OpenRouter web search to be provider-defined',
  )
  assert(webSearchTool.id === 'openrouter.web_search', 'Expected the OpenRouter web search tool id')
  assert(request.toolChoice === undefined, 'Expected automatic tool choice for OpenRouter search')
  return { success: true }
}

export const testChatCompletionOpenRouterDisablesParallelToolCalls = async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (_input, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.')
    requestBody = JSON.parse(init.body) as Record<string, unknown>
    return Promise.resolve(
      new Response(
        'data: {"id":"test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )
  }

  try {
    const request = await buildChatProviderRequest({
      messages: [{ role: 'user', content: 'Use the available tool once.' }],
      tools: {
        clock: {
          description: 'Read the clock.',
          inputSchema: jsonSchema({ type: 'object', properties: {} }),
        },
      },
      selectedModel: 'openai/gpt-5-nano',
      api: {
        provider: 'taskyon',
        name: 'taskyon',
        model: 'openai/gpt-5-nano',
        baseURL: 'https://provider.example',
        streamSupport: true,
        routes: { chatCompletion: '/v1/', models: '/v1/models' },
      },
      apiKey: 'diagnostic-key',
    })
    await streamText(request).text
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(
    requestBody?.parallel_tool_calls === false,
    'Expected the Taskyon OpenRouter adapter to disable parallel tool calls',
  )
  return { success: true }
}

export const testChatCompletionCodexRequestMovesLeadingSystemPromptToInstructions = async () => {
  const request = await buildChatProviderRequest({
    messages: [
      { role: 'system', content: 'Follow the system instructions.' },
      { role: 'user', content: 'Hello.' },
    ],
    tools: {},
    selectedModel: 'gpt-5.6-luna',
    api: {
      provider: 'chatgpt-codex',
      name: 'chatgpt-codex',
      model: 'gpt-5.6-luna',
      baseURL: 'https://example.test/v1',
      streamSupport: true,
      networkTransport: 'auto',
      routes: {
        chatCompletion: '/responses',
        models: '/models',
      },
    },
    apiKey: 'diagnostic-key',
    promptCacheRootId: 'root-task',
  })

  assert(request.messages?.length === 1, 'Expected leading system prompt outside request messages')
  assert(request.messages?.[0]?.role === 'user', 'Expected user message to remain')
  assert(
    request.providerOptions?.openai?.instructions === 'Follow the system instructions.',
    'Expected Codex provider instructions to contain the leading system prompt',
  )
  assert(
    request.providerOptions?.openai?.promptCacheKey ===
      'taskyon-chatgpt-codex-gpt-5.6-luna-root-task',
    'Expected the cache namespace to follow the provider, model, and task-tree root',
  )
  const promptCacheOptions = request.providerOptions?.openai?.promptCacheOptions
  assert(
    promptCacheOptions === undefined,
    'Expected the ChatGPT Codex backend not to receive unsupported explicit cache options',
  )
  return { success: true }
}

export const testChatCompletionCodexUsesInjectedProviderFetch = async () => {
  const originalFetch = globalThis.fetch
  let injectedCalls = 0
  globalThis.fetch = () =>
    Promise.reject(new Error('The Codex request unexpectedly used the global fetch.'))
  const providerFetch: typeof fetch = async (_input, _init) => {
    injectedCalls += 1
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  try {
    const request = await buildChatProviderRequest({
      messages: [{ role: 'user', content: 'Hello.' }],
      tools: {},
      selectedModel: 'gpt-5.6-luna',
      api: {
        provider: 'chatgpt-codex',
        name: 'chatgpt-codex',
        model: 'gpt-5.6-luna',
        baseURL: 'https://example.test/v1',
        streamSupport: true,
        networkTransport: 'auto',
        routes: { chatCompletion: '/responses', models: '/models' },
      },
      apiKey: 'diagnostic-key',
      fetch: providerFetch,
    })
    await streamText(request).text
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(injectedCalls === 1, 'Expected Codex to use the injected provider fetch exactly once')
  return { success: true }
}

testChatCompletionCodexUsesInjectedProviderFetch.description =
  'Uses the host-provided fetch transport for Codex requests.'

export const testChatCompletionEveryProviderUsesInjectedHostFetch = async () => {
  const originalFetch = globalThis.fetch
  let directCalls = 0
  let injectedCalls = 0
  const response = () =>
    new Response(
      'data: {"id":"test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  globalThis.fetch = () => {
    directCalls += 1
    return Promise.resolve(response())
  }
  const providerFetch: typeof fetch = () => {
    injectedCalls += 1
    return Promise.resolve(response())
  }

  try {
    for (const api of [
      providerSettings('openai', 'https://api.openai.example'),
      providerSettings('openrouter.ai', 'https://openrouter.example'),
      providerSettings('custom-remote', 'https://compatible.example'),
      providerSettings('local', 'http://localhost:8080'),
    ]) {
      const request = await buildChatProviderRequest({
        messages: [{ role: 'user', content: 'Hello.' }],
        tools: {},
        selectedModel: 'test-model',
        api,
        apiKey: 'diagnostic-key',
        fetch: providerFetch,
      })
      await streamText(request).text
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(injectedCalls === 4, 'Every provider must use the injected host fetch')
  assert(directCalls === 0, 'Provider code must not bypass the host fetch')
  return { success: true }
}

testChatCompletionEveryProviderUsesInjectedHostFetch.description =
  'Routes every AI adapter, including local providers, through the host transport.'

export const testCodexModelDiscoveryUsesInjectedProviderFetch = async () => {
  const originalFetch = globalThis.fetch
  let injectedCalls = 0
  let requestedUrl = ''
  let requestedHeaders: HeadersInit | undefined
  globalThis.fetch = () =>
    Promise.reject(new Error('The Codex model request unexpectedly used the global fetch.'))
  const providerFetch: typeof fetch = async (input, init) => {
    injectedCalls += 1
    requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requestedHeaders = init?.headers
    return new Response(
      JSON.stringify({
        models: [
          { slug: 'synthetic-codex-model', input_modalities: ['text', 'image'] },
          { slug: 'synthetic-codex-mini' },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  try {
    const models = await fetchModelsForProvider(
      {
        provider: 'chatgpt-codex',
        name: 'chatgpt-codex',
        model: 'synthetic-codex-model',
        baseURL: 'https://example.test/v1',
        streamSupport: true,
        networkTransport: 'auto',
        routes: { chatCompletion: '/responses', models: '/models' },
      },
      async () => 'diagnostic-key',
      { fetch: providerFetch },
    )
    assert(models['synthetic-codex-model'] !== undefined, 'Expected the injected model response')
    assert(models['synthetic-codex-mini'] !== undefined, 'Expected every Codex model response')
    assert(
      models['synthetic-codex-model']?.owned_by === 'openai',
      'Expected Codex model metadata to be normalized',
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(injectedCalls === 1, 'Expected model discovery to use the injected fetch exactly once')
  assert(
    requestedUrl === `https://example.test/v1/models?client_version=${CODEX_MODELS_CLIENT_VERSION}`,
    'Expected model discovery to preserve the provider base path',
  )
  const headers = new Headers(requestedHeaders)
  assert(
    headers.get('Cache-Control') === 'no-cache',
    'Expected Codex model discovery to revalidate',
  )
  return { success: true }
}

testCodexModelDiscoveryUsesInjectedProviderFetch.description =
  'Uses the host-provided fetch transport for Codex model discovery.'

export const testChatCompletionCacheKeyAndBreakpointsFollowTaskTree = async () => {
  const build = (root: string, finalPrompt: string) =>
    buildChatProviderRequest({
      messages: [
        { role: 'system' as const, content: 'Stable project instructions.' },
        { role: 'user' as const, content: 'Root objective.' },
        { role: 'assistant' as const, content: 'First result.' },
        { role: 'user' as const, content: 'Branch objective.' },
        { role: 'assistant' as const, content: 'Branch result.' },
        { role: 'user' as const, content: finalPrompt },
      ],
      tools: {},
      selectedModel: 'gpt-5.6-luna',
      api: {
        provider: 'openai' as const,
        name: 'openai',
        model: 'gpt-5.6-luna',
        baseURL: 'https://example.test/v1',
        streamSupport: true,
        networkTransport: 'auto',
        routes: { chatCompletion: '/responses', models: '/models' },
      },
      apiKey: 'diagnostic-key',
      promptCacheRootId: root,
    })

  const first = await build('root-task', 'First branch continuation.')
  const sibling = await build('root-task', 'Sibling branch continuation.')
  const otherTree = await build('other-root', 'First branch continuation.')

  assert(
    first.providerOptions?.openai?.promptCacheKey ===
      sibling.providerOptions?.openai?.promptCacheKey,
    'Expected sibling branches to share the task-tree cache namespace',
  )
  assert(
    first.providerOptions?.openai?.promptCacheKey !==
      otherTree.providerOptions?.openai?.promptCacheKey,
    'Expected independent task trees to use independent cache namespaces',
  )
  const breakpoints = (first.messages ?? []).filter(
    (message) => message.providerOptions?.openai?.promptCacheBreakpoint === true,
  )
  assert(breakpoints.length === 4, 'Expected the root and three recent lineage breakpoints')
  assert(
    breakpoints[0]?.role === 'user' && breakpoints[0]?.content === 'Root objective.',
    'Expected the first user boundary to anchor the shared root prefix',
  )
  assert(
    breakpoints.at(-1)?.content === 'First branch continuation.',
    'Expected the newest lineage boundary to receive the final breakpoint',
  )

  return { success: true }
}

export const testChatCompletionCacheKeyFitsOpenAiProviderLimit = async () => {
  const request = await buildChatProviderRequest({
    messages: [{ role: 'user', content: 'Hello.' }],
    tools: {},
    selectedModel: 'gpt-5.1',
    api: {
      provider: 'openai',
      name: 'openai',
      model: 'gpt-5.1',
      baseURL: 'https://example.test/v1',
      streamSupport: true,
      networkTransport: 'auto',
      routes: { chatCompletion: '/responses', models: '/models' },
    },
    apiKey: 'diagnostic-key',
    promptCacheRootId: 'root-task-with-a-long-identifier-that-exceeds-provider-limits',
  })
  const cacheKey = request.providerOptions?.openai?.promptCacheKey
  assert(
    typeof cacheKey === 'string' && cacheKey.length <= 64,
    'Expected a provider-safe cache key',
  )
  return { success: true }
}

export const testTaskyonCostLookupOnlyForwardsAttributionHeaders = async () => {
  const originalFetch = globalThis.fetch
  let requestHeaders: Headers | undefined
  globalThis.fetch = (_input, init) => {
    requestHeaders = new Headers(init?.headers)
    return Promise.resolve(
      new Response(JSON.stringify([{ used_credits: 0.25 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  try {
    const cost = await getTaskyonCosts(
      {
        'HTTP-Referer': 'https://taskyon.space',
        'X-Title': 'Taskyon',
        'X-Unrelated': 'must-not-leak',
      },
      'anonymous-key',
      'user-token',
      undefined,
      '',
      'task-id',
    )
    assert(cost === 0.25, 'Expected the mocked Taskyon cost result')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(requestHeaders?.get('HTTP-Referer') === 'https://taskyon.space', 'Expected referer')
  assert(requestHeaders?.get('X-Title') === 'Taskyon', 'Expected application title')
  assert(!requestHeaders?.has('X-Unrelated'), 'Expected unrelated provider headers to stay private')

  return { success: true }
}

testTaskyonCostLookupOnlyForwardsAttributionHeaders.description =
  'Forwards only allowlisted provider attribution headers to the Taskyon cost endpoint.'

export const testProviderRequestsApplyProfileHeaders = async () => {
  const originalFetch = globalThis.fetch
  const requests: Headers[] = []
  globalThis.fetch = (_input, init) => {
    requests.push(new Headers(init?.headers))
    return Promise.resolve(
      new Response(
        'data: {"id":"test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )
  }

  try {
    for (const provider of ['openrouter.ai', 'taskyon', 'local'] as const) {
      const request = await buildChatProviderRequest({
        messages: [{ role: 'user', content: 'Hello.' }],
        tools: {},
        selectedModel: 'test-model',
        api: {
          provider,
          name: provider,
          model: 'test-model',
          baseURL: 'https://provider.example',
          streamSupport: true,
          networkTransport: 'auto',
          defaultHeaders: { 'X-Profile-Header': provider },
          routes: {
            chatCompletion: '/v1/',
            models: '/v1/models',
          },
        },
        apiKey: 'diagnostic-key',
      })
      await streamText(request).text
    }

    const requestWithoutHeaders = await buildChatProviderRequest({
      messages: [{ role: 'user', content: 'Hello.' }],
      tools: {},
      selectedModel: 'test-model',
      api: {
        provider: 'local',
        name: 'local',
        model: 'test-model',
        baseURL: 'https://provider.example',
        streamSupport: true,
        networkTransport: 'auto',
        routes: {
          chatCompletion: '/v1/',
          models: '/v1/models',
        },
      },
      apiKey: 'diagnostic-key',
    })
    await streamText(requestWithoutHeaders).text
  } finally {
    globalThis.fetch = originalFetch
  }

  assert(
    requests[0]?.get('X-Profile-Header') === 'openrouter.ai',
    'Expected OpenRouter to send profile headers',
  )
  assert(
    !requests[1]?.has('X-Profile-Header'),
    'Expected the Taskyon proxy request to omit provider profile headers',
  )
  assert(
    requests[2]?.get('X-Profile-Header') === 'local',
    'Expected the generic compatible adapter to send profile headers',
  )
  assert(
    !requests[3]?.has('X-Profile-Header'),
    'Expected providers without configured headers not to receive attribution',
  )

  return { success: true }
}

testProviderRequestsApplyProfileHeaders.description =
  'Applies immutable profile headers to OpenRouter and generic compatible provider requests.'

export const testTaskContractMessagesRenderOnceWithoutHiddenEntryNodeArguments = async () => {
  const agentInstructions = 'Act as a cybersecurity reviewer.'
  const objective = 'Audit the authentication boundary.'
  const doneWhen = 'Every trust boundary has an evidence note.'
  const tasks = [
    task({
      id: 'contract-system',
      role: 'system',
      content: { type: 'message', data: agentInstructions },
    }),
    task({
      id: 'contract-user',
      role: 'user',
      priorID: 'contract-system',
      content: {
        type: 'message',
        data: `Task objective:\n${objective}\n\nComplete when:\n- ${doneWhen}`,
      },
    }),
    task({
      id: 'contract-entry',
      role: 'function',
      priorID: 'contract-user',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {
            taskContract: {
              objective,
              agentInstructions,
              doneWhen: [doneWhen],
              result: { mode: 'message' },
            },
          },
        },
      },
    }),
  ]
  const messages = await convertTaskNodesToOpenAIChat(
    tasks,
    () => Promise.resolve(undefined),
    false,
    true,
    {
      entryNode: {
        name: 'entryNode',
        description: 'Hidden entry node',
        parameters: { type: 'object', properties: {}, additionalProperties: true },
        renderOptions: { hideLlm: true },
      },
    },
  )
  const rendered = JSON.stringify(messages)

  assert(
    rendered.split(agentInstructions).length - 1 === 1,
    'Expected agent instructions to appear exactly once in the rendered model context',
  )
  assert(
    rendered.split(objective).length - 1 === 1 && rendered.split(doneWhen).length - 1 === 1,
    'Expected objective and completion criteria to appear exactly once in model context',
  )
  assert(
    !rendered.includes('taskContract'),
    'Expected hidden entry-node arguments not to render into model context',
  )

  return { success: true }
}

export const testChatCompletionStreamingFailureClassification = () => {
  const interrupted = classifyStreamingFailure(new Error('request aborted'), false)
  const transient = classifyStreamingFailure(new Error('503 server busy'), false)

  assert(interrupted.shortReason === 'interrupted', 'Expected abort classification')
  assert(
    transient.shortReason === 'transient provider failure',
    'Expected transient provider classification',
  )

  return { success: true }
}

export const testChatCompletionRendersUploadedTextFile = async () => {
  const fileTask = task({
    id: 'uploaded-files',
    role: 'user',
    created_at: 1,
    content: {
      type: 'files',
      data: [
        {
          hash: `sha256:${'a'.repeat(43)}`,
          name: 'notes.txt',
          mediaType: 'text/plain',
          size: 19,
        },
      ],
    },
  })
  const uploadedFile = new File(['hello from the file'], 'notes.txt', {
    type: 'text/plain',
  })
  const messages = await convertTaskNodesToOpenAIChat(
    [fileTask],
    () => Promise.resolve(uploadedFile),
    false,
    false,
    {},
  )

  assert(messages[0]?.role === 'system', 'Expected uploaded-file summary first')
  assert(messages[1]?.role === 'user', 'Expected uploaded file content as user context')
  assert(
    messages[1]?.role === 'user' &&
      Array.isArray(messages[1].content) &&
      messages[1].content.some(
        (content) =>
          content.type === 'file' &&
          typeof content.data === 'string' &&
          content.data.includes('hello from the file'),
      ),
    'Expected uploaded text content in the rendered file part',
  )

  return { success: true }
}

export const testChatCompletionReportsUnavailableLegacyAttachment = async () => {
  const fileTask = task({
    id: 'legacy-uploaded-file',
    role: 'user',
    created_at: 1,
    content: { type: 'files', data: ['legacy-content-id'] },
  })
  let attemptedReference: string | undefined
  const messages = await convertTaskNodesToOpenAIChat(
    [fileTask],
    (attachment) => {
      attemptedReference = typeof attachment === 'string' ? attachment : attachment.hash
      return Promise.resolve(undefined)
    },
    false,
    false,
    {},
  )

  assert(attemptedReference === 'legacy-content-id', 'Expected legacy attachment lookup attempt')
  assert(
    messages[0]?.role === 'system' &&
      messages[0].content.includes('Unknown uploaded file (attachment unavailable)'),
    'Expected missing legacy attachment to remain visible in model context',
  )
}

testChatCompletionReportsUnavailableLegacyAttachment.description =
  'Keeps legacy file tasks in model context and marks attachments whose bytes cannot be loaded.'

export const testChatCompletionAnswerCompilesPresentationVariable = () => {
  const sourceTask = task({
    id: 'answer-source',
    role: 'assistant',
    created_at: 1,
    content: { type: 'message', data: 'Source value.' },
  })
  const tasksById = new Map([[sourceTask.id, sourceTask]])
  const variableService = createTaskVariablePresentationService()
  variableService.getOrAssignVariableName(sourceTask, tasksById)
  const outcome = interpretAssistantMessage(
    [{ type: 'url', title: 'Source', url: 'https://example.test' }],
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Use {{message1}}.' }],
    },
    false,
    {},
    variableService,
  )

  assert(outcome.kind === 'answers', 'Expected an assistant answer outcome')
  assert(
    outcome.answers[0]?.content === 'Use {{_t:answer-source}}.',
    'Expected presentation variable to compile to its durable task reference',
  )
  assert(outcome.answers[0]?.annotations?.length === 1, 'Expected sources on the first answer')

  return { success: true }
}
testChooseToolPlainTextResponseDoesNotThrow.description =
  'Plain text LLM output in ChooseTool/AnalyzeToolResult mode must not crash the structured command parser.'
testChatCompletionContextVariableNamesAreInvocationScoped.description =
  'Independent chatCompletion invocations derive deterministic variable names without sharing mutable presentation state.'
testChatCompletionMixedTextAndNativeToolCallContinuesWithTool.description =
  'A provider response containing both text and a native tool call continues with the tool instead of returning prematurely.'
testChatCompletionPreservesSearchSourcesWithNativeToolCall.description =
  'A provider response containing hosted-search sources and only a native tool call keeps the search observation for the continuation.'
testChatCompletionPreservesSourcesWithoutTextOrToolCalls.description =
  'A provider response containing only sources remains visible as an empty source-bearing assistant answer.'
testChatCompletionConvertsDocumentSourcesWithoutDroppingDetails.description =
  'Provider document sources retain their title, filename, media type, and source identifier.'
testChatCompletionPreservesSourceLessSearchWithNativeToolCall.description =
  'A provider search reported only by stream metadata remains visible before a native tool continuation.'
testChatCompletionRendersAssistantSourcesInFollowingContext.description =
  'Assistant source annotations remain visible to the following model completion.'
testChatCompletionRejectsToolArgumentsOutsideDeclaredSchema.description =
  'Provider-native tool calls are rejected before execution when their arguments violate the declared tool schema.'
testChatCompletionIgnoresBlankProviderArgumentKeys.description =
  'Provider-native tool calls ignore an empty argument key emitted as a malformed provider artifact.'
testChatCompletionAcceptsDeclaredTaskyonUseMapping.description =
  'Provider-native tool calls accept the Taskyon $use extension declared in their LLM-facing schema.'
testChatCompletionOpenAIWebSearchIsAvailableWithoutBeingForced.description =
  'Direct OpenAI requests expose native web search beside ordinary tools without forcing the search tool.'
testChatCompletionOpenAIWebSearchCanBeRequired.description =
  'Direct OpenAI requests can explicitly require the native web-search tool for a search action.'
testChatCompletionOpenRouterWebSearchIsAProviderTool.description =
  'OpenRouter requests expose its model-controlled server web-search tool beside ordinary tools.'
testChatCompletionOpenRouterDisablesParallelToolCalls.description =
  'Taskyon OpenRouter requests serialize at most one tool call per model response.'
testChatCompletionCodexRequestMovesLeadingSystemPromptToInstructions.description =
  'Codex provider requests move the leading system prompt into provider instructions without making a network request.'
testChatCompletionCacheKeyAndBreakpointsFollowTaskTree.description =
  'Keeps one cache namespace per provider/model/task tree and marks root plus recent lineage boundaries.'
testChatCompletionStreamingFailureClassification.description =
  'Chat completion stream failures distinguish interruption and transient provider failures.'
testChatCompletionRendersUploadedTextFile.description =
  'chatCompletion renders an uploaded text file into model-readable context.'
testChatCompletionAnswerCompilesPresentationVariable.description =
  'Assistant answers compile request-scoped presentation variables back to durable task references.'
testNativeStructuredOutputSchemaAddsClosedObjectBoundaries.description =
  'Provider-native structured output closes every compatible object boundary without mutating the task contract.'
testNativeStructuredOutputSchemaRejectsPermissiveOrOptionalObjects.description =
  'Permissive maps and optional object fields fall back to prompt-enforced structured output instead of narrowing their contract.'

export const testChatCompletionWireTraceRecordsRedactedProviderAttempts = async () => {
  const providerRequest: ProviderRequestTrace = {
    provider: 'chatgpt-codex',
    model: 'gpt-5.4',
    taskId: 'chat-task',
    attempts: [],
  }
  let calls = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const body = await request.text()
    assert(
      body.includes('keep this prompt'),
      'Expected the provider fetch to receive the original body',
    )
    calls += 1
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'bad token', api_key: 'secret' } }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-one',
          'set-cookie': 'session=secret',
        },
      })
    }
    if (calls === 2) {
      return new Response('stream remains readable', {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-oai-request-id': 'request-two' },
      })
    }
    throw new Error('Provider rejected Bearer secret with api_key=secret')
  }
  const recordingFetch = createChatCompletionRecordingFetch(providerRequest, fetchImpl)
  const request = {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      'x-api-key': 'secret',
    },
    body: JSON.stringify({
      input: 'keep this prompt',
      api_key: 'secret',
      file_data: 'large file payload',
      image_url: { url: 'data:image/png;base64,secret' },
    }),
  }

  await recordingFetch('https://provider.example/v1/responses', request)
  const secondResponse = await recordingFetch('https://provider.example/v1/responses', request)
  await recordingFetch('https://provider.example/v1/responses', request).catch(() => undefined)

  assert(
    (await secondResponse.text()) === 'stream remains readable',
    'Expected response stream to remain readable',
  )
  assert(providerRequest.attempts.length === 3, 'Expected all provider attempts in one record')
  const firstAttempt = providerRequest.attempts[0]
  const secondAttempt = providerRequest.attempts[1]
  const failedAttempt = providerRequest.attempts[2]
  assert(
    firstAttempt?.url === 'https://provider.example/v1/responses',
    'Expected final provider URL',
  )
  assert(
    firstAttempt?.requestHeaders.authorization === undefined &&
      firstAttempt?.requestHeaders['x-api-key'] === undefined,
    'Expected sensitive request headers to stay out of the trace',
  )
  assert(
    JSON.stringify(firstAttempt?.requestBody).includes('[[redacted]]') &&
      JSON.stringify(firstAttempt?.requestBody).includes('[[omitted]]'),
    'Expected sensitive fields and binary payloads to be redacted',
  )
  assert(
    firstAttempt?.response?.headers['set-cookie'] === undefined &&
      JSON.stringify(firstAttempt?.response?.errorBody).includes('[[redacted]]'),
    'Expected failure headers and body secrets to be redacted',
  )
  assert(
    firstAttempt?.response?.requestId === 'request-one' &&
      secondAttempt?.response?.requestId === 'request-two',
    'Expected provider request IDs to remain available for both attempts',
  )
  assert(
    failedAttempt?.error?.message.includes('secret') === false &&
      failedAttempt?.error?.message.includes('[[redacted]]') === true,
    'Expected transport errors to redact embedded credentials',
  )

  return { success: true }
}

testTaskContractMessagesRenderOnceWithoutHiddenEntryNodeArguments.description =
  'Task-contract role, objective, and completion messages render once while hidden entry-node arguments stay out of model context.'
testChatCompletionWireTraceRecordsRedactedProviderAttempts.description =
  'chatCompletion records exact provider-wire attempts while preserving response streams and redacting credentials and binary payloads.'
testChatCompletionContextUsesLineageAndTerminalSubtaskResults.description =
  'chatCompletion context follows parent/prior lineage and exposes terminal direct subtask results without flattening branch internals.'
testChatCompletionContextSizeTrimsAfterLineageSelection.description =
  'chatCompletion context_size maps to maxFollow and limits the final lineage context after terminal subtask results are selected.'
testOrphanedToolResultRendersAsSystemContext.description =
  'Terminal tool results without their hidden function-call parent render as system context instead of orphaned native tool output.'
testSerializeObjectTruncationNoticeIsOptIn.description =
  'serializeObject keeps existing output stable and only emits a truncation notice when requested.'
testToolResultRenderingUsesBoundedSerializationForLlm.description =
  'LLM-facing tool result rendering uses bounded serialization and explicitly marks truncated data.'
