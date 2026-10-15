import { compileDesignGraphSources, isDesignGraphSourceBundle } from './designGraphSources.ts'
import { z } from 'zod'
import { canonicalHash, type Hash } from './caching.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import {
  defineDagNodeRecord,
  getDagStructuralDefinitionHash,
  type DagNodeRecord,
  type DagNodeRecordInputRef,
} from './dagNodeRecord.ts'
import {
  formatDagTypeScript,
  parseDagDeclaration,
  parseDagJsonSchema,
  rewriteDagDeclaration,
  saveStoredGraphNodeRecord,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'
import { hashFilePart } from './dagNodeIdentity.ts'
import { createGraphRevision, type GraphRevision } from './designGraphModel.ts'
import {
  createDesignGraphRepository,
  putImmutableDesignGraphText,
  putImmutableDesignGraphObject,
  type DesignGraphObjectStore,
} from './designGraphRepository.ts'
import type { DagProjectedFile } from './dagGitProjection.ts'
import { schemaAtPath, schemaArrayElement, type DagJsonSchema } from './dagSchema.ts'

const contract = () => z.unknown().transform((value) => parseDagJsonSchema(value, 'contract'))
const identifier = () =>
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_/-]*$/)
    .refine(
      (value) => !['__proto__', 'prototype', 'constructor'].includes(value),
      'Reserved graph identifier.',
    )
const sourceExpression = () =>
  z
    .object({
      source: identifier(),
      role: z.enum(['internal', 'exposed']).optional(),
      path: z.string().min(1).optional(),
      explode: z.string().min(1).optional(),
    })
    .strict()
    .refine((value) => !(value.path && value.explode), 'Use one input operation.')

const choiceExpression = () =>
  z
    .object({
      sources: z.record(identifier(), identifier()),
      choose: z.object({ parameter: identifier(), default: identifier() }).strict(),
    })
    .strict()

export type DagInputExpression =
  | z.infer<ReturnType<typeof sourceExpression>>
  | z.infer<ReturnType<typeof choiceExpression>>
const authoredBindingSchema = () =>
  z
    .object({
      inputs: z.record(identifier(), z.union([sourceExpression(), choiceExpression()])).default({}),
      label: z.string().optional(),
      settings: z
        .object({ path: z.string().min(1) })
        .strict()
        .optional(),
    })
    .strict()
export type DagAuthoredBinding = z.infer<ReturnType<typeof authoredBindingSchema>>
export type DagAuthoredDefinition = {
  hash: Hash
  path: string
  source: string
  bindings: Record<string, DagAuthoredBinding>
  node: Omit<DagNodeRecord, 'id' | 'localName' | 'label' | 'inputs'>
  inputsSchema: Record<string, DagJsonSchema>
}
export type DagGraphLock = {
  schemaVersion: 3
  id: Hash
  resolver: 'taskyon.graph-authoring.v1'
  nodeSources: Record<string, Hash>
  bindings: Record<string, Hash>
  unboundNodes: Hash[]
}

export const assertGraphRevisionMatchesAuthoringLock = (
  revision: Pick<GraphRevision, 'authoringLockId' | 'nodes'>,
  lock: DagGraphLock,
) => {
  if (
    revision.authoringLockId !== lock.id ||
    canonicalHash(revision.nodes) !== canonicalHash(lock.bindings)
  )
    throw new Error('Graph revision does not match its authoring lock.')
}

