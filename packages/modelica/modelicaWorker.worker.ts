import initRumoca from 'rumoca-full-web'
import * as rumoca from 'rumoca-full-web'
import { strFromU8, unzipSync } from 'fflate'
import { handleExtractDiagram } from './modelicadiagramGeneration'
import { renderRumocaTemplate } from './rumocaTemplateRender'
import baseDaeTemplate from './base_dae.jinja?raw'
import {
  buildLazyModelicaLibraryByteArchive,
  buildLazyModelicaLibraryByteSources,
  selectLazyModelicaSourceUris,
  sourceUrisForQualifiedName,
  type LazyModelicaLibraryIndex,
} from './lazyModelicaLibraryIndex'

let loadedSourceRootFiles: Record<string, string> = {}
let loadedSourceRootBytes: Record<string, Uint8Array> = {}
let lazyLibraryIndex: LazyModelicaLibraryIndex | null = null
let materializedSourceRootUris = new Set<string>()

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
  | {
      id: number
      type: 'load_msl_zip'
      payload: { fileName: string; bytes: ArrayBuffer; lazyIndex?: LazyModelicaLibraryIndex }
    }
  | { id: number; type: 'merge_msl_zip'; payload: { fileName: string; bytes: ArrayBuffer } }
  | { id: number; type: 'materialize_library_classes'; payload: { qualifiedNames: string[] } }
  | {
      id: number
      type: 'materialize_diagram_classes'
      payload: { source: string; qualifiedName?: string; fileName?: string }
    }
  | { id: number; type: 'materialize_all_libraries' }
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
      type: 'extract_diagram_preview'
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

type CompileRenderPayload = {
  modelicaSource: string
  templateSource: string
  modelName: string
  usePreparedDae: boolean
  useSourceRoots: boolean
}

