import initRumoca from 'rumoca'
import * as rumoca from 'rumoca'
import { strFromU8, unzipSync } from 'fflate'
import { handleExtractDiagram } from './modelicadiagramGeneration'
import { renderRumocaTemplate } from './rumocaTemplateRender'

let loadedSourceRootFiles: Record<string, string> = {}

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

type CompileRenderPayload = {
  modelicaSource: string
  templateSource: string
  modelName: string
  usePreparedDae: boolean
  useSourceRoots: boolean
}

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

function postResponse(response: WorkerResponse): void {
  self.postMessage(response)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function readRumocaPackageBuiltTimeUtc(): Promise<string> {
  try {
    const module = await import('rumoca/rumoca_package_meta.json')
    const meta = (module as { default?: Record<string, unknown> }).default ?? {}
    const raw = meta.packageBuiltTimeUtc
    return typeof raw === 'string' && raw.trim() ? raw : 'unknown'
  } catch {
    return 'unknown'
  }
}

function sanitizeLibraryPath(path: string): string {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) {
    return parts.slice(1).join('/')
  }
  if (parts.length > 0) {
    parts[0] = parts[0]!.replace(/[\s-][\d.]+$/, '')
  }
  return parts.join('/')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function selectDaeForTemplate(
  compiled: Record<string, unknown>,
  usePreparedDae: boolean,
): Record<string, unknown> | null {
  const preferred = usePreparedDae ? asRecord(compiled.dae_prepared) : null
  if (preferred) return preferred
  const dae = asRecord(compiled.dae)
  return dae
}

async function handleInit(payload: { threads?: number } | undefined): Promise<unknown> {
  await initRumoca()
  const threads = Math.max(0, Math.floor(Number(payload?.threads ?? 0)))
  let rayonEnabled = false
  if (typeof rumoca.wasm_init === 'function') {
    try {
      const result = await Promise.resolve(rumoca.wasm_init(threads))
      rayonEnabled = Boolean(result)
    } catch {
      rayonEnabled = false
    }
  }
  const version = typeof rumoca.get_version === 'function' ? asString(rumoca.get_version()) : ''
  const gitCommit =
    typeof rumoca.get_git_commit === 'function' ? asString(rumoca.get_git_commit()) : ''
  const buildTimeUtc =
    typeof rumoca.get_build_time_utc === 'function' ? asString(rumoca.get_build_time_utc()) : ''
  const rustBuildTimeUtc = buildTimeUtc
  const packageBuiltTimeUtc = await readRumocaPackageBuiltTimeUtc()
  return { version, gitCommit, buildTimeUtc, rustBuildTimeUtc, packageBuiltTimeUtc, rayonEnabled }
}

function handleCompileRender(payload: CompileRenderPayload): unknown {
  const source = payload.modelicaSource
  const modelName = payload.modelName || 'Model'
  const compileRaw =
    payload.useSourceRoots && typeof rumoca.compile_with_source_roots === 'function'
      ? rumoca.compile_with_source_roots(source, modelName, '{}')
      : rumoca.compile_to_json(source, modelName)

  const compiled = JSON.parse(String(compileRaw)) as Record<string, unknown>
  const daeForTemplate = selectDaeForTemplate(compiled, payload.usePreparedDae)
  if (!daeForTemplate) {
    throw new Error('Compilation did not return a usable DAE object (expected dae)')
  }
  const rendered = renderRumocaTemplate({
    wasm: rumoca,
    daeJson: JSON.stringify(daeForTemplate),
    templateSource: payload.templateSource,
    modelName,
    templatePath: 'template.jinja',
    outputPath: `${modelName}.txt`,
    targetName: 'template',
  })
  return {
    compiled,
    daeForTemplate,
    rendered,
    modelName,
    usedLibraries: payload.useSourceRoots,
  }
}

function handleLoadMslZip(payload: { fileName: string; bytes: ArrayBuffer }): unknown {
  const archive = unzipSync(new Uint8Array(payload.bytes))
  const libraries: Record<string, string> = {}

  for (const [rawPath, content] of Object.entries(archive)) {
    const lowerPath = rawPath.toLowerCase()
    if (!lowerPath.endsWith('.mo')) continue
    if (rawPath.includes('Test') || rawPath.includes('Obsolete')) continue
    libraries[sanitizeLibraryPath(rawPath)] = strFromU8(content)
  }

  const fileCount = Object.keys(libraries).length
  if (fileCount === 0) {
    throw new Error('No usable .mo files found in archive')
  }
  loadedSourceRootFiles = libraries
  const resultRaw = rumoca.load_source_roots(JSON.stringify(libraries))
  let parsedCount = fileCount
  try {
    const parsed = JSON.parse(String(resultRaw)) as { parsed_count?: unknown }
    const maybeCount = Number(parsed.parsed_count)
    if (Number.isFinite(maybeCount)) parsedCount = maybeCount
  } catch {
    parsedCount = fileCount
  }
  return {
    fileCount,
    parsedCount,
    archiveName: payload.fileName,
    documentCount:
      typeof rumoca.get_source_root_document_count === 'function'
        ? Number(rumoca.get_source_root_document_count()) || 0
        : 0,
  }
}

function handleMergeMslZip(payload: { fileName: string; bytes: ArrayBuffer }): unknown {
  const archive = unzipSync(new Uint8Array(payload.bytes))
  const libraries: Record<string, string> = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    const lowerPath = rawPath.toLowerCase()
    if (!lowerPath.endsWith('.mo')) continue
    if (rawPath.includes('Test') || rawPath.includes('Obsolete')) continue
    libraries[sanitizeLibraryPath(rawPath)] = strFromU8(content)
  }

  const fileCount = Object.keys(libraries).length
  if (fileCount === 0) {
    throw new Error('No usable .mo files found in archive')
  }

  // Incremental add: parse each file and merge parsed definitions into the existing session.
  const defs: Array<[string, string]> = []
  for (const [fileName, source] of Object.entries(libraries)) {
    try {
      const parsed = rumoca.parse_source_root_file(source, fileName)
      defs.push([fileName, String(parsed)])
    } catch {
      // Ignore parse failures per-file to match legacy permissive load behavior.
    }
  }
  if (defs.length === 0) {
    throw new Error('No parseable .mo files found in archive')
  }

  const mergedCount = Number(rumoca.merge_parsed_source_roots(JSON.stringify(defs))) || 0
  loadedSourceRootFiles = {
    ...loadedSourceRootFiles,
    ...libraries,
  }
  return {
    fileCount,
    parsedCount: mergedCount,
    archiveName: payload.fileName,
    documentCount:
      typeof rumoca.get_source_root_document_count === 'function'
        ? Number(rumoca.get_source_root_document_count()) || 0
        : 0,
  }
}