const declarationSchema = () =>
  z
    .object({
      formatVersion: z.literal(3),
      version: z.number().int().positive().default(1),
      definition: z.literal('taskyon:explode').optional(),
      localParamsSchema: contract().default({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      inputsSchema: z.record(z.string(), contract()).default({}),
      outputSchema: contract().default(true),
      effect: z.enum(['pure', 'source']).optional(),
      capabilities: z.array(z.string()).optional(),
      timeoutMs: z.number().positive().optional(),
      moduleLockId: z
        .custom<Hash>(
          (value) => typeof value === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(value),
        )
        .optional(),
      ids: z.record(identifier(), authoredBindingSchema()),
      run: z.literal(true).optional(),
    })
    .strict()

export const parseAuthoredGraphDefinition = async (
  file: StoredGraphNodeFile,
): Promise<DagAuthoredDefinition> => {
  const source = await formatDagTypeScript(file.source)
  const parsed = await parseDagDeclaration(source)
  const declaration = declarationSchema().safeParse(parsed.fields)
  if (!declaration.success)
    throw new Error(
      `Invalid authored definition. Connections belong in ids.<binding>.inputs and use objects such as { source: 'existingBindingId' }; input contracts belong in inputsSchema. ${declaration.error.message}`,
    )
  const fields = declaration.data
  if (
    fields.definition &&
    Object.keys(parsed.fields).some((key) => !['formatVersion', 'definition', 'ids'].includes(key))
  )
    throw new Error(
      'Built-ins declare only formatVersion, definition and ids; their contracts and implementation are derived.',
    )
  if (Object.keys(fields.ids).length === 0)
    throw new Error('A definition requires at least one binding.')
  if (!fields.definition && !parsed.runSource)
    throw new Error('An ordinary definition requires run.')
  if (!fields.definition && parsed.fields.outputSchema === undefined)
    throw new Error('An ordinary definition requires an explicit output contract.')
  if (fields.definition && parsed.runSource)
    throw new Error('Built-ins must not declare placeholder code.')
  if (parsed.importSpecifiers?.length && !fields.moduleLockId)
    throw new Error('Imports require an exact module lock.')
  const node = {
    formatVersion: 3 as const,
    version: fields.version,
    localParamsSchema: fields.localParamsSchema,
    outputSchema: fields.outputSchema,
    runSource: parsed.runSource ?? '',
    ...(fields.effect ? { effect: fields.effect } : {}),
    ...(fields.capabilities ? { capabilities: fields.capabilities } : {}),
    ...(fields.timeoutMs ? { timeoutMs: fields.timeoutMs } : {}),
    ...(fields.moduleLockId ? { moduleLockId: fields.moduleLockId } : {}),
    ...(parsed.importsSource ? { importsSource: parsed.importsSource } : {}),
    ...(parsed.preambleSource ? { preambleSource: parsed.preambleSource } : {}),
  }
  const hash = canonicalHash({
    kind: 'taskyon.dagDefinition.v1',
    ...node,
    inputsSchema: fields.inputsSchema,
    builtin: fields.definition ?? null,
  })
  return {
    hash,
    path: file.path,
    source,
    bindings: fields.ids,
    node,
    inputsSchema: fields.inputsSchema,
  }
}

const comparableSchema = (schema: DagJsonSchema): unknown => {
  if (typeof schema === 'boolean') return schema
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== 'description' && key !== 'title'),
  )
}

const requireCompatible = (expected: DagJsonSchema, actual: DagJsonSchema, alias: string) => {
  if (expected === true) return
  if (canonicalJson(comparableSchema(expected)) !== canonicalJson(comparableSchema(actual))) {
    const previewLength = 2000
    throw new Error(
      `Input ${alias} requires compatible contracts; use an explicit adapter. ` +
        `Expected input schema: ${canonicalJson(comparableSchema(expected)).slice(0, previewLength)}. ` +
        `Producer output schema: ${canonicalJson(comparableSchema(actual)).slice(0, previewLength)}. ` +
        `Use inspectGraph to inspect the upstream outputSchema, then match its full contract or add an adapter. ` +
        `Each schema preview is limited to ${previewLength} characters.`,
    )
  }
}

