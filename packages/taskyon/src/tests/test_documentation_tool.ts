import { taskyonDocumentationTool } from '../tools/documentationTool'
import {
  createDocumentationIndexClientTool,
  loadDocumentationDocumentsFromManifest,
} from '../tools/documentationProviderTool'
import { createDocumentationBaseStore } from '@taskyon/common/modules/documentationBases'
import { createDocumentationDocument } from '@taskyon/common/modules/documentation'
import type { DocumentationManifest } from '@taskyon/common/modules/resourceFiles'
import type { TaskNode } from '../types/taskNode'
import { createSubtasksResult } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const createTestContext = (taskChain: TaskNode[] = []) => ({
  getExecutionTaskChain: () => Promise.resolve(taskChain),
  createSubtasksResult,
  getSecret: () => Promise.resolve(null),
  setSecret: () => Promise.resolve(),
  stopSignal: new AbortController().signal,
  toolId: 'documentation-test',
})

const getFunctionCallName = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  if (content.type !== 'functioncall') return undefined
  const data = content.data
  return data && typeof data === 'object' && 'name' in data ? data.name : undefined
}

const getMessageData = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'message' ? content.data : undefined
}

export const testDocumentationIndexRegistersAndSearchesManifestBase = async () => {
  const records = new Map<string, DocumentationManifest>()
  const bases = createDocumentationBaseStore(
    {
      get: (id) => Promise.resolve(records.get(id) ?? null),
      set: (id, manifest) => {
        records.set(id, manifest)
        return Promise.resolve()
      },
      delete: (id) => {
        records.delete(id)
        return Promise.resolve()
      },
      list: () => Promise.resolve(Array.from(records, ([id, data]) => ({ id, data }))),
    },
    () =>
      Promise.resolve([
        createDocumentationDocument({
          path: 'guide.md',
          url: 'https://example.com/guide.md',
          content: '# Guide\n\nTask trees preserve inspectable workflow history.',
        }),
      ]),
  )
  const tool = createDocumentationIndexClientTool(bases)
  const registered = await tool.function?.(
    {
      action: 'register',
      manifest: { internal: [], external: ['https://example.com/guide.md'] },
    },
    createTestContext(),
  )
  const result = await tool.function?.(
    {
      action: 'search',
      baseId: 'guide',
      query: 'task trees',
      mode: 'literal',
      limit: 5,
    },
    createTestContext(),
  )
  assert(
    registered && typeof registered === 'object' && 'url' in registered,
    'Expected registration to return the documentation page URL.',
  )
  assert(
    result && typeof result === 'object' && 'hits' in result && Array.isArray(result.hits),
    'Expected documentation search hits.',
  )
  if (!result || typeof result !== 'object' || !('hits' in result) || !Array.isArray(result.hits)) {
    throw new Error('Expected documentation search hits.')
  }
  const firstHit = result.hits[0]
  assert(
    firstHit && typeof firstHit === 'object' && firstHit.url === '/docs/guide/guide.md',
    'Expected the tool and documentation page to use the same canonical document URL.',
  )
  assert(
    firstHit && typeof firstHit === 'object' && !('sourceUrl' in firstHit),
    'Expected raw loader URLs to remain internal instead of becoming alternate citations.',
  )
  return { success: true }
}

export const testDocumentationManifestMaterializesEachSourceOnce = async () => {
  let loads = 0
  const result = await loadDocumentationDocumentsFromManifest(
    { internal: ['/guide.md'], external: [] },
    async function* (source) {
      await Promise.resolve()
      loads += 1
      yield {
        url: source,
        file: new File(['# Guide\n\nLoaded once.'], 'guide.md', { type: 'text/markdown' }),
      }
    },
  )

  assert(loads === 1, `Expected one source load, received ${loads}.`)
  assert(result.documents.length === 1, 'Expected one materialized document.')
  return { success: true }
}

export const testTaskyonDocumentationLoadsDocumentsWithoutIndexConsent = async () => {
  const tool = taskyonDocumentationTool
  const result = await tool.function?.({ query: 'How do Taskyon tools work?' }, createTestContext())

  assert(result && typeof result === 'object', 'Expected task result object')
  assert(
    'taskChainList' in result &&
      Array.isArray(result.taskChainList) &&
      result.taskChainList[0]?.length === 3,
    'Expected loading notice, provider call, and re-entry function call',
  )
  const chain = 'taskChainList' in result ? result.taskChainList[0] : undefined
  assert(
    getMessageData(chain?.[0]) === 'Searching Taskyon documentation...',
    'Expected a plain search notice without indexing consent.',
  )
  assert(
    getFunctionCallName(chain?.[1]) === 'documentationIndex' &&
      getFunctionCallName(chain?.[2]) === 'taskyonDocumentation',
    'Expected the provider followed by Taskyon documentation re-entry.',
  )

  return { success: true }
}

testDocumentationIndexRegistersAndSearchesManifestBase.description =
  'Registers a manifest-backed documentation base and searches its normalized documents.'
testDocumentationManifestMaterializesEachSourceOnce.description =
  'Materializes each manifest source once before handing it to the DAG cache node.'
testTaskyonDocumentationLoadsDocumentsWithoutIndexConsent.description =
  'Loads documentation directly without asking for obsolete vector-index consent.'