function handleListClasses(): unknown {
  const raw = rumoca.list_classes()
  return JSON.parse(String(raw))
}

function handleGetClassInfo(payload: { qualifiedName: string }): unknown {
  const raw = rumoca.get_class_info(payload.qualifiedName)
  return JSON.parse(String(raw))
}

const removeTopLevelImportsForDiagramParse = (source: string): string => {
  const lines = source.split('\n')
  let encounteredClassDeclaration = false
  const classStart = /^\s*(?:model|class|package|block|record|connector|type|function|operator)\b/i
  const importLine = /^\s*import\b.*;\s*$/
  const out: string[] = []
  for (const line of lines) {
    if (classStart.test(line)) encounteredClassDeclaration = true
    if (!encounteredClassDeclaration && importLine.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

const normalizeLegacyDeclarationModifiersForDiagramParse = (source: string): string =>
  source.replace(
    /(\b(?:parameter|constant|discrete|input|output)\s+[A-Za-z_][A-Za-z0-9_.]*\s+[A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*\(([^()]*)\)/g,
    '$1($2, $3)',
  )

const stripEquationSectionsForDiagramParse = (source: string): string => {
  const lines = source.split('\n')
  const result: string[] = []
  let inEquationBlock = false
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase()
    if (!inEquationBlock && (trimmed === 'equation' || trimmed === 'algorithm')) {
      inEquationBlock = true
      continue
    }
    if (inEquationBlock) {
      if (trimmed.startsWith('annotation(') || trimmed.startsWith('end ')) {
        inEquationBlock = false
      } else {
        continue
      }
    }
    result.push(line)
  }
  return result.join('\n')
}

const parseSourceRootAst = (source: string, fileName: string): Record<string, unknown> => {
  const parseJson = (input: string): Record<string, unknown> =>
    JSON.parse(String(rumoca.parse_source_root_file(input, fileName))) as Record<string, unknown>
  const fallbacks = [
    removeTopLevelImportsForDiagramParse(source),
    normalizeLegacyDeclarationModifiersForDiagramParse(source),
    stripEquationSectionsForDiagramParse(source),
    stripEquationSectionsForDiagramParse(normalizeLegacyDeclarationModifiersForDiagramParse(source)),
  ]
  try {
    return parseJson(source)
  } catch (firstError) {
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
    let lastError: unknown = firstError
    for (const fallback of fallbacks) {
      if (fallback === source) continue
      try {
        return parseJson(fallback)
      } catch (error) {
        lastError = error
      }
    }
    const secondMessage =
      lastError instanceof Error ? lastError.message : String(lastError ?? firstError)
    throw new Error(
      `Cannot parse Modelica source for diagram extraction: primary=${firstMessage}; fallback=${secondMessage}`,
    )
  }
}

function handleParseSourceAst(payload: {
  source: string
  fileName?: string
}): Record<string, unknown> {
  const source = asString(payload.source)
  if (!source.trim()) throw new Error('Cannot parse AST: source is empty')
  const fileName = asString(payload.fileName) || 'Model.mo'
  return parseSourceRootAst(source, fileName)
}

function handleLspCompletionWithTiming(payload: {
  source: string
  line: number
  character: number
}): unknown {
  if (typeof rumoca.lsp_completion_with_timing === 'function') {
    return JSON.parse(
      String(rumoca.lsp_completion_with_timing(payload.source, payload.line, payload.character)),
    )
  }
  return JSON.parse(String(rumoca.lsp_completion(payload.source, payload.line, payload.character)))
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    let result: unknown
    switch (msg.type) {
      case 'init':
        result = await handleInit(msg.payload)
        break
      case 'compile_render':
        result = handleCompileRender(msg.payload)
        break
      case 'load_msl_zip':
        result = handleLoadMslZip(msg.payload)
        break
      case 'merge_msl_zip':
        result = handleMergeMslZip(msg.payload)
        break
      case 'clear_libraries':
        rumoca.clear_source_root_cache()
        loadedSourceRootFiles = {}
        result = { ok: true }
        break
      case 'list_classes':
        result = handleListClasses()
        break
      case 'get_class_info':
        result = handleGetClassInfo(msg.payload)
        break
      case 'extract_diagram':
        result = handleExtractDiagram(msg.payload, () => loadedSourceRootFiles)
        break
      case 'parse_source_ast':
        result = handleParseSourceAst(msg.payload)
        break
      case 'lsp_completion_with_timing':
        result = handleLspCompletionWithTiming(msg.payload)
        break
      case 'get_source_root_document_count':
        result =
          typeof rumoca.get_source_root_document_count === 'function'
            ? Number(rumoca.get_source_root_document_count()) || 0
            : 0
        break
      default: {
        const exhaustive: never = msg
        throw new Error(`Unsupported worker request: ${String(exhaustive)}`)
      }
    }
    postResponse({ id: msg.id, ok: true, result })
  } catch (error) {
    postResponse({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