export const resolveAuthoredGraph = async (files: readonly StoredGraphNodeFile[]) => {
  if (new Set(files.map((file) => file.path)).size !== files.length)
    throw new Error('A graph declaration path must have one owner.')
  const definitions = await Promise.all(files.map(parseAuthoredGraphDefinition))
  const byBinding = new Map<
    string,
    { definition: DagAuthoredDefinition; binding: DagAuthoredBinding }
  >()
  for (const definition of definitions)
    for (const [id, binding] of Object.entries(definition.bindings)) {
      if (byBinding.has(id)) throw new Error(`Duplicate graph binding ${id}.`)
      byBinding.set(id, { definition, binding })
    }
  const bindings: Record<string, Hash> = {}
  const resolvedNodes: Record<Hash, DagNodeRecord> = {}
  const resolving = new Set<string>()
  const remember = (node: DagNodeRecord) => {
    const canonical = { ...node, localName: node.id, label: node.id }
    resolvedNodes[node.id] ??= canonical
    return canonical
  }
  const structural = async (
    structure: NonNullable<DagNodeRecord['structure']>,
    inputs: Record<string, DagNodeRecordInputRef>,
    outputSchema: DagJsonSchema,
  ) =>
    remember(
      await defineDagNodeRecord({
        formatVersion: 3,
        localName: structure.kind,
        label: structure.kind,
        version: 1,
        definitionHash: getDagStructuralDefinitionHash(structure.kind),
        structure,
        inputs,
        localParamsSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema:
          typeof outputSchema === 'object' && !outputSchema.description
            ? { ...outputSchema, description: `Derived ${structure.kind} output.` }
            : outputSchema,
        runSource: '',
      }),
    )

  const resolveExpression = async (
    expression: DagInputExpression,
  ): Promise<{ node: DagNodeRecord; role: 'internal' | 'exposed' }> => {
    if ('sources' in expression) {
      const names = Object.keys(expression.sources).sort()
      if (!names.includes(expression.choose.default))
        throw new Error('Choice default must name a provider.')
      if (expression.choose.parameter === 'providers')
        throw new Error('Choice parameter conflicts with provider namespace.')
      const providers = await Promise.all(
        names.map(async (name) => [name, await resolve(expression.sources[name]!)] as const),
      )
      const schema = providers[0]?.[1].outputSchema
      if (schema === undefined) throw new Error('A choice requires providers.')
      providers.forEach(([name, node]) => requireCompatible(schema, node.outputSchema, name))
      const node = await structural(
        { kind: 'choose', ...expression.choose },
        Object.fromEntries(
          providers.map(([name, node]) => [name, { nodeId: node.id, role: 'internal' }]),
        ),
        schema,
      )
      return { node, role: 'exposed' }
    }
    const source = await resolve(expression.source)
    const path = expression.explode ?? expression.path
    if (!path) return { node: source, role: expression.role ?? 'internal' }
    const selected = schemaAtPath(source.outputSchema, path)
    if (!selected) throw new Error(`Unknown output path ${expression.source}.${path}.`)
    const schema = expression.explode ? schemaArrayElement(selected) : selected
    if (!schema) throw new Error('Explode requires an array output contract.')
    const node = await structural(
      { kind: expression.explode ? 'explode' : 'select', sourceAlias: 'source', path },
      { source: { nodeId: source.id, role: 'internal' } },
      schema,
    )
    return { node, role: expression.explode ? 'exposed' : (expression.role ?? 'internal') }
  }

  const resolve = async (id: string): Promise<DagNodeRecord> => {
    const existing = bindings[id]
    if (existing) return resolvedNodes[existing]!
    if (resolving.has(id)) throw new Error(`Cyclic graph binding ${id}.`)
    const entry = byBinding.get(id)
    if (!entry) throw new Error(`Missing graph binding ${id}.`)
    resolving.add(id)
    const { definition, binding } = entry
    const inputs: Record<string, DagNodeRecordInputRef> = {}
    for (const [alias, expression] of Object.entries(binding.inputs)) {
      const resolved = await resolveExpression(expression)
      const expected = definition.inputsSchema[alias]
      if (expected !== undefined)
        requireCompatible(expected, resolved.node.outputSchema, `${id}.${alias}`)
      inputs[alias] = { nodeId: resolved.node.id, role: resolved.role }
    }
    for (const alias of Object.keys(definition.inputsSchema))
      if (!inputs[alias]) throw new Error(`Missing input ${id}.${alias}.`)
    let node: DagNodeRecord
    if (binding.settings) {
      if (definition.node.runSource || Object.keys(inputs).join() !== 'source')
        throw new Error('Explode declarations require only a source binding.')
      const sourceRef = inputs.source!
      if ('kind' in sourceRef) throw new Error('Explode requires a single source.')
      const source = resolvedNodes[sourceRef.nodeId]!
      const selected = schemaAtPath(source.outputSchema, binding.settings.path)
      const element = selected ? schemaArrayElement(selected) : null
      if (!element) throw new Error('Explode requires an array output contract.')
      node = await structural(
        { kind: 'explode', sourceAlias: 'source', path: binding.settings.path },
        inputs,
        element,
      )
    } else {
      if (!definition.node.runSource) throw new Error('A named explode requires path settings.')
      node = remember(
        await defineDagNodeRecord({
          ...definition.node,
          definitionHash: definition.hash,
          localName: id,
          label: binding.label ?? id,
          inputs,
        }),
      )
    }
    bindings[id] = node.id
    resolving.delete(id)
    return node
  }
  for (const id of [...byBinding.keys()].sort()) await resolve(id)
  const boundHashes = new Set(Object.values(bindings))
  const locked = {
    schemaVersion: 3 as const,
    resolver: 'taskyon.graph-authoring.v1' as const,
    nodeSources: Object.fromEntries(
      definitions.map((definition) => [definition.path, canonicalHash(definition.source)]),
    ),
    bindings: { ...bindings },
    unboundNodes: Object.values(resolvedNodes)
      .map((node) => node.id)
      .filter((nodeHash) => !boundHashes.has(nodeHash))
      .sort(),
  }
  const lock: DagGraphLock = {
    ...locked,
    id: canonicalHash({ kind: 'taskyon.graphLock.v3', ...locked }),
  }
  const bindingLabels = Object.fromEntries(
    [...byBinding].map(([id, { binding }]) => [id, binding.label ?? id]),
  )
  return { lock, bindings, resolvedNodes, definitions, bindingLabels }
}