type RenderModelicaViewPayload = {
  modelicaSource: string
  modelName: string
  useSourceRoots: boolean
  view: 'base-modelica' | 'flat-modelica' | 'dae-modelica'
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

function getSourceRootDocumentCount(): number {
  return typeof rumoca.get_source_root_document_count === 'function'
    ? Number(rumoca.get_source_root_document_count()) || 0
    : 0
}

function parseSourceRootLoadSummary(raw: unknown): {
  parsedCount: number
  insertedCount: number
  documentCount: number
} {
  try {
    const parsed = JSON.parse(String(raw)) as {
      parsed_count?: unknown
      inserted_count?: unknown
    }
    return {
      parsedCount: Number(parsed.parsed_count) || 0,
      insertedCount: Number(parsed.inserted_count) || 0,
      documentCount: getSourceRootDocumentCount(),
    }
  } catch {
    return {
      parsedCount: 0,
      insertedCount: 0,
      documentCount: getSourceRootDocumentCount(),
    }
  }
}

function loadSourceRootSubset(subset: Record<string, string>): {
  parsedCount: number
  insertedCount: number
  documentCount: number
} {
  const uris = Object.keys(subset)
  if (uris.length === 0) {
    return {
      parsedCount: 0,
      insertedCount: 0,
      documentCount: getSourceRootDocumentCount(),
    }
  }
  if (typeof rumoca.load_source_roots !== 'function') {
    throw new Error('Rumoca wasm export missing: load_source_roots')
  }
  const raw = rumoca.load_source_roots(JSON.stringify(subset))
  materializedSourceRootUris = new Set(uris)
  return parseSourceRootLoadSummary(raw)
}

function availableSourceRootUris(): string[] {
  return Array.from(
    new Set([...Object.keys(loadedSourceRootFiles), ...Object.keys(loadedSourceRootBytes)]),
  )
}

function decodeSourceRootUri(uri: string): string | null {
  const existing = loadedSourceRootFiles[uri]
  if (typeof existing === 'string') return existing
  const bytes = loadedSourceRootBytes[uri]
  if (!bytes) return null
  const decoded = strFromU8(bytes)
  loadedSourceRootFiles[uri] = decoded
  return decoded
}

function decodeSourceRootSubset(uris: string[]): Record<string, string> {
  const subset: Record<string, string> = {}
  for (const uri of uris) {
    const source = decodeSourceRootUri(uri)
    if (source != null) subset[uri] = source
  }
  return subset
}

function materializeLibraryClasses(qualifiedNames: string[]): {
  parsedCount: number
  insertedCount: number
  documentCount: number
  materializedFileCount: number
  requestedClassCount: number
} {
  const startedAt = performance.now()
  const availableUris = availableSourceRootUris()
  if (availableUris.length === 0) {
    return {
      parsedCount: 0,
      insertedCount: 0,
      documentCount: getSourceRootDocumentCount(),
      materializedFileCount: 0,
      requestedClassCount: qualifiedNames.length,
    }
  }
  const selectedUris = selectLazyModelicaSourceUris(
    lazyLibraryIndex,
    qualifiedNames,
    availableUris,
    materializedSourceRootUris,
  )
  console.info('[modelica-worker][materialize-library-classes] selected source roots', {
    requestedClassCount: qualifiedNames.length,
    availableUriCount: availableUris.length,
    selectedUriCount: selectedUris.length,
    materializedBeforeCount: materializedSourceRootUris.size,
  })
  const subset = decodeSourceRootSubset(selectedUris)
  const loaded = loadSourceRootSubset(subset)
  console.info('[modelica-worker][materialize-library-classes] finished', {
    requestedClassCount: qualifiedNames.length,
    selectedUriCount: selectedUris.length,
    parsedCount: loaded.parsedCount,
    insertedCount: loaded.insertedCount,
    documentCount: loaded.documentCount,
    materializedFileCount: materializedSourceRootUris.size,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return {
    ...loaded,
    materializedFileCount: materializedSourceRootUris.size,
    requestedClassCount: qualifiedNames.length,
  }
}

function isLibraryClassMaterialized(qualifiedName: string): boolean {
  const normalized = asString(qualifiedName).trim()
  if (!normalized || !lazyLibraryIndex) return true
  const uris = sourceUrisForQualifiedName(lazyLibraryIndex, normalized)
  if (uris.length === 0) return true
  const requiredUris = selectLazyModelicaSourceUris(lazyLibraryIndex, [normalized], uris, [])
  return requiredUris.every((uri) => materializedSourceRootUris.has(uri))
}

function materializeAllLibraries(): {
  parsedCount: number
  insertedCount: number
  documentCount: number
  materializedFileCount: number
} {
  const subset = decodeSourceRootSubset(availableSourceRootUris())
  const loaded = loadSourceRootSubset(subset)
  return {
    ...loaded,
    materializedFileCount: materializedSourceRootUris.size,
  }
}

function errorSuggestsMissingSourceRoot(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|unknown|missing|unresolved|failed to resolve|cannot resolve/i.test(message)
}

function referencedModelicaClassNames(source: string): string[] {
  const matches = source.match(/\bModelica(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g) ?? []
  return Array.from(new Set(matches))
}

function compileWithLazySourceRoots(source: string, modelName: string): string {
  if (typeof rumoca.compile_with_source_roots !== 'function') {
    return rumoca.compile_to_json(source, modelName)
  }
  materializeLibraryClasses([modelName, ...referencedModelicaClassNames(source)])
  try {
    return rumoca.compile_with_source_roots(source, modelName, '{}')
  } catch (error) {
    if (!errorSuggestsMissingSourceRoot(error)) throw error
    materializeAllLibraries()
    return rumoca.compile_with_source_roots(source, modelName, '{}')
  }
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
  const packageBuiltTimeUtc = buildTimeUtc
  const simulationAvailable = typeof rumoca.simulate_model === 'function'
  const simulationModelDiscoveryAvailable = typeof rumoca.get_simulation_models === 'function'
  return {
    version,
    gitCommit,
    buildTimeUtc,
    rustBuildTimeUtc,
    packageBuiltTimeUtc,
    rayonEnabled,
    simulationAvailable,
    simulationModelDiscoveryAvailable,
  }
}

function handleCompileRender(payload: CompileRenderPayload): unknown {
  const source = payload.modelicaSource
  const modelName = payload.modelName || 'Model'
  const compileRaw =
    payload.useSourceRoots && typeof rumoca.compile_with_source_roots === 'function'
      ? compileWithLazySourceRoots(source, modelName)
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
  const daePretty = renderRumocaTemplate({
    wasm: rumoca,
    daeJson: JSON.stringify(daeForTemplate),
    templateSource: baseDaeTemplate,
    modelName,
    templatePath: 'base_dae.jinja',
    outputPath: `${modelName}.dae.txt`,
    targetName: 'template',
  })
  return {
    compiled,
    daeForTemplate,
    daePretty,
    rendered,
    modelName,
    usedLibraries: payload.useSourceRoots,
  }
}

function handleRenderModelicaView(payload: RenderModelicaViewPayload): unknown {
  if (payload.useSourceRoots) {
    materializeLibraryClasses([
      payload.modelName,
      ...referencedModelicaClassNames(payload.modelicaSource),
    ])
  }

  const renderModelicaView = Reflect.get(rumoca, 'render_modelica_view')
  if (typeof renderModelicaView !== 'function') {
    throw new Error('Installed Rumoca WASM package does not export render_modelica_view')
  }

  return {
    view: payload.view,
    rendered: String(renderModelicaView(payload.modelicaSource, payload.modelName, payload.view)),
  }
}

function handleLoadMslZip(payload: {
  fileName: string
  bytes: ArrayBuffer
  lazyIndex?: LazyModelicaLibraryIndex
}): unknown {
  const archive = unzipSync(new Uint8Array(payload.bytes))
  const lazyArchive = payload.lazyIndex
    ? {
        sources: buildLazyModelicaLibraryByteSources(archive),
        index: payload.lazyIndex,
      }
    : buildLazyModelicaLibraryByteArchive(archive)
  const fileCount = Object.keys(lazyArchive.sources).length
  if (fileCount === 0) {
    throw new Error('No usable .mo files found in archive')
  }
  loadedSourceRootFiles = {}
  loadedSourceRootBytes = lazyArchive.sources
  lazyLibraryIndex = lazyArchive.index
  materializedSourceRootUris = new Set()
  return {
    fileCount,
    parsedCount: 0,
    archiveName: payload.fileName,
    documentCount: getSourceRootDocumentCount(),
    loadMode: 'lazy-index',
    classCount: lazyArchive.index.totalClasses,
    sourceRootUris: lazyArchive.index.sourceRootUris,
    classes: lazyArchive.index.classes,
    lazyIndex: lazyArchive.index,
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
  const sourceRootUris = Object.keys(libraries).sort((lhs, rhs) => lhs.localeCompare(rhs))

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
  loadedSourceRootBytes = {}
  lazyLibraryIndex = null
  materializedSourceRootUris = new Set(Object.keys(loadedSourceRootFiles))
  return {
    fileCount,
    parsedCount: mergedCount,
    archiveName: payload.fileName,
    documentCount: getSourceRootDocumentCount(),
    loadMode: 'merge',
    sourceRootUris,
  }
}

function handleListClasses(): unknown {
  const startedAt = performance.now()
  if (lazyLibraryIndex) {
    const result = {
      total_classes: lazyLibraryIndex.totalClasses,
      classes: lazyLibraryIndex.classes,
    }
    console.info('[modelica-worker][list-classes] returned lazy index tree', {
      totalClasses: lazyLibraryIndex.totalClasses,
      rootNodeCount: lazyLibraryIndex.classes.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return result
  }
  const raw = rumoca.list_classes()
  const result = JSON.parse(String(raw))
  console.info('[modelica-worker][list-classes] returned rumoca class tree', {
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return result
}

function handleGetClassInfo(payload: { qualifiedName: string }): unknown {
  materializeLibraryClasses([payload.qualifiedName])
  let raw: string
  try {
    raw = rumoca.get_class_info(payload.qualifiedName)
  } catch (error) {
    if (!errorSuggestsMissingSourceRoot(error)) throw error
    materializeAllLibraries()
    raw = rumoca.get_class_info(payload.qualifiedName)
  }
  return JSON.parse(String(raw))
}

function handleExtractDiagramPreview(payload: {
  source: string
  qualifiedName?: string
  fileName?: string
}): unknown {
  return handleExtractDiagram(payload, () => loadedSourceRootFiles, isLibraryClassMaterialized)
}

function handleExtractDiagramFull(payload: {
  source: string
  qualifiedName?: string
  fileName?: string
}): unknown {
  const startedAt = performance.now()
  materializeLibraryClasses([
    asString(payload.qualifiedName),
    ...referencedModelicaClassNames(payload.source),
  ])

  for (let pass = 0; pass < 3; pass += 1) {
    const requested = new Set<string>()
    const refined = handleExtractDiagram(
      payload,
      () => loadedSourceRootFiles,
      (qualifiedName) => {
        if (isLibraryClassMaterialized(qualifiedName)) return true
        requested.add(qualifiedName)
        return false
      },
    )
    const missing = Array.from(requested).filter((qualifiedName) => {
      return !isLibraryClassMaterialized(qualifiedName)
    })
    if (missing.length === 0) return refined
    console.info('[modelica-worker][extract-diagram] materializing missing classes', {
      pass,
      missingCount: missing.length,
      missing,
    })
    materializeLibraryClasses(missing)
  }

  const result = handleExtractDiagram(
    payload,
    () => loadedSourceRootFiles,
    isLibraryClassMaterialized,
  )
  console.info('[modelica-worker][extract-diagram] finished', {
    qualifiedName: payload.qualifiedName,
    elapsedMs: Math.round(performance.now() - startedAt),
    materializedFileCount: materializedSourceRootUris.size,
  })
  return result
}

function handleMaterializeDiagramClasses(payload: {
  source: string
  qualifiedName?: string
  fileName?: string
}): unknown {
  const startedAt = performance.now()
  materializeLibraryClasses([
    asString(payload.qualifiedName),
    ...referencedModelicaClassNames(payload.source),
  ])

  let passCount = 0
  const requested = new Set<string>()
  const totalRequested = new Set<string>()
  for (let pass = 0; pass < 3; pass += 1) {
    passCount = pass + 1
    requested.clear()
    handleExtractDiagram(
      payload,
      () => loadedSourceRootFiles,
      (qualifiedName) => {
        if (isLibraryClassMaterialized(qualifiedName)) return true
        requested.add(qualifiedName)
        totalRequested.add(qualifiedName)
        return false
      },
    )
    const missing = Array.from(requested).filter((qualifiedName) => {
      return !isLibraryClassMaterialized(qualifiedName)
    })
    if (missing.length === 0) break
    console.info('[modelica-worker][materialize-diagram-classes] materializing missing classes', {
      pass,
      missingCount: missing.length,
      missing,
    })
    materializeLibraryClasses(missing)
  }

  const result = {
    materializedFileCount: materializedSourceRootUris.size,
    requestedClassCount: totalRequested.size,
    passCount,
  }
  console.info('[modelica-worker][materialize-diagram-classes] finished', {
    ...result,
    qualifiedName: payload.qualifiedName,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return result
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
    stripEquationSectionsForDiagramParse(
      normalizeLegacyDeclarationModifiersForDiagramParse(source),
    ),
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

function handleGetSimulationModels(payload: { source: string; defaultModel?: string }): unknown {
  if (typeof rumoca.get_simulation_models !== 'function') {
    throw new Error('Rumoca wasm export missing: get_simulation_models')
  }
  materializeLibraryClasses([
    asString(payload.defaultModel),
    ...referencedModelicaClassNames(payload.source),
  ])
  return JSON.parse(
    String(rumoca.get_simulation_models(payload.source, asString(payload.defaultModel))),
  ) as Record<string, unknown>
}

function handleStartSimulation(payload: {
  source: string
  modelName: string
  tEnd: number
  dt: number
  solver: string
}): Record<string, unknown> {
  if (typeof rumoca.simulate_model !== 'function') {
    throw new Error('Simulation not available in this WASM build. Rebuild with rumoca-sim enabled.')
  }
  materializeLibraryClasses([payload.modelName, ...referencedModelicaClassNames(payload.source)])
  const raw = String(
    rumoca.simulate_model(
      payload.source,
      payload.modelName,
      Number(payload.tEnd) || 0,
      Number(payload.dt) || 0,
      asString(payload.solver) || 'auto',
      '{}',
    ),
  )
  return JSON.parse(raw) as Record<string, unknown>
}

function handleGetBundledSourceRootManifest(): unknown {
  if (typeof rumoca.get_bundled_source_root_manifest !== 'function') {
    return { archives: [] }
  }
  return JSON.parse(String(rumoca.get_bundled_source_root_manifest()))
}

function handleLoadBundledSourceRootCache(payload: { archiveId: string }): unknown {
  if (typeof rumoca.load_bundled_source_root_cache !== 'function') {
    throw new Error('Rumoca wasm export missing: load_bundled_source_root_cache')
  }
  const archiveId = asString(payload.archiveId).trim()
  if (!archiveId) throw new Error('Missing bundled archive id')
  rumoca.load_bundled_source_root_cache(archiveId)
  loadedSourceRootFiles = {}
  loadedSourceRootBytes = {}
  lazyLibraryIndex = null
  materializedSourceRootUris = new Set()
  return {
    archiveId,
    documentCount: getSourceRootDocumentCount(),
  }
}

function handleExportSourceRootBinaryCache(payload: { uris: string[] }): Uint8Array {
  materializeAllLibraries()
  if (typeof rumoca.export_parsed_source_roots_binary !== 'function') {
    throw new Error('Rumoca wasm export missing: export_parsed_source_roots_binary')
  }
  const raw: unknown = rumoca.export_parsed_source_roots_binary(JSON.stringify(payload.uris))
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  throw new Error('Rumoca export_parsed_source_roots_binary returned an unsupported payload')
}

function handleRestoreSourceRootBinaryCache(payload: { bytes: ArrayBuffer }): number {
  const startedAt = performance.now()
  if (typeof rumoca.merge_parsed_source_roots_binary !== 'function') {
    throw new Error('Rumoca wasm export missing: merge_parsed_source_roots_binary')
  }
  loadedSourceRootFiles = {}
  loadedSourceRootBytes = {}
  lazyLibraryIndex = null
  materializedSourceRootUris = new Set()
  const restoredCount =
    Number(rumoca.merge_parsed_source_roots_binary(new Uint8Array(payload.bytes))) || 0
  console.info('[modelica-worker][restore-source-root-cache] finished', {
    restoredCount,
    byteLength: payload.bytes.byteLength,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return restoredCount
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
      case 'render_modelica_view':
        result = handleRenderModelicaView(msg.payload)
        break
      case 'load_msl_zip':
        result = handleLoadMslZip(msg.payload)
        break
      case 'merge_msl_zip':
        result = handleMergeMslZip(msg.payload)
        break
      case 'materialize_library_classes':
        result = materializeLibraryClasses(msg.payload.qualifiedNames)
        break
      case 'materialize_diagram_classes':
        result = handleMaterializeDiagramClasses(msg.payload)
        break
      case 'materialize_all_libraries':
        result = materializeAllLibraries()
        break
      case 'clear_libraries':
        rumoca.clear_source_root_cache()
        loadedSourceRootFiles = {}
        loadedSourceRootBytes = {}
        lazyLibraryIndex = null
        materializedSourceRootUris = new Set()
        result = { ok: true }
        break
      case 'list_classes':
        result = handleListClasses()
        break
      case 'get_class_info':
        result = handleGetClassInfo(msg.payload)
        break
      case 'extract_diagram':
        result = handleExtractDiagramFull(msg.payload)
        break
      case 'extract_diagram_preview':
        result = handleExtractDiagramPreview(msg.payload)
        break
      case 'parse_source_ast':
        result = handleParseSourceAst(msg.payload)
        break
      case 'lsp_completion_with_timing':
        result = handleLspCompletionWithTiming(msg.payload)
        break
      case 'get_simulation_models':
        result = handleGetSimulationModels(msg.payload)
        break
      case 'start_simulation':
        result = handleStartSimulation(msg.payload)
        break
      case 'get_bundled_source_root_manifest':
        result = handleGetBundledSourceRootManifest()
        break
      case 'load_bundled_source_root_cache':
        result = handleLoadBundledSourceRootCache(msg.payload)
        break
      case 'export_source_root_binary_cache':
        result = handleExportSourceRootBinaryCache(msg.payload)
        break
      case 'restore_source_root_binary_cache':
        result = handleRestoreSourceRootBinaryCache(msg.payload)
        break
      case 'get_source_root_document_count':
        result = getSourceRootDocumentCount()
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
