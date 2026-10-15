import type { DagProjectedFile } from './dagGitProjection.ts'
import {
  createDesignRepositoryFileReader,
  loadDesignRepositorySnapshot,
} from './designRepositorySnapshot.ts'
import {
  loadStoredGraphNodeFiles,
  saveStoredGraphNodeRecord,
  rewriteDagDeclaration,
} from './dagNodeLoader.ts'
import { getDagNodeRecordClosure, savedStoredNodesToRecordGraph } from './dagNodeRecordGraph.ts'
import {
  convertGraphRecordsToAuthoring,
  resolveAuthoredGraph,
  parseAuthoredGraphDefinition,
} from './dagGraphAuthoring.ts'
import { hashFilePart } from './dagNodeIdentity.ts'
import { canonicalHash, type Hash } from './caching.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import {
  createGraphRevision,
  createInvocationDefinition,
  createProjectExtension,
  createProjectRevision,
  parseGraphRevision,
  parseInvocationDefinition,
  parseProjectExtension,
  parseProjectRevision,
  parseDesignGraphRef,
} from './designGraphModel.ts'

const json = (path: string, value: unknown): DagProjectedFile => ({
  path,
  content: `${canonicalJson(value, 2)}\n`,
})

/** Rewrites only identities present in this repository; arbitrary extension values remain JSON. */
const rewriteReferences = (value: unknown, replacements: ReadonlyMap<string, Hash>): unknown => {
  if (typeof value === 'string') return replacements.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => rewriteReferences(item, replacements))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      replacements.get(key) ?? key,
      rewriteReferences(item, replacements),
    ]),
  )
}