/** Explicit, one-time conversion of resolved records; this is not an authoring compatibility reader. */
export const convertGraphRecordsToAuthoring = async (
  records: readonly DagNodeRecord[],
): Promise<StoredGraphNodeFile[]> => {
  const names = new Map(records.map((record) => [record.id, record.localName]))
  const byHash = new Map(records.map((record) => [record.id, record]))
  return await Promise.all(
    records
      .filter((record) => !record.structure)
      .map(async (record) => {
        const inputs: Record<string, DagInputExpression> = {}
        for (const [alias, ref] of Object.entries(record.inputs ?? {})) {
          const ids = 'kind' in ref ? ref.nodeIds : [ref.nodeId]
          const sourceNames = ids.map((hash) => {
            const name = names.get(hash)
            if (!name) throw new Error(`Cannot convert missing input ${hash}.`)
            return name
          })
          const upstream = byHash.get(ids[0]!)
          const expanded = upstream?.structure?.kind === 'explode' ? upstream.structure : undefined
          const sourceRef = expanded ? upstream!.inputs?.[expanded.sourceAlias] : undefined
          inputs[alias] =
            sourceNames.length === 1
              ? expanded && sourceRef && !('kind' in sourceRef)
                ? { source: names.get(sourceRef.nodeId)!, explode: expanded.path }
                : { source: sourceNames[0]!, role: ref.role }
              : {
                  sources: Object.fromEntries(sourceNames.map((name) => [name, name])),
                  choose: { parameter: 'provider', default: sourceNames[0]! },
                }
        }
        const saved = await saveStoredGraphNodeRecord(record)
        const updates: Record<string, string | undefined> = {
          formatVersion: '3',
          id: undefined,
          localName: undefined,
          label: undefined,
          definitionHash: undefined,
          inputs: undefined,
          hiddenInputs: undefined,
          exposedInputs: undefined,
          structure: undefined,
          ids: JSON.stringify({
            [record.localName]: {
              label: record.label,
              inputs,
            },
          }),
        }
        return {
          path: `nodes/${record.localName}.ts`,
          source: await rewriteDagDeclaration(saved.file.source, updates),
        }
      }),
  )
}

export const validateGraphLock = async (files: readonly StoredGraphNodeFile[], lock: unknown) => {
  const parsed = parseGraphLock(lock)
  const resolved = await resolveAuthoredGraph(files)
  if (canonicalJson(parsed) !== canonicalJson(resolved.lock))
    throw new Error('Graph lock is stale or its content identity is invalid.')
  return resolved
}

export const parseGraphLock = (value: unknown): DagGraphLock => {
  if (!z.object({ schemaVersion: z.literal(3) }).safeParse(value).success)
    throw new Error(
      'Unsupported graph lock format. Run graph:lock to rebuild from authored sources.',
    )
  const hash = z.custom<Hash>(
    (input) => typeof input === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(input),
  )
  const parsed = z
    .object({
      schemaVersion: z.literal(3),
      id: hash,
      resolver: z.literal('taskyon.graph-authoring.v1'),
      nodeSources: z.record(z.string(), hash),
      bindings: z.record(z.string(), hash),
      unboundNodes: z
        .array(hash)
        .refine(
          (hashes) => hashes.every((value, index) => index === 0 || hashes[index - 1]! < value),
          'Unbound node hashes must be sorted and unique.',
        ),
    })
    .strict()
    .refine(({ bindings, unboundNodes }) => {
      const unbound = new Set(unboundNodes)
      return Object.values(bindings).every((nodeHash) => !unbound.has(nodeHash))
    }, 'Named bindings must not repeat unbound node identities.')
    .parse(value)
  const { id, ...content } = parsed
  if (canonicalHash({ kind: 'taskyon.graphLock.v3', ...content }) !== id)
    throw new Error('Graph lock hash does not match content.')
  return parsed
}

