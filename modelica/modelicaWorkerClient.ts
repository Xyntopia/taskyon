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
  | { type: 'get_source_root_document_count' }

type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export type ModelicaWorkerInitInfo = {
  version: string
  gitCommit: string
  buildTimeUtc: string
  rustBuildTimeUtc?: string
  packageBuiltTimeUtc?: string
  rayonEnabled: boolean
}

export class ModelicaWorkerClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker = new Worker(new URL('./modelicaWorker.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      const req = this.pending.get(msg.id)
      if (!req) return
      this.pending.delete(msg.id)
      if (msg.ok) req.resolve(msg.result)
      else req.reject(new Error(msg.error))
    }
  }

  terminate() {
    this.worker.terminate()
    for (const [, req] of this.pending) {
      req.reject(new Error('Modelica worker terminated'))
    }
    this.pending.clear()
  }

  private request<T = unknown>(msg: WorkerRequestNoId, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
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
    rendered: string
    modelName: string
    usedLibraries: boolean
  }> {
    return this.request({ type: 'compile_render', payload })
  }

  loadMslZip(fileName: string, bytes: ArrayBuffer): Promise<{ fileCount: number; parsedCount: number; archiveName: string; documentCount: number }> {
    return this.request({ type: 'load_msl_zip', payload: { fileName, bytes } }, [bytes])
  }

  mergeMslZip(fileName: string, bytes: ArrayBuffer): Promise<{ fileCount: number; parsedCount: number; archiveName: string; documentCount: number }> {
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

  parseSourceAst(payload: {
    source: string
    fileName?: string
  }): Promise<Record<string, unknown>> {
    return this.request({ type: 'parse_source_ast', payload })
  }

  lspCompletionWithTiming(source: string, line: number, character: number): Promise<Record<string, unknown>> {
    return this.request({
      type: 'lsp_completion_with_timing',
      payload: { source, line, character },
    })
  }

  getSourceRootDocumentCount(): Promise<number> {
    return this.request<number>({ type: 'get_source_root_document_count' })
  }
}
