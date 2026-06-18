type WorkerRequest =
  | { id: number; type: 'init'; payload?: { threads?: number } }
  | {
      id: number
      type: 'compile_render'
      payload: {
        modelicaSource: string
        templateSource: string
        modelName: string
        usePreparedDae: boolean
        useSourceRoots: boolean
      }
    }
  | {
      id: number
      type: 'render_modelica_view'
      payload: {
        modelicaSource: string
        modelName: string
        useSourceRoots: boolean
        view: 'base-modelica' | 'flat-modelica' | 'dae-modelica'
      }
    }
  | { id: number; type: 'load_msl_zip'; payload: { fileName: string; bytes: ArrayBuffer } }
  | { id: number; type: 'merge_msl_zip'; payload: { fileName: string; bytes: ArrayBuffer } }
  | { id: number; type: 'clear_libraries' }
  | { id: number; type: 'list_classes' }
  | { id: number; type: 'get_class_info'; payload: { qualifiedName: string } }
  | {
      id: number
      type: 'extract_diagram'
      payload: { source: string; qualifiedName?: string; fileName?: string }
    }
  | {
      id: number
      type: 'parse_source_ast'
      payload: { source: string; fileName?: string }
    }
  | {
      id: number
      type: 'lsp_completion_with_timing'
      payload: { source: string; line: number; character: number }
    }
  | {
      id: number
      type: 'get_simulation_models'
      payload: { source: string; defaultModel?: string }
    }
  | {
      id: number
      type: 'start_simulation'
      payload: { source: string; modelName: string; tEnd: number; dt: number; solver: string }
    }
  | { id: number; type: 'get_bundled_source_root_manifest' }
  | { id: number; type: 'load_bundled_source_root_cache'; payload: { archiveId: string } }
  | { id: number; type: 'export_source_root_binary_cache'; payload: { uris: string[] } }
  | { id: number; type: 'restore_source_root_binary_cache'; payload: { bytes: ArrayBuffer } }
  | { id: number; type: 'get_source_root_document_count' }

type WorkerRequestNoId =
  | { type: 'init'; payload?: { threads?: number } }
  | {
      type: 'compile_render'
      payload: {
        modelicaSource: string
        templateSource: string
        modelName: string
        usePreparedDae: boolean
        useSourceRoots: boolean
      }
    }
  | {
      type: 'render_modelica_view'
      payload: {
        modelicaSource: string
        modelName: string
        useSourceRoots: boolean
        view: 'base-modelica' | 'flat-modelica' | 'dae-modelica'
      }
    }
  | { type: 'load_msl_zip'; payload: { fileName: string; bytes: ArrayBuffer } }
  | { type: 'merge_msl_zip'; payload: { fileName: string; bytes: ArrayBuffer } }
  | { type: 'clear_libraries' }
  | { type: 'list_classes' }
  | { type: 'get_class_info'; payload: { qualifiedName: string } }
  | {
      type: 'extract_diagram'
      payload: { source: string; qualifiedName?: string; fileName?: string }
    }
  | {
      type: 'parse_source_ast'
      payload: { source: string; fileName?: string }
    }
  | {
      type: 'lsp_completion_with_timing'
      payload: { source: string; line: number; character: number }
    }
  | {
      type: 'get_simulation_models'
      payload: { source: string; defaultModel?: string }
    }
  | {
      type: 'start_simulation'
      payload: { source: string; modelName: string; tEnd: number; dt: number; solver: string }
    }
  | { type: 'get_bundled_source_root_manifest' }
  | { type: 'load_bundled_source_root_cache'; payload: { archiveId: string } }
  | { type: 'export_source_root_binary_cache'; payload: { uris: string[] } }
  | { type: 'restore_source_root_binary_cache'; payload: { bytes: ArrayBuffer } }
  | { type: 'get_source_root_document_count' }

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  requestType: WorkerRequestNoId['type']
}