/** The lock is verified before expanding authoring into canonical execution records. */
export const expandGraphAuthoringProjection = async (
  files: readonly DagProjectedFile[],
): Promise<DagProjectedFile[]> => {
  if (await isDesignGraphSourceBundle(files)) return await compileDesignGraphSources(files)
  const locked = files.find((file) => file.path === 'graph.lock.json')
  const historical = files
    .filter((file) => file.path.startsWith('applications/'))
    .map((file) => ({ ...file, path: file.path.replace('applications/', 'nodes/') }))
  if (!locked)
    return [...files.filter((file) => !file.path.startsWith('applications/')), ...historical]
  const authored = files
    .filter((file) => file.path.startsWith('nodes/') && file.path.endsWith('.ts'))
    .map((file) => ({ path: file.path, source: file.content }))
  const resolved = await validateGraphLock(authored, JSON.parse(locked.content))
  const records = await Promise.all(
    Object.values(resolved.resolvedNodes).map(
      async (node) => await saveStoredGraphNodeRecord(node, { directory: 'nodes' }),
    ),
  )
  return [
    ...files.filter(
      (file) =>
        file.path !== 'graph.lock.json' &&
        !file.path.startsWith('nodes/') &&
        !file.path.startsWith('applications/'),
    ),
    ...historical,
    ...records.map((record) => ({ path: record.file.path, content: record.file.source })),
    ...resolved.definitions.map((definition) => ({
      path: `authoring/${hashFilePart(canonicalHash(definition.source))}.ts`,
      content: definition.source,
    })),
    {
      path: `graph-locks/${hashFilePart(resolved.lock.id)}.json`,
      content: `${canonicalJson(resolved.lock, 2)}\n`,
    },
  ]
}

export const readAuthoredGraph = async (
  store: Pick<DesignGraphObjectStore, 'readText'>,
  lockId: Hash,
) => {
  const lock = parseGraphLock(
    JSON.parse(await store.readText(`graph-locks/${hashFilePart(lockId)}.json`)),
  )
  if (lock.id !== lockId) throw new Error('Graph lock identity mismatch.')
  const files = await Promise.all(
    Object.entries(lock.nodeSources).map(async ([path, hash]) => {
      const source = await store.readText(`authoring/${hashFilePart(hash)}.ts`)
      if (canonicalHash(source) !== hash)
        throw new Error('Authored source content identity mismatch.')
      return { path, source }
    }),
  )
  const resolved = await validateGraphLock(files, lock)
  return { ...resolved, files }
}

/** One repository owner retains only its most recently validated immutable lock. */
export const createCachedAuthoredGraphReader = (
  store: Pick<DesignGraphObjectStore, 'readText'>,
) => {
  let cached: { id: Hash; value: ReturnType<typeof readAuthoredGraph> } | undefined
  return (id: Hash): ReturnType<typeof readAuthoredGraph> => {
    if (cached?.id === id) return cached.value
    const value = readAuthoredGraph(store, id).catch((error: unknown) => {
      if (cached?.value === value) cached = undefined
      throw error
    })
    cached = { id, value }
    return value
  }
}

/** Saves immutable objects first; a failed conditional ref advance cannot activate partial edits. */
export const publishAuthoredGraph = async (args: {
  store: DesignGraphObjectStore
  files: readonly StoredGraphNodeFile[]
  expectedGraphRevisionId: Hash | null
}) => {
  const resolved = await resolveAuthoredGraph(args.files)
  const repository = createDesignGraphRepository(args.store)
  const current = await repository.getGraphRef('graph/main')
  if ((current?.revisionId ?? null) !== args.expectedGraphRevisionId)
    throw new Error('Graph changed; reload before saving.')
  const previous = current ? await repository.getGraphRevision(current.revisionId) : undefined
  if (previous?.authoringLockId === resolved.lock.id) {
    assertGraphRevisionMatchesAuthoringLock(previous, resolved.lock)
    return { ...resolved, revision: previous }
  }
  const records = await Promise.all(
    Object.values(resolved.resolvedNodes).map(
      async (node) => await saveStoredGraphNodeRecord(node, { directory: 'nodes' }),
    ),
  )
  for (const definition of resolved.definitions)
    await putImmutableDesignGraphText(
      args.store,
      `authoring/${hashFilePart(canonicalHash(definition.source))}.ts`,
      definition.source,
    )
  for (const record of records)
    await putImmutableDesignGraphText(args.store, record.file.path, record.file.source)
  await putImmutableDesignGraphObject(
    args.store,
    `graph-locks/${hashFilePart(resolved.lock.id)}.json`,
    resolved.lock,
  )
  const revision = createGraphRevision({
    parents: current ? [current.revisionId] : [],
    nodes: resolved.bindings,
    authoringLockId: resolved.lock.id,
  })
  await repository.putGraphRevision(revision)
  await repository.advanceGraphRef({
    name: 'graph/main',
    revisionId: revision.id,
    expected: args.expectedGraphRevisionId,
  })
  return { ...resolved, revision }
}