/** Explicit bundled-repository cutover. It never reads personal storage or executes graph code. */
export const convertDesignGraphProjection = async (files: readonly DagProjectedFile[]) => {
  if (files.some((file) => file.path === 'graph.lock.json'))
    throw new Error('This projection already uses graph authoring locks.')
  const reader = createDesignRepositoryFileReader(files)
  const active = await loadDesignRepositorySnapshot({
    readText: reader.readText,
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  const saved = await loadStoredGraphNodeFiles(
    files
      .filter((file) => file.path.startsWith('nodes/'))
      .map((file) => ({ path: file.path, source: file.content })),
  )
  const records = savedStoredNodesToRecordGraph(saved)
  const output = new Map<string, DagProjectedFile>()
  const replacements = new Map<string, Hash>()
  const revisions = new Map(
    files
      .filter((file) => file.path.startsWith('graph-revisions/'))
      .map((file) => {
        const revision = parseGraphRevision(JSON.parse(file.content))
        return [revision.id, revision] as const
      }),
  )
  let activeDeclarations: Awaited<ReturnType<typeof resolveAuthoredGraph>> | undefined
  const convertRevision = async (id: Hash): Promise<Hash> => {
    const existing = replacements.get(id)
    if (existing) return existing
    const revision = revisions.get(id)
    if (!revision) throw new Error(`Missing graph revision ${id}.`)
    const parents = await Promise.all(revision.parents.map(convertRevision))
    const closure = [
      ...new Set(
        Object.values(revision.nodes).flatMap((root) => getDagNodeRecordClosure(records, root)),
      ),
    ].map((hash) => records[hash]!)
    const authored = await convertGraphRecordsToAuthoring(closure)
    // Root aliases are authored bindings as well, so catalog names survive the cutover.
    for (const [name, hash] of Object.entries(revision.nodes)) {
      const node = records[hash]!
      if (name === node.localName) continue
      const index = authored.findIndex((file) => file.path === `nodes/${node.localName}.ts`)
      if (index < 0) throw new Error('A structural root needs an explicit authored binding.')
      const definition = await parseAuthoredGraphDefinition(authored[index]!)
      authored[index] = {
        ...authored[index]!,
        source: await rewriteDagDeclaration(definition.source, {
          ids: JSON.stringify({
            ...definition.bindings,
            [name]: definition.bindings[node.localName],
          }),
        }),
      }
    }
    const resolved = await resolveAuthoredGraph(authored)
    if (id === active.revision.id) activeDeclarations = resolved
    for (const old of closure) {
      let target = resolved.bindings[old.localName]
      if (!target && old.structure?.kind === 'explode') {
        const sourceRef = old.inputs?.[old.structure.sourceAlias]
        const source = sourceRef && !('kind' in sourceRef) ? records[sourceRef.nodeId] : undefined
        const sourceHash = source ? resolved.bindings[source.localName] : undefined
        target = Object.values(resolved.resolvedNodes).find((node) => {
          const ref = node.inputs?.source
          return (
            node.structure?.kind === 'explode' &&
            old.structure?.kind === 'explode' &&
            node.structure.path === old.structure.path &&
            ref &&
            !('kind' in ref) &&
            ref.nodeId === sourceHash
          )
        })?.id
      }
      if (!target) throw new Error(`Cannot resolve converted node ${old.localName}.`)
      replacements.set(old.id, target)
    }
    for (const definition of resolved.definitions) {
      const path = `authoring/${hashFilePart(canonicalHash(definition.source))}.ts`
      output.set(path, { path, content: definition.source })
    }
    const lockPath = `graph-locks/${hashFilePart(resolved.lock.id)}.json`
    output.set(lockPath, json(lockPath, resolved.lock))
    for (const node of Object.values(resolved.resolvedNodes)) {
      const stored = await saveStoredGraphNodeRecord(node)
      const path = `applications/${hashFilePart(node.id)}.ts`
      output.set(path, { path, content: stored.file.source })
    }
    const converted = createGraphRevision({
      parents,
      nodes: resolved.bindings,
      authoringLockId: resolved.lock.id,
    })
    const path = `graph-revisions/${hashFilePart(converted.id)}.json`
    output.set(path, json(path, converted))
    replacements.set(id, converted.id)
    return converted.id
  }
  for (const id of revisions.keys()) await convertRevision(id)
  for (const file of files.filter((file) => file.path.startsWith('invocations/'))) {
    const old = parseInvocationDefinition(JSON.parse(file.content))
    const next = createInvocationDefinition({
      ...old,
      rootNodeId: replacements.get(old.rootNodeId) ?? old.rootNodeId,
    })
    const path = `invocations/${hashFilePart(next.id)}.json`
    output.set(path, json(path, next))
    replacements.set(old.id, next.id)
  }
  for (const file of files.filter((file) => file.path.startsWith('extensions/'))) {
    const old = parseProjectExtension(JSON.parse(file.content))
    const next = createProjectExtension({
      ...old,
      value: rewriteReferences(old.value, replacements),
      ...(old.dependencies
        ? {
            dependencies: {
              invocations: Object.fromEntries(
                Object.entries(old.dependencies.invocations ?? {}).map(([name, hash]) => [
                  name,
                  replacements.get(hash) ?? hash,
                ]),
              ),
            },
          }
        : {}),
    })
    const path = `extensions/${hashFilePart(next.id)}.json`
    output.set(path, json(path, next))
    replacements.set(old.id, next.id)
  }
  const projects = new Map(
    files
      .filter((file) => file.path.startsWith('project-revisions/'))
      .map((file) => {
        const project = parseProjectRevision(JSON.parse(file.content))
        return [project.id, project] as const
      }),
  )
  const convertProject = (id: Hash): Hash => {
    const existing = replacements.get(id)
    if (existing) return existing
    const old = projects.get(id)
    if (!old) throw new Error('Missing project ancestry during cutover.')
    const next = createProjectRevision({
      ...old,
      parents: old.parents.map(convertProject),
      invocations: Object.fromEntries(
        Object.entries(old.invocations).map(([name, hash]) => [
          name,
          replacements.get(hash) ?? hash,
        ]),
      ),
      extensions: Object.fromEntries(
        Object.entries(old.extensions).map(([name, hash]) => [
          name,
          replacements.get(hash) ?? hash,
        ]),
      ),
    })
    const path = `project-revisions/${hashFilePart(next.id)}.json`
    output.set(path, json(path, next))
    replacements.set(id, next.id)
    return next.id
  }
  for (const id of projects.keys()) convertProject(id)
  for (const file of files) {
    if (file.path.startsWith('refs/')) {
      const ref = parseDesignGraphRef(JSON.parse(file.content))
      output.set(
        file.path,
        json(file.path, { ...ref, revisionId: replacements.get(ref.revisionId) ?? ref.revisionId }),
      )
    } else if (
      ['modules/', 'module-locks/', 'source-'].some((prefix) => file.path.startsWith(prefix))
    )
      output.set(file.path, file)
  }
  if (!activeDeclarations) throw new Error('The active graph was not converted.')
  for (const definition of activeDeclarations.definitions)
    output.set(definition.path, { path: definition.path, content: definition.source })
  output.set('graph.lock.json', json('graph.lock.json', activeDeclarations.lock))
  for (const hash of Object.keys(activeDeclarations.resolvedNodes))
    output.delete(`applications/${hashFilePart(hash as Hash)}.ts`)
  return [...output.values()].sort((left, right) => left.path.localeCompare(right.path))
}
