import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { buildCreateNewTaskChain } from '../../core/createNewTaskChain'
import {
  createTaskyonClient,
  createTaskyonHostClient,
  setTaskyonProviderCredential,
} from '../../api'
import type { TaskyonStorageClient } from '../../api/storageProtocol'
import { tyCore } from '../../core/init'
import { createExternalToolContext, registerToolRpcTools } from '../../core/toolRpc'
import {
  createDefaultTaskyonToolSetup,
  resolveAgentToolCatalog,
  resolveTaskTreeAgentToolWindow,
} from '../../tools'
import { createStandardEntryNodeTool } from '../../tools/entryNode'
import { resolveStorageDownloadResultUrl } from '../../tools/fileTools'
import { sha256HashesFromFile } from '../../utils/encoding'
import { convertFileToText } from '../../utils/loadFiles'
import {
  authenticateDiagnosticsRuntime,
  resolveDiagnosticsRuntimeConfig,
} from '../../testSupport/onlineProviderSupport'
import { createPortableTestStorage } from '../../testSupport/portableTestStorage'
import type { TaskNode, partialTaskDraft } from '../../types/taskNode'

const documentNamespace = 'research'
const documentTimeoutMs = 300_000
const workflowTimeoutMs = 240_000

const retrievalTargets = [
  {
    id: 'federal-rules-civil-procedure.pdf',
    prompt:
      'Use webResearchPlanner to find the current official Federal Rules of Civil Procedure PDF and save it in storage namespace research with the exact object ID federal-rules-civil-procedure.pdf. Search official uscourts.gov sources. After saving it, report the source URL, title and revision date, and the rule governing service by mail on an individual in a civil case in the District of Arizona.',
    pdfTerms: ['federal rules', 'civil procedure', 'december 1 2025', 'rule 4'],
  },
] as const

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const buildEntryNodeDraft = (entryFunction: string): partialTaskDraft => ({
  role: 'system',
  content: {
    type: 'functioncall',
    data: {
      name: entryFunction,
      arguments: {},
    },
  },
})

const normalizeDocumentText = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const buildTargetTask = (
  target: (typeof retrievalTargets)[number],
  entryFunction: string,
): partialTaskDraft[] =>
  buildCreateNewTaskChain({
    currentTask: null,
    draftTask: {
      role: 'user',
      content: {
        type: 'message',
        data: target.prompt,
      },
    },
    entryNode: buildEntryNodeDraft(entryFunction),
    mode: 'message',
  })

const assistantReport = (tasks: TaskNode[]) => {
  const task = [...tasks]
    .reverse()
    .find(
      (candidate) =>
        candidate.role === 'assistant' &&
        candidate.content.type === 'message' &&
        String(candidate.content.data ?? '').trim().length > 0,
    )
  return task?.content.type === 'message' ? String(task.content.data ?? '') : ''
}

const storageCalls = (tasks: TaskNode[]) =>
  tasks.flatMap((task) => {
    if (task.content.type !== 'functioncall' || task.content.data.name !== 'storage') return []
    const args = task.content.data.arguments
    return [
      {
        action: typeof args.action === 'string' ? args.action : undefined,
        namespace: typeof args.namespace === 'string' ? args.namespace : undefined,
        id: typeof args.id === 'string' ? args.id : undefined,
        url: typeof args.url === 'string' ? args.url : undefined,
        expectedFileType:
          typeof args.expectedFileType === 'string' ? args.expectedFileType : undefined,
      },
    ]
  })

const validateStoredPdf = async (
  storageClient: TaskyonStorageClient,
  target: (typeof retrievalTargets)[number],
) => {
  const stored = await storageClient.getBlob({ namespace: documentNamespace, id: target.id })
  assert(stored, `No blob was stored for ${target.id}.`)
  assert(stored.data.byteLength > 5, `Stored blob is empty or too short for ${target.id}.`)

  const header = new TextDecoder().decode(stored.data.slice(0, 5))
  assert(header === '%PDF-', `${target.id} does not begin with the PDF signature.`)
  assert(
    !stored.metadata.contentType || stored.metadata.contentType.includes('application/pdf'),
    `${target.id} was stored with a non-PDF content type.`,
  )

  const file = new File([stored.data], target.id, { type: 'application/pdf' })
  const text = await convertFileToText(file)
  const normalizedText = normalizeDocumentText(text)
  const missingTerms = target.pdfTerms.filter(
    (term) => !normalizedText.includes(normalizeDocumentText(term)),
  )
  assert(
    missingTerms.length === 0,
    `${target.id} failed independent PDF text validation; missing: ${missingTerms.join(', ')}`,
  )

  const hash = await sha256HashesFromFile(file)
  if (stored.metadata.sha256 && stored.metadata.sha256 !== hash.sha256) {
    throw new Error(
      `${target.id} has inconsistent SHA-256 metadata: ${stored.metadata.sha256} != ${hash.sha256}`,
    )
  }

  return {
    id: target.id,
    size: stored.metadata.size,
    sha256: hash.sha256,
    textLength: text.length,
    matchedPdfTerms: target.pdfTerms,
  }
}

