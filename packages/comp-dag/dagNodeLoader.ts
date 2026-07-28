import type * as ts from 'typescript'
import type { Hash } from './caching.ts'
import { SELF_HASH_PLACEHOLDER, hashFilePart, hashFromFilePart } from './dagNodeIdentity.ts'
import type {
  DagNodeInputRefOneOf,
  DagNodeInputRefSingle,
  DagNodeRecord,
  DagNodeRecordInputRef,
  DagNodeRecordStructure,
} from './dagNodeRecord.ts'
import { hashDagNodeRecordInput } from './dagNodeRecord.ts'
import type { DagJsonSchema } from './dagSchema.ts'

export type StoredDagNodeDefinition = Omit<DagNodeRecord, 'id' | 'run'> & {
  id: Hash | typeof SELF_HASH_PLACEHOLDER
}

export type StoredGraphNodeFile = {
  path: string
  source: string
}

export type SavedStoredGraphNode = {
  hash: Hash
  node: DagNodeRecord
  file: StoredGraphNodeFile
  normalizedSource: string
}

type ParsedNodeFields = {
  formatVersion: 2
  id: string
  localName: string
  label: string
  version: number
  timeoutMs?: number
  structure?: unknown
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  inputs?: unknown
  hiddenInputs?: unknown
  exposedInputs?: unknown
  runSource: string
  runCode: string
}

type PrettierPlugin = object
type PrettierStandaloneModule = {
  format: (
    source: string,
    options: {
      parser: 'typescript'
      plugins: PrettierPlugin[]
      semi: boolean
      singleQuote: boolean
      printWidth: number
      trailingComma: 'all'
    },
  ) => string | Promise<string>
}

export const storedGraphNodeFileName = (node: { localName: string; id: Hash }): string =>
  `${node.localName}.${hashFilePart(node.id)}.ts`

export const parseStoredGraphNodeHashFromPath = (path: string): Hash | null => {
  const filename = path.split('/').at(-1) ?? path
  const match = /(?:^|\.)(sha256_[A-Za-z0-9_-]+)\.ts$/.exec(filename)
  return match?.[1] ? hashFromFilePart(match[1]) : null
}

const loadTypescript = async (): Promise<typeof ts> => await import('typescript')

const formatTypeScript = async (source: string): Promise<string> => {
  const prettier = (await import('prettier/standalone')) as PrettierStandaloneModule
  const estreePlugin = (await import('prettier/plugins/estree')) as PrettierPlugin
  const typescriptPlugin = (await import('prettier/plugins/typescript')) as PrettierPlugin
  return await prettier.format(source, {
    parser: 'typescript',
    plugins: [typescriptPlugin, estreePlugin],
    semi: false,
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
  })
}

const propertyNameText = (tsModule: typeof ts, name: ts.PropertyName): string | null => {
  if (
    tsModule.isIdentifier(name) ||
    tsModule.isStringLiteral(name) ||
    tsModule.isNumericLiteral(name)
  ) {
    return name.text
  }
  return null
}

const stripExpression = (tsModule: typeof ts, node: ts.Expression): ts.Expression => {
  if (tsModule.isParenthesizedExpression(node)) return stripExpression(tsModule, node.expression)
  if (tsModule.isAsExpression(node)) return stripExpression(tsModule, node.expression)
  if (tsModule.isSatisfiesExpression(node)) return stripExpression(tsModule, node.expression)
  return node
}

const parseLiteralValue = (tsModule: typeof ts, node: ts.Expression): unknown => {
  const expression = stripExpression(tsModule, node)
  if (
    tsModule.isStringLiteral(expression) ||
    tsModule.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text
  }
  if (tsModule.isNumericLiteral(expression)) return Number(expression.text)
  if (expression.kind === tsModule.SyntaxKind.TrueKeyword) return true
  if (expression.kind === tsModule.SyntaxKind.FalseKeyword) return false
  if (expression.kind === tsModule.SyntaxKind.NullKeyword) return null
  if (tsModule.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => parseLiteralValue(tsModule, element))
  }
  if (tsModule.isObjectLiteralExpression(expression)) {
    const out: Record<string, unknown> = {}
    for (const prop of expression.properties) {
      if (!tsModule.isPropertyAssignment(prop)) {
        throw new Error('Stored graph node objects only support property assignments')
      }
      const name = propertyNameText(tsModule, prop.name)
      if (!name) throw new Error('Stored graph node object has unsupported property name')
      out[name] = parseLiteralValue(tsModule, prop.initializer)
    }
    return out
  }
  throw new Error(`Stored graph node has unsupported literal expression: ${expression.getText()}`)
}