export type ModelicaWorkerActivityEvent = {
  requestId: number
  requestType: WorkerRequestNoId['type']
  label: string
  status: 'started' | 'finished' | 'failed'
  error?: string
}

export type ModelicaWorkerInitInfo = {
  version: string
  gitCommit: string
  buildTimeUtc: string
  rustBuildTimeUtc?: string
  packageBuiltTimeUtc?: string
  rayonEnabled: boolean
  simulationAvailable?: boolean
  simulationModelDiscoveryAvailable?: boolean
}

export type BundledSourceRootArchive = {
  archiveId: string
  fileName: string
  fileCount: number
  source?: string
}

export type BundledSourceRootManifest = {
  archives: BundledSourceRootArchive[]
}

export class ModelicaWorkerClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()
  private activityListeners = new Set<(event: ModelicaWorkerActivityEvent) => void>()

  constructor() {
    this.worker = new Worker(new URL('./modelicaWorker.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      const req = this.pending.get(msg.id)
      if (!req) return
      this.pending.delete(msg.id)
      if (msg.ok) {
        this.emitActivity({
          requestId: msg.id,
          requestType: req.requestType,
          label: this.activityLabel(req.requestType),
          status: 'finished',
        })
        req.resolve(msg.result)
      } else {
        this.emitActivity({
          requestId: msg.id,
          requestType: req.requestType,
          label: this.activityLabel(req.requestType),
          status: 'failed',
          error: msg.error,
        })
        req.reject(new Error(msg.error))
      }
    }
  }

  terminate() {
    this.worker.terminate()
    for (const [requestId, req] of this.pending) {
      this.emitActivity({
        requestId,
        requestType: req.requestType,
        label: this.activityLabel(req.requestType),
        status: 'failed',
        error: 'Modelica worker terminated',
      })
      req.reject(new Error('Modelica worker terminated'))
    }
    this.pending.clear()
  }

  onActivity(listener: (event: ModelicaWorkerActivityEvent) => void): () => void {
    this.activityListeners.add(listener)
    return () => {
      this.activityListeners.delete(listener)
    }
  }

  private emitActivity(event: ModelicaWorkerActivityEvent) {
    this.activityListeners.forEach((listener) => listener(event))
  }

  private activityLabel(type: WorkerRequestNoId['type']): string {
    switch (type) {
      case 'compile_render':
        return 'Compiling Modelica'
      case 'extract_diagram':
        return 'Building diagram'
      case 'render_modelica_view':
        return 'Loading analysis view'
      case 'get_class_info':
        return 'Loading class info'
      case 'load_msl_zip':
      case 'merge_msl_zip':
        return 'Loading libraries'
      case 'list_classes':
        return 'Listing classes'
      case 'parse_source_ast':
        return 'Parsing AST'
      case 'clear_libraries':
        return 'Clearing libraries'
      case 'init':
        return 'Initializing worker'
      case 'get_source_root_document_count':
        return 'Inspecting source roots'
      case 'get_bundled_source_root_manifest':
        return 'Inspecting bundled libraries'
      case 'load_bundled_source_root_cache':
        return 'Loading bundled libraries'
      case 'export_source_root_binary_cache':
        return 'Creating library cache'
      case 'restore_source_root_binary_cache':
        return 'Restoring library cache'
      case 'lsp_completion_with_timing':
        return 'Computing completion'
      case 'get_simulation_models':
        return 'Listing simulation models'
      case 'start_simulation':
        return 'Running Rumoca simulation'
      default:
        return 'Running worker task'
    }
  }

  private request<T = unknown>(msg: WorkerRequestNoId, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++
    this.emitActivity({
      requestId: id,
      requestType: msg.type,
      label: this.activityLabel(msg.type),
      status: 'started',
    })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        requestType: msg.type,
      })
      const withId = { id, ...msg } as WorkerRequest
      this.worker.postMessage(withId, transfer)
    })
  }

  init(threads = 0): Promise<ModelicaWorkerInitInfo> {
    return this.request<ModelicaWorkerInitInfo>({ type: 'init', payload: { threads } })
  }

  compileRender(payload: {
    modelicaSource: string
    templateSource: string
    modelName: string
    usePreparedDae: boolean
    useSourceRoots: boolean
  }): Promise<{
    compiled: Record<string, unknown>
    daeForTemplate: Record<string, unknown>
    daePretty: string
    rendered: string
    modelName: string
    usedLibraries: boolean
  }> {
    return this.request({ type: 'compile_render', payload })
  }

  renderModelicaView(payload: {
    modelicaSource: string
    modelName: string
    useSourceRoots: boolean
    view: 'base-modelica' | 'flat-modelica' | 'dae-modelica'
  }): Promise<{ view: 'base-modelica' | 'flat-modelica' | 'dae-modelica'; rendered: string }> {
    return this.request({ type: 'render_modelica_view', payload })
  }

  loadMslZip(
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{
    fileCount: number
    parsedCount: number
    archiveName: string
    documentCount: number
    loadMode?: 'index' | 'parsed'
    classCount?: number
    sourceRootUris: string[]
  }> {
    return this.request({ type: 'load_msl_zip', payload: { fileName, bytes } }, [bytes])
  }

  mergeMslZip(
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{
    fileCount: number
    parsedCount: number
    archiveName: string
    documentCount: number
    loadMode?: 'merge'
    sourceRootUris: string[]
  }> {
    return this.request({ type: 'merge_msl_zip', payload: { fileName, bytes } }, [bytes])
  }

  clearLibraries(): Promise<{ ok: true }> {
    return this.request({ type: 'clear_libraries' })
  }

  listClasses(): Promise<Record<string, unknown>> {
    return this.request({ type: 'list_classes' })
  }

  getClassInfo(qualifiedName: string): Promise<Record<string, unknown>> {
    return this.request({ type: 'get_class_info', payload: { qualifiedName } })
  }

  extractDiagram(payload: {
    source: string
    qualifiedName?: string
    fileName?: string
  }): Promise<Record<string, unknown>> {
    return this.request({ type: 'extract_diagram', payload })
  }

  parseSourceAst(payload: { source: string; fileName?: string }): Promise<Record<string, unknown>> {
    return this.request({ type: 'parse_source_ast', payload })
  }

  lspCompletionWithTiming(
    source: string,
    line: number,
    character: number,
  ): Promise<Record<string, unknown>> {
    return this.request({
      type: 'lsp_completion_with_timing',
      payload: { source, line, character },
    })
  }

  getSimulationModels(payload: { source: string; defaultModel?: string }): Promise<{
    ok?: boolean
    models?: string[]
    selectedModel?: string | null
    error?: string | null
  }> {
    return this.request({ type: 'get_simulation_models', payload })
  }

  startSimulation(payload: {
    source: string
    modelName: string
    tEnd: number
    dt: number
    solver: string
  }): Promise<Record<string, unknown>> {
    return this.request({ type: 'start_simulation', payload })
  }

  getBundledSourceRootManifest(): Promise<BundledSourceRootManifest> {
    return this.request<BundledSourceRootManifest>({ type: 'get_bundled_source_root_manifest' })
  }

  loadBundledSourceRootCache(
    archiveId: string,
  ): Promise<{ archiveId: string; documentCount: number }> {
    return this.request({
      type: 'load_bundled_source_root_cache',
      payload: { archiveId },
    })
  }

  exportSourceRootBinaryCache(uris: string[]): Promise<Uint8Array> {
    return this.request<Uint8Array>({
      type: 'export_source_root_binary_cache',
      payload: { uris },
    })
  }

  restoreSourceRootBinaryCache(bytes: ArrayBuffer): Promise<number> {
    return this.request<number>(
      {
        type: 'restore_source_root_binary_cache',
        payload: { bytes },
      },
      [bytes],
    )
  }

  getSourceRootDocumentCount(): Promise<number> {
    return this.request<number>({ type: 'get_source_root_document_count' })
  }
}