const createRetrievalRuntime = async (
  runtimeConfig: NonNullable<ReturnType<typeof resolveDiagnosticsRuntimeConfig>>,
  storage: ReturnType<typeof createPortableTestStorage>,
  storageClient: TaskyonStorageClient,
  entryFunction: string,
  storageDownload?: typeof fetch,
) => {
  const taskyonRef: { current?: Awaited<ReturnType<typeof tyCore>> } = {}
  const entryNodeTool = createStandardEntryNodeTool({
    name: entryFunction,
    renderOptions: { hideChat: true, hideLlm: true },
    getToolCatalog: async ({
      taskChain,
      allowedTools,
      pinnedToolNames,
      recentToolCount,
      frequentToolCount,
    }) => {
      const currentTy = taskyonRef.current
      if (!currentTy) return []
      const allTools = await createTaskyonClient(currentTy.port).tools.list({ includeHidden: true })
      const unavailableToolNames = new Set([entryFunction])
      return {
        tools: resolveTaskTreeAgentToolWindow(
          allTools,
          taskChain,
          unavailableToolNames,
          recentToolCount,
          frequentToolCount,
          allowedTools,
          pinnedToolNames,
        ),
        total: resolveAgentToolCatalog(allTools, unavailableToolNames).length,
      }
    },
  })
  const ty = await tyCore(
    () => runtimeConfig.settings,
    () => buildEntryNodeDraft(entryFunction),
    {
      chatCompletion: runtimeConfig.providerSettings,
      ...(runtimeConfig.entryNodeSettings
        ? { [entryFunction]: runtimeConfig.entryNodeSettings }
        : {}),
    },
    undefined,
    {
      toolSetup: createDefaultTaskyonToolSetup({
        pythonTool: null,
        storageClient,
        ...(storageDownload ? { storageDownload } : {}),
      }),
      authorizeSandboxFetch: ({ tool, capability }) =>
        Promise.resolve(
          tool.name === 'webResearchCandidateValidator' &&
            capability.access === 'read' &&
            ['https://r.jina.ai', 'https://www.uscourts.gov', 'https://uscourts.gov'].includes(
              capability.origin,
            ),
        ),
      indexTaskVectors: false,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  taskyonRef.current = ty
  try {
    const toolRpcExecutor = await registerToolRpcTools({
      port: ty.port,
      tools: [entryNodeTool],
      createContext: (call, stopSignal) =>
        createExternalToolContext(stopSignal, {
          getExecutionTaskChain: () => {
            if (!call.taskId) throw new Error('Expected a task id for document retrieval.')
            return createTaskyonClient(ty.port).task.getChain({
              id: call.taskId,
              selection: {
                method: 'lineage',
                includeSubtaskResults: 'terminal-visible',
              },
            })
          },
        }),
    })
    return { ty, toolRpcExecutor }
  } catch (error) {
    await ty.dispose('document retrieval runtime setup failed')
    throw error
  }
}

const runTarget = async (
  ty: Awaited<ReturnType<typeof tyCore>>,
  storageClient: TaskyonStorageClient,
  target: (typeof retrievalTargets)[number],
  entryFunction: string,
) => {
  const client = createTaskyonClient(ty.port)
  let unsubscribeWorker: () => void = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  const workerIdle = new Promise<void>((resolve, reject) => {
    const finish = () => {
      unsubscribeWorker()
      if (timeout) clearTimeout(timeout)
      resolve()
    }
    unsubscribeWorker = ty.workerStream((event) => {
      if (event.stage === 'all processed') finish()
    })
    timeout = setTimeout(() => {
      unsubscribeWorker()
      reject(new Error(`${target.id} workflow timed out after ${workflowTimeoutMs}ms.`))
    }, workflowTimeoutMs)
  })
  let created: Awaited<ReturnType<typeof client.task.createChain>>
  try {
    created = await client.task.createChain({
      tasks: buildTargetTask(target, entryFunction),
      execute: true,
      show: false,
    })
    await workerIdle
  } finally {
    unsubscribeWorker()
    if (timeout) clearTimeout(timeout)
  }
  const rootId = created.ids[0]
  assert(rootId, `${target.id} workflow did not create a root task.`)
  const observedTasks = await client.task.getTree({ id: rootId })
  const calls = storageCalls(observedTasks)
  const usedTools = observedTasks.flatMap((task) =>
    task.content.type === 'functioncall' ? [task.content.data.name] : [],
  )
  const observedSteps = observedTasks.flatMap((task) => {
    if (task.content.type === 'functioncall') {
      const stage = task.content.data.arguments.stage
      return [`${task.content.data.name}${typeof stage === 'string' ? `:${stage}` : ''}`]
    }
    if (
      task.content.type === 'structured' &&
      task.content.data !== null &&
      typeof task.content.data === 'object'
    ) {
      return [`structured:${Object.keys(task.content.data).join(',')}`]
    }
    return []
  })
  assert(
    usedTools.includes('webResearchPlanner'),
    `${target.id} did not use webResearchPlanner. Observed tools: ${usedTools.join(' -> ')}`,
  )
  const downloadCall = calls.find((call) => call.action === 'download')
  assert(
    downloadCall,
    `${target.id} never used storage download. Observed steps: ${observedSteps.join(' -> ')}.`,
  )
  assert(
    downloadCall.namespace === documentNamespace && downloadCall.id === target.id,
    `${target.id} downloaded into namespace "${downloadCall.namespace ?? '(missing)'}" with object ID "${downloadCall.id ?? '(missing)'}".`,
  )
  assert(
    downloadCall.expectedFileType === 'pdf' && /^https?:\/\//.test(downloadCall.url ?? ''),
    `${target.id} did not provide an HTTP PDF download request.`,
  )
  assert(
    calls.some(
      (call) =>
        call.action === 'read' && call.namespace === documentNamespace && call.id === target.id,
    ),
    `${target.id} never used storage read to inspect the downloaded object. Actions: ${calls
      .map((call) => call.action ?? 'unknown')
      .join(', ')}.`,
  )

  const downloadedUrl = resolveStorageDownloadResultUrl(observedTasks)
  assert(downloadedUrl, `${target.id} storage result omitted the successful source URL.`)
  const report = assistantReport(observedTasks)
  assert(report.trim().length > 0, `${target.id} workflow returned no final synthesis.`)

  return {
    ...(await validateStoredPdf(storageClient, target)),
    observedTaskCount: observedTasks.length,
    storageCallCount: calls.length,
    storageActions: calls.map((call) => call.action ?? 'unknown'),
    sourceUrl: downloadedUrl,
    assistantReport: report.slice(0, 500),
  }
}

export const testDocumentRetrievalStoresOfficialFederalRulesPdf = async (
  context?: DiagnosticsTestContext,
) => {
  if (!context?.providerSession) {
    return {
      skipped: true,
      reason: 'No configured provider session was available from the diagnostics harness.',
    }
  }
  if (!context.storageClient) {
    return {
      skipped: true,
      reason: 'The diagnostics harness did not provide its location-transparent StorageClient.',
    }
  }

  const runtimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!runtimeConfig) {
    return {
      skipped: true,
      reason: 'No active model/toolchain settings were provided by the diagnostics harness.',
    }
  }

  const storage = createPortableTestStorage()
  const storageClient = context.storageClient as unknown as TaskyonStorageClient
  const entryFunction = runtimeConfig.settings.entryFunction

  try {
    const runtime = await createRetrievalRuntime(
      runtimeConfig,
      storage,
      storageClient,
      entryFunction,
      context.storageDownload,
    )
    try {
      const host = createTaskyonHostClient(runtime.ty.hostPort)
      if (
        !(await authenticateDiagnosticsRuntime(context, {
          updateChatCompletionApiKey: (provider, value) =>
            setTaskyonProviderCredential(host, provider, value),
        }))
      ) {
        return {
          skipped: true,
          reason: 'The saved provider session could not authenticate the runtime.',
        }
      }
      const target = retrievalTargets[0]
      assert(target, 'The Federal Rules retrieval target is missing.')
      const document = await runTarget(runtime.ty, storageClient, target, entryFunction)

      return {
        namespace: documentNamespace,
        searchSelection:
          'normal message path; websearch auto is supplied by the chain builder and the provider/model decides whether to search',
        documents: [document],
      }
    } finally {
      runtime.toolRpcExecutor.destroy()
      await runtime.ty.dispose('document retrieval Federal Rules test complete')
    }
  } finally {
    storage.destroy()
  }
}

testDocumentRetrievalStoresOfficialFederalRulesPdf.description =
  'Runs the normal UI and CLI message chain, searches for the current Federal Rules of Civil Procedure PDF, stores it through browser StorageClient, and independently validates its PDF text and SHA-256 hash.'
testDocumentRetrievalStoresOfficialFederalRulesPdf.modelBased = true
testDocumentRetrievalStoresOfficialFederalRulesPdf.timeoutMs = documentTimeoutMs