const parseStringField = (
  tsModule: typeof ts,
  fields: Map<string, ts.Expression>,
  name: string,
): string => {
  const value = fields.get(name)
  if (!value) throw new Error(`Stored graph node is missing required field "${name}"`)
  const parsed = parseLiteralValue(tsModule, value)
  if (typeof parsed !== 'string')
    throw new Error(`Stored graph node field "${name}" must be string`)
  return parsed
}

const parseNumberField = (
  tsModule: typeof ts,
  fields: Map<string, ts.Expression>,
  name: string,
): number => {
  const value = fields.get(name)
  if (!value) throw new Error(`Stored graph node is missing required field "${name}"`)
  const parsed = parseLiteralValue(tsModule, value)
  if (typeof parsed !== 'number')
    throw new Error(`Stored graph node field "${name}" must be number`)
  return parsed
}

const parseOptionalNumberField = (
  tsModule: typeof ts,
  fields: Map<string, ts.Expression>,
  name: string,
): number | undefined => {
  const value = fields.get(name)
  if (!value) return undefined
  const parsed = parseLiteralValue(tsModule, value)
  if (typeof parsed !== 'number')
    throw new Error(`Stored graph node field "${name}" must be number`)
  return parsed
}

const parseOptionalLiteralField = (
  tsModule: typeof ts,
  fields: Map<string, ts.Expression>,
  name: string,
): unknown => {
  const value = fields.get(name)
  return value ? parseLiteralValue(tsModule, value) : undefined
}

const objectEntries = (value: unknown, fieldName: string): [string, unknown][] => {
  if (value === undefined) return []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Stored graph node field "${fieldName}" must be an object`)
  }
  return Object.entries(value)
}

const parseHash = (value: unknown, fieldName: string): Hash => {
  if (typeof value !== 'string' || !/^sha256:[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Stored graph node ${fieldName} must be a sha256 hash`)
  }
  return value as Hash
}