/** Projects editor changes back into the owning shared declarations before resolving again. */
const implementationIdentity = (record: DagNodeRecord) =>
  canonicalHash({
    version: record.version,
    run: record.runSource,
    params: record.localParamsSchema,
    output: record.outputSchema,
    lock: record.moduleLockId ?? null,
    timeout: record.timeoutMs ?? null,
    effect: record.effect ?? 'pure',
    capabilities: record.capabilities ?? [],
    imports: record.importsSource ?? '',
    preamble: record.preambleSource ?? '',
  })

export const updateAuthoredGraphRecords = async (
  files: readonly StoredGraphNodeFile[],
  records: readonly DagNodeRecord[],
) => {
  const previous = await resolveAuthoredGraph(files)
  const desired = new Map(records.map((record) => [record.localName, record]))
  const names = new Map(records.map((record) => [record.id, record.localName]))
  const updated: StoredGraphNodeFile[] = []
  for (const definition of previous.definitions) {
    const bindings: Record<string, DagAuthoredBinding> = {}
    let implementation: DagNodeRecord | undefined
    for (const [name, binding] of Object.entries(definition.bindings)) {
      const record = desired.get(name)
      const original = previous.resolvedNodes[previous.bindings[name]!]!
      if (!record) {
        if (records.some((candidate) => previous.bindings[candidate.localName] === original.id))
          bindings[name] = binding
        continue
      }
      if (implementationIdentity(record) !== implementationIdentity(original)) {
        if (
          record.importsSource !== original.importsSource ||
          record.preambleSource !== original.preambleSource
        )
          throw new Error('Edit the owning authored source to change imports or preamble code.')
        if (
          implementation &&
          implementationIdentity(implementation) !== implementationIdentity(record)
        )
          throw new Error('Conflicting edits to a shared definition.')
        implementation = record
      }
      const inputs = { ...binding.inputs }
      for (const [alias, ref] of Object.entries(record.inputs ?? {})) {
        if ('kind' in ref) throw new Error('Use a choose expression for alternatives.')
        const candidate = names.get(ref.nodeId)
        if (
          candidate &&
          desired.has(candidate) &&
          (!original.inputs?.[alias] ||
            'kind' in original.inputs[alias]! ||
            original.inputs[alias]!.nodeId !== ref.nodeId)
        )
          inputs[alias] = { source: candidate, role: ref.role }
      }
      for (const alias of Object.keys(inputs)) if (!record.inputs?.[alias]) delete inputs[alias]
      bindings[name] = { ...binding, inputs, label: record.label }
    }
    if (!Object.keys(bindings).length) continue
    const properties: Record<string, string | undefined> = { ids: JSON.stringify(bindings) }
    if (implementation) {
      properties.run = implementation.runSource
      properties.version = String(implementation.version)
      properties.localParamsSchema = JSON.stringify(implementation.localParamsSchema)
      properties.outputSchema = JSON.stringify(implementation.outputSchema)
      properties.moduleLockId = implementation.moduleLockId
        ? JSON.stringify(implementation.moduleLockId)
        : undefined
      properties.timeoutMs = implementation.timeoutMs ? String(implementation.timeoutMs) : undefined
      properties.effect = implementation.effect ? JSON.stringify(implementation.effect) : undefined
      properties.capabilities = implementation.capabilities?.length
        ? JSON.stringify(implementation.capabilities)
        : undefined
    }
    updated.push({
      path: definition.path,
      source: await rewriteDagDeclaration(definition.source, properties),
    })
  }
  const existing = new Set(Object.keys(previous.bindings))
  const newRecords = records.filter(
    (record) => !existing.has(record.localName) && !record.structure,
  )
  if (newRecords.length) {
    const declarations = await convertGraphRecordsToAuthoring(records)
    updated.push(
      ...declarations.filter((file) =>
        newRecords.some((record) => file.path === `nodes/${record.localName}.ts`),
      ),
    )
  }
  return updated
}