const parseSingleInputRef = (value: unknown, fieldName: string): DagNodeInputRefSingle => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Stored graph node ${fieldName} input ref must be an object`)
  }
  const nodeId = (value as { nodeId?: unknown }).nodeId
  return { nodeId: parseHash(nodeId, `${fieldName}.nodeId`) }
}

const parseInputRefs = (value: unknown): Record<string, DagNodeInputRefSingle> => {
  const out: Record<string, DagNodeInputRefSingle> = {}
  for (const [alias, ref] of objectEntries(value, 'hiddenInputs')) {
    out[alias] = parseSingleInputRef(ref, `hiddenInputs.${alias}`)
  }
  return out
}

const parseExposedInputRefs = (
  value: unknown,
): Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf> => {
  const out: Record<string, DagNodeInputRefSingle | DagNodeInputRefOneOf> = {}
  for (const [alias, ref] of objectEntries(value, 'exposedInputs')) {
    if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
      const maybeKind = (ref as { kind?: unknown }).kind
      const maybeNodeIds = (ref as { nodeIds?: unknown }).nodeIds
      if (maybeKind === 'oneOf') {
        if (!Array.isArray(maybeNodeIds)) {
          throw new Error(`Stored graph node exposedInputs.${alias} oneOf must include nodeIds`)
        }
        out[alias] = {
          kind: 'oneOf',
          nodeIds: maybeNodeIds.map((nodeId, index) =>
            parseHash(nodeId, `exposedInputs.${alias}.nodeIds.${index}`),
          ),
        }
        continue
      }
    }
    out[alias] = parseSingleInputRef(ref, `exposedInputs.${alias}`)
  }
  return out
}

const parseRecordInputRefs = (value: unknown): Record<string, DagNodeRecordInputRef> => {
  const out: Record<string, DagNodeRecordInputRef> = {}
  for (const [alias, ref] of objectEntries(value, 'inputs')) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
      throw new Error(`Stored graph node inputs.${alias} must be an object`)
    }
    const role = (ref as { role?: unknown }).role
    if (role !== 'internal' && role !== 'exposed') {
      throw new Error(`Stored graph node inputs.${alias}.role must be internal or exposed`)
    }
    if ((ref as { kind?: unknown }).kind === 'oneOf') {
      if (role !== 'exposed') {
        throw new Error(`Stored graph node inputs.${alias} oneOf must use exposed role`)
      }
      const nodeIds = (ref as { nodeIds?: unknown }).nodeIds
      if (!Array.isArray(nodeIds)) {
        throw new Error(`Stored graph node inputs.${alias} oneOf must include nodeIds`)
      }
      out[alias] = {
        kind: 'oneOf',
        role,
        nodeIds: nodeIds.map((nodeId, index) =>
          parseHash(nodeId, `inputs.${alias}.nodeIds.${index}`),
        ),
      }
    } else {
      const nodeId = (ref as { nodeId?: unknown }).nodeId
      out[alias] = {
        nodeId: parseHash(nodeId, `inputs.${alias}.nodeId`),
        role,
      }
    }
  }
  return out
}

const parseDagJsonSchema = (value: unknown, fieldName: string): DagJsonSchema => {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DagJsonSchema
  throw new Error(`Stored graph node field "${fieldName}" must be a JSON schema`)
}

const parseNodeStructure = (value: unknown): DagNodeRecordStructure | undefined => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored graph node field "structure" must be an object')
  }
  const structure = value as { kind?: unknown; sourceAlias?: unknown; path?: unknown }
  if (
    structure.kind !== 'explode' ||
    typeof structure.sourceAlias !== 'string' ||
    !structure.sourceAlias ||
    typeof structure.path !== 'string' ||
    !structure.path
  ) {
    throw new Error('Stored graph node explode structure requires sourceAlias and path')
  }
  return {
    kind: 'explode',
    sourceAlias: structure.sourceAlias,
    path: structure.path,
  }
}

const extractTranspiledExpression = (
  tsModule: typeof ts,
  source: string,
  sourceFileName: string,
): string => {
  const sourceFile = tsModule.createSourceFile(
    sourceFileName,
    source,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.JS,
  )
  const statement = sourceFile.statements.find(tsModule.isVariableStatement)
  const declaration = statement?.declarationList.declarations[0]
  if (!declaration?.initializer) {
    throw new Error('Stored graph node run function failed to transpile')
  }
  return stripExpression(tsModule, declaration.initializer).getText(sourceFile)
}

const transpileRunSource = (tsModule: typeof ts, runSource: string): string => {
  const source = `const run = ${runSource}\n`
  const transpiled = tsModule.transpileModule(source, {
    compilerOptions: {
      target: tsModule.ScriptTarget.ES2022,
      module: tsModule.ModuleKind.ESNext,
      removeComments: false,
      typeRoots: [],
    },
    fileName: 'stored-graph-node-run.ts',
  })
  return extractTranspiledExpression(tsModule, transpiled.outputText, 'stored-graph-node-run.js')
}

const findDefaultExportObject = (
  tsModule: typeof ts,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression => {
  for (const statement of sourceFile.statements) {
    if (!tsModule.isExportAssignment(statement)) continue
    const expression = stripExpression(tsModule, statement.expression)
    if (tsModule.isObjectLiteralExpression(expression)) return expression
  }
  throw new Error('Stored graph node must use "export default { ... }"')
}

const parseSourceFields = async (source: string): Promise<ParsedNodeFields> => {
  const tsModule = await loadTypescript()
  const sourceFile = tsModule.createSourceFile(
    'stored-graph-node.ts',
    source,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.TS,
  )
  const object = findDefaultExportObject(tsModule, sourceFile)
  const fields = new Map<string, ts.Expression>()
  for (const prop of object.properties) {
    if (!tsModule.isPropertyAssignment(prop)) {
      throw new Error('Stored graph node default export only supports property assignments')
    }
    const name = propertyNameText(tsModule, prop.name)
    if (!name) throw new Error('Stored graph node has unsupported top-level property name')
    fields.set(name, prop.initializer)
  }

  const run = fields.get('run')
  if (!run) throw new Error('Stored graph node is missing required field "run"')

  const timeoutMs = parseOptionalNumberField(tsModule, fields, 'timeoutMs')
  const formatVersion = parseNumberField(tsModule, fields, 'formatVersion')
  if (formatVersion !== 2) {
    throw new Error(`Stored graph node formatVersion must be 2, received ${formatVersion}`)
  }
  return {
    formatVersion,
    id: parseStringField(tsModule, fields, 'id'),
    localName: parseStringField(tsModule, fields, 'localName'),
    label: parseStringField(tsModule, fields, 'label'),
    version: parseNumberField(tsModule, fields, 'version'),
    ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
    structure: parseOptionalLiteralField(tsModule, fields, 'structure'),
    localParamsSchema: parseDagJsonSchema(
      parseOptionalLiteralField(tsModule, fields, 'localParamsSchema') ?? {},
      'localParamsSchema',
    ),
    outputSchema: parseDagJsonSchema(
      parseOptionalLiteralField(tsModule, fields, 'outputSchema') ?? {},
      'outputSchema',
    ),
    inputs: parseOptionalLiteralField(tsModule, fields, 'inputs'),
    hiddenInputs: parseOptionalLiteralField(tsModule, fields, 'hiddenInputs'),
    exposedInputs: parseOptionalLiteralField(tsModule, fields, 'exposedInputs'),
    runSource: stripExpression(tsModule, run).getText(sourceFile),
    runCode: transpileRunSource(tsModule, stripExpression(tsModule, run).getText(sourceFile)),
  }
}

const sortedObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortedObject((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

const jsLiteral = (value: unknown): string => JSON.stringify(sortedObject(value), null, 2)

const emitField = (name: string, value: unknown): string => `  ${name}: ${jsLiteral(value)},\n`

const emitStoredGraphNodeSource = (node: StoredDagNodeDefinition): string => {
  let source = `export default {\n`
  source += emitField('formatVersion', node.formatVersion)
  source += emitField('id', node.id)
  source += emitField('localName', node.localName)
  source += emitField('label', node.label)
  source += emitField('version', node.version)
  if (typeof node.timeoutMs === 'number') source += emitField('timeoutMs', node.timeoutMs)
  if (node.structure) source += emitField('structure', node.structure)
  source += emitField('localParamsSchema', node.localParamsSchema)
  source += emitField('outputSchema', node.outputSchema)
  if (node.inputs) {
    source += emitField('inputs', node.inputs)
  } else {
    source += emitField('hiddenInputs', node.hiddenInputs ?? {})
    source += emitField('exposedInputs', node.exposedInputs ?? {})
  }
  source += `  run: ${node.runSource},\n`
  source += `}\n`
  return source
}

const toStoredGraphNodeDefinition = (fields: ParsedNodeFields): StoredDagNodeDefinition => {
  const structure = parseNodeStructure(fields.structure)
  return {
    formatVersion: fields.formatVersion,
    id: fields.id === SELF_HASH_PLACEHOLDER ? SELF_HASH_PLACEHOLDER : (fields.id as Hash),
    localName: fields.localName,
    label: fields.label,
    version: fields.version,
    ...(typeof fields.timeoutMs === 'number' ? { timeoutMs: fields.timeoutMs } : {}),
    ...(structure ? { structure } : {}),
    localParamsSchema: fields.localParamsSchema,
    outputSchema: fields.outputSchema,
    ...(fields.inputs !== undefined
      ? { inputs: parseRecordInputRefs(fields.inputs) }
      : {
          hiddenInputs: parseInputRefs(fields.hiddenInputs),
          exposedInputs: parseExposedInputRefs(fields.exposedInputs),
        }),
    runSource: fields.runSource,
    runCode: fields.runCode,
  }
}

const hashStoredGraphNodeDefinition = async (node: StoredDagNodeDefinition): Promise<Hash> => {
  return await hashDagNodeRecordInput({
    formatVersion: node.formatVersion,
    localName: node.localName,
    label: node.label,
    version: node.version,
    ...(typeof node.timeoutMs === 'number' ? { timeoutMs: node.timeoutMs } : {}),
    ...(node.structure ? { structure: node.structure } : {}),
    localParamsSchema: node.localParamsSchema,
    outputSchema: node.outputSchema,
    ...(node.inputs ? { inputs: node.inputs } : {}),
    ...(node.hiddenInputs ? { hiddenInputs: node.hiddenInputs } : {}),
    ...(node.exposedInputs ? { exposedInputs: node.exposedInputs } : {}),
    runSource: node.runSource,
    ...(node.staticDependencyFingerprint
      ? { staticDependencyFingerprint: node.staticDependencyFingerprint }
      : {}),
  })
}

export const normalizeStoredGraphNodeSource = async (
  source: string,
  opts?: { id?: Hash | typeof SELF_HASH_PLACEHOLDER },
): Promise<{
  node: StoredDagNodeDefinition
  source: string
}> => {
  const parsed = toStoredGraphNodeDefinition(await parseSourceFields(source))
  const node = { ...parsed, id: opts?.id ?? parsed.id }
  return {
    node,
    source: await formatTypeScript(emitStoredGraphNodeSource(node)),
  }
}

export const hashStoredGraphNodeSource = async (source: string): Promise<Hash> => {
  const normalized = await normalizeStoredGraphNodeSource(source, {
    id: SELF_HASH_PLACEHOLDER,
  })
  return await hashStoredGraphNodeDefinition(normalized.node)
}

export const saveStoredGraphNodeSource = async (
  source: string,
  opts?: { directory?: string },
): Promise<SavedStoredGraphNode> => {
  const placeholder = await normalizeStoredGraphNodeSource(source, {
    id: SELF_HASH_PLACEHOLDER,
  })
  const hash = await hashStoredGraphNodeDefinition(placeholder.node)
  const final = await normalizeStoredGraphNodeSource(source, { id: hash })
  const rehashed = await hashStoredGraphNodeSource(final.source)
  if (rehashed !== hash) {
    throw new Error(`Stored graph node ${final.node.localName}: normalized hash changed after save`)
  }
  const node = { ...final.node, id: hash }
  const filename = storedGraphNodeFileName(node)
  const path = opts?.directory ? `${opts.directory.replace(/\/$/, '')}/${filename}` : filename
  return {
    hash,
    node,
    file: { path, source: final.source },
    normalizedSource: placeholder.source,
  }
}

export const loadStoredGraphNodeFile = async (
  file: StoredGraphNodeFile,
): Promise<SavedStoredGraphNode> => {
  if (!file.path.endsWith('.ts')) {
    throw new Error(`Stored graph node ${file.path}: only .ts node files are supported`)
  }
  const normalized = await normalizeStoredGraphNodeSource(file.source)
  const hash = await hashStoredGraphNodeSource(file.source)
  if (normalized.node.id !== hash) {
    throw new Error(
      `Stored graph node ${file.path}: node id ${normalized.node.id} does not match normalized hash ${hash}`,
    )
  }
  const filenameHash = parseStoredGraphNodeHashFromPath(file.path)
  if (filenameHash && filenameHash !== hash) {
    throw new Error(
      `Stored graph node ${file.path}: filename hash ${filenameHash} does not match normalized hash ${hash}`,
    )
  }
  return {
    hash,
    node: { ...normalized.node, id: hash },
    file,
    normalizedSource: (
      await normalizeStoredGraphNodeSource(file.source, {
        id: SELF_HASH_PLACEHOLDER,
      })
    ).source,
  }
}

export const loadStoredGraphNodeFiles = async (
  files: readonly StoredGraphNodeFile[],
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  const out: Record<Hash, SavedStoredGraphNode> = {}
  for (const file of files) {
    const loaded = await loadStoredGraphNodeFile(file)
    out[loaded.hash] = loaded
  }
  return out
}
