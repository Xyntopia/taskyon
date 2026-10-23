import { z } from 'zod'
import type { DagProjectedFile } from './dagGitProjection.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import { canonicalHash, type Hash } from './caching.ts'
import { resolveAuthoredGraph } from './dagGraphAuthoring.ts'
import {
  parseDagDeclaration,
  rewriteDagDeclaration,
  saveStoredGraphNodeRecord,
} from './dagNodeLoader.ts'
import {
  createDagModuleArtifact,
  createDagModuleLock,
  STORED_DAG_PACKAGE_ALLOWLIST,
} from './dagModule.ts'
import {
  createGraphRevision,
  createProjectExtension,
  createProjectRevision,
} from './designGraphModel.ts'
import { resolveInvocationDefinition } from './designGraphModel.ts'
import { normalizeRefName } from './designGraphRepository.ts'
import {
  createGraphSourceLock,
  parseGraphSourceLock,
  isGraphSourceLock,
} from './designGraphSourceLock.ts'
import { satisfiesDagPackageRange, type DagRuntimePackageManifest } from './dagPackageArtifact.ts'
import { ingestTextFile, TEXT_FILE_SOURCE_SEMANTIC_VERSION } from './builtIn/textFileSource.ts'
import { getDagStructuralDefinitionHash } from './dagNodeRecord.ts'

/** Disposable offline compilation output, separate from saved projects and execution results. */
export type DesignGraphSourceCache = {
  get: (id: Hash) => Promise<unknown>
  set: (
    id: Hash,
    entry: { sourceHash: Hash; contentHash: Hash; files: DagProjectedFile[] },
  ) => Promise<void>
  onStatus?: (status: 'hit' | 'miss' | 'invalid') => void
}

export const compileDesignGraphSourcesWithCache = async (
  files: readonly DagProjectedFile[],
  cache: DesignGraphSourceCache,
): Promise<DagProjectedFile[]> => {
  const sourceHash = canonicalHash({
    compiler: 'taskyon.graph-sources.v4',
    textFileSourceSemantics: TEXT_FILE_SOURCE_SEMANTIC_VERSION,
    structuralSemantics: (['explode', 'choose', 'select'] as const).map(
      getDagStructuralDefinitionHash,
    ),
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
  })
  const entry = await cache.get(sourceHash)
  const cached = z
    .object({
      sourceHash: z.literal(sourceHash),
      contentHash: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() }).strict()),
    })
    .strict()
    .safeParse(entry)
  if (cached.success && canonicalHash(cached.data.files) === cached.data.contentHash) {
    cache.onStatus?.('hit')
    return cached.data.files
  }
  cache.onStatus?.(entry == null ? 'miss' : 'invalid')
  const generated = await compileDesignGraphSources(files)
  await cache.set(sourceHash, {
    sourceHash,
    contentHash: canonicalHash(generated),
    files: generated,
  })
  return generated
}

export const isDesignGraphSourceBundle = async (files: readonly DagProjectedFile[]) => {
  const lock = files.find((file) => file.path === 'graph.lock.json')
  if (lock) return isGraphSourceLock(JSON.parse(lock.content))
  if (files.some((file) => /^(projects|imports|assets)\//.test(file.path))) return true
  const node = files.find((file) => file.path.startsWith('nodes/') && file.path.endsWith('.ts'))
  if (!node) return false
  return (await parseDagDeclaration(node.content)).fields.ids !== undefined
}

export const graphSourceJson = (path: string, value: unknown): DagProjectedFile => ({
  path,
  content: `${canonicalJson(value, 2)}\n`,
})

/** Explicit references in otherwise host-owned JSON; arbitrary values retain their meaning. */
export const rewriteGraphSourceReferences = (
  value: unknown,
  references: ReadonlyMap<string, string>,
): unknown => {
  if (typeof value === 'string') return references.get(value) ?? value
  if (Array.isArray(value))
    return value.map((item) => rewriteGraphSourceReferences(item, references))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      references.get(key) ?? key,
      rewriteGraphSourceReferences(item, references),
    ]),
  )
}

export const graphSourcePath = (path: string) => {
  if (path === 'graph.lock.json') return path
  if (
    !/^(nodes|projects|modules|imports|assets)\//.test(path) ||
    path.split('/').some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')
  )
    throw new Error(`Invalid authored graph path: ${path}`)
  const kind = path.split('/')[0]
  if (
    ((kind === 'nodes' || kind === 'modules') && !path.endsWith('.ts')) ||
    ((kind === 'imports' || kind === 'projects') && !path.endsWith('.json'))
  )
    throw new Error(`Unexpected authored graph file type: ${path}`)
  return path
}

const compileSourceModules = (
  files: readonly DagProjectedFile[],
  packages: DagRuntimePackageManifest['packages'],
) => {
  const artifacts = new Map(
    files
      .filter(({ path }) => path.startsWith('modules/'))
      .map((file) => {
        if (!file.path.endsWith('.ts'))
          throw new Error('Authored modules must be TypeScript sources.')
        return [
          file.path,
          createDagModuleArtifact({ mediaType: 'text/typescript', source: file.content }),
        ]
      }),
  )
  const moduleId = (path: string) => {
    const artifact = artifacts.get(path)
    if (!artifact) throw new Error(`Missing authored module: ${path}`)
    return artifact.id
  }
  const locks = new Map(
    files
      .filter(({ path }) => path.startsWith('imports/') && path.endsWith('.json'))
      .map((file) => {
        const source = z
          .object({
            imports: z.record(
              z.string(),
              z.record(
                z.string(),
                z.union([
                  z.object({ module: z.string() }).strict(),
                  z.object({ package: z.enum(STORED_DAG_PACKAGE_ALLOWLIST) }).strict(),
                ]),
              ),
            ),
            packages: z
              .partialRecord(
                z.enum(STORED_DAG_PACKAGE_ALLOWLIST),
                z.object({ range: z.string() }).strict(),
              )
              .default({}),
          })
          .strict()
          .parse(JSON.parse(file.content))
        const imports = Object.fromEntries(
          Object.entries(source.imports).map(([owner, entries]) => [
            owner === '$node' ? owner : moduleId(owner),
            Object.fromEntries(
              Object.entries(entries).map(([specifier, target]) => [
                specifier,
                'module' in target
                  ? { kind: 'module' as const, id: moduleId(target.module) }
                  : { kind: 'package' as const, name: target.package },
              ]),
            ),
          ]),
        )
        return [
          file.path.slice('imports/'.length, -'.json'.length),
          createDagModuleLock({
            imports,
            packages: Object.fromEntries(
              Object.entries(source.packages).map(([name, requirement]) => {
                const resolved = packages[name as keyof typeof packages]
                if (!resolved || !satisfiesDagPackageRange(resolved.version, requirement.range))
                  throw new Error(
                    `No approved package version satisfies ${name}@${requirement.range}.`,
                  )
                return [
                  name,
                  {
                    range: requirement.range,
                    version: resolved.version,
                    integrity: resolved.integrity,
                  },
                ]
              }),
            ),
          }),
        ]
      }),
  )
  return { artifacts, locks }
}

const compileSourceNodes = async (
  files: readonly DagProjectedFile[],
  modules: ReturnType<typeof compileSourceModules>,
) =>
  await Promise.all(
    files
      .filter(({ path }) => path.startsWith('nodes/') && path.endsWith('.ts'))
      .map(async (file) => {
        const declaration = await parseDagDeclaration(file.content)
        if (declaration.fields.moduleLockId !== undefined)
          throw new Error(
            'Authored nodes use moduleImports names; module lock hashes are generated.',
          )
        const name = declaration.fields.moduleImports
        if (name !== undefined && typeof name !== 'string')
          throw new Error(`Invalid authored import declaration: ${JSON.stringify(name)}`)
        const lock = name === undefined ? undefined : modules.locks.get(name)
        if (name !== undefined && !lock)
          throw new Error(`Missing authored import declaration: ${name}`)
        return {
          path: file.path,
          source:
            name === undefined
              ? file.content
              : await rewriteDagDeclaration(file.content, {
                  moduleImports: undefined,
                  moduleLockId: JSON.stringify(lock!.id),
                }),
        }
      }),
  )

const projectSourceSchema = () =>
  z
    .object({
      displayName: z.string(),
      refs: z.array(z.string()).min(1),
      invocations: z
        .record(
          z.string(),
          z
            .object({
              root: z.string(),
              configuration: z.record(z.string(), z.unknown()),
            })
            .strict(),
        )
        .default({}),
      templates: z.record(z.string(), z.string()).default({}),
      extensions: z
        .record(
          z.string(),
          z
            .object({
              namespace: z.string(),
              value: z.unknown(),
              dependencies: z
                .object({ invocations: z.record(z.string(), z.string()) })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .default({}),
    })
    .strict()

const compileSourceProject = async (
  file: DagProjectedFile,
  files: ReadonlyMap<string, string>,
  bindings: Record<string, Hash>,
) => {
  const source = projectSourceSchema().parse(JSON.parse(file.content))
  const references = new Map(Object.entries(bindings).map(([name, hash]) => [`node:${name}`, hash]))
  const output: DagProjectedFile[] = []
  const records = new Map<string, unknown>()
  const invocations = new Map<string, Hash>()
  for (const [name, input] of Object.entries(source.invocations)) {
    const root = bindings[input.root]
    if (!root) throw new Error(`Unknown invocation root: ${input.root}`)
    if (['id', 'schemaVersion', 'rootNodeId'].some((key) => key in input.configuration))
      throw new Error(
        'Authored invocations contain parameters and policy; identities are generated.',
      )
    const invocation = resolveInvocationDefinition({ ...input.configuration, rootNodeId: root })
    invocations.set(name, invocation.id)
    references.set(`invocation:${name}`, invocation.id)
    output.push(graphSourceJson(`invocations/${invocation.id.replace(':', '_')}.json`, invocation))
  }
  for (const [name, path] of Object.entries(source.templates)) {
    const content = files.get(graphSourcePath(path))
    if (content === undefined) throw new Error(`Missing authored template: ${path}`)
    const invocation = await ingestTextFile(
      path,
      content,
      {
        get: (namespace, id) => Promise.resolve(records.get(`${namespace}/${id}`)),
        set: (namespace, id, value) => {
          records.set(`${namespace}/${id}`, value)
          return Promise.resolve()
        },
      },
      0,
    )
    references.set(`template:${name}`, invocation.id)
    output.push(graphSourceJson(`invocations/${invocation.id.replace(':', '_')}.json`, invocation))
  }
  const extensions = new Map<string, Hash>()
  for (const [name, input] of Object.entries(source.extensions)) {
    const dependencies = input.dependencies
      ? {
          invocations: Object.fromEntries(
            Object.entries(input.dependencies.invocations).map(([key, ref]) => {
              const hash = references.get(ref)
              if (!hash) throw new Error(`Unknown extension invocation reference: ${ref}`)
              return [key, hash]
            }),
          ),
        }
      : undefined
    const extension = createProjectExtension({
      namespace: input.namespace,
      value: rewriteGraphSourceReferences(input.value, references),
      ...(dependencies ? { dependencies } : {}),
    })
    extensions.set(name, extension.id)
    output.push(graphSourceJson(`extensions/${extension.id.replace(':', '_')}.json`, extension))
  }
  for (const [location, value] of records) {
    const kind = location.startsWith('dag/artifacts/') ? 'source-artifacts' : location.split('/')[1]
    if (!['source-artifacts', 'source-manifests', 'source-snapshots'].includes(kind ?? '')) continue
    const hash = location.split('/').at(-1)!
    output.push(graphSourceJson(`${kind}/${hash.replace(':', '_')}.json`, value))
  }
  const revision = createProjectRevision({
    parents: [],
    displayName: source.displayName,
    invocations: Object.fromEntries(invocations),
    extensions: Object.fromEntries(extensions),
  })
  output.push(graphSourceJson(`project-revisions/${revision.id.replace(':', '_')}.json`, revision))
  for (const name of source.refs)
    output.push(
      graphSourceJson(`refs/${normalizeRefName(`projects/${name}`, 'projects/')}.json`, {
        schemaVersion: 2,
        revisionId: revision.id,
      }),
    )
  return output
}

/** Pure, offline boot compilation. Inputs contain authored choices; outputs are disposable records. */
const resolveDesignGraphSources = async (
  files: readonly DagProjectedFile[],
  packages: DagRuntimePackageManifest['packages'],
) => {
  const sourceFiles = new Map<string, string>()
  for (const file of files) {
    graphSourcePath(file.path)
    if (sourceFiles.has(file.path)) throw new Error(`Duplicate graph source: ${file.path}`)
    sourceFiles.set(file.path, file.content)
  }
  const modules = compileSourceModules(files, packages)
  const nodes = await compileSourceNodes(files, modules)
  const graph = await resolveAuthoredGraph(nodes)
  const revision = createGraphRevision({
    parents: [],
    nodes: graph.bindings,
    authoringLockId: graph.lock.id,
  })
  const output = [
    graphSourceJson(`graph-locks/${graph.lock.id.replace(':', '_')}.json`, graph.lock),
    graphSourceJson(`graph-revisions/${revision.id.replace(':', '_')}.json`, revision),
    graphSourceJson('refs/graph/main.json', { schemaVersion: 2, revisionId: revision.id }),
    ...graph.definitions.map((definition) => ({
      path: `authoring/${canonicalHash(definition.source).replace(':', '_')}.ts`,
      content: definition.source,
    })),
    ...(await Promise.all(
      Object.values(graph.resolvedNodes).map(async (node) => {
        const record = await saveStoredGraphNodeRecord(node, { directory: 'nodes' })
        return { path: record.file.path, content: record.file.source }
      }),
    )),
    ...[...modules.artifacts.values()].map((artifact) =>
      graphSourceJson(`modules/${artifact.id.replace(':', '_')}.json`, artifact),
    ),
    ...[...modules.locks.values()].map((lock) =>
      graphSourceJson(`module-locks/${lock.id.replace(':', '_')}.json`, lock),
    ),
  ]
  const projectRefs = new Set<string>()
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (!file.path.startsWith('projects/') || !file.path.endsWith('.json')) continue
    for (const record of await compileSourceProject(file, sourceFiles, graph.bindings)) {
      if (record.path.startsWith('refs/')) {
        if (projectRefs.has(record.path)) throw new Error(`Duplicate project ref: ${record.path}`)
        projectRefs.add(record.path)
      }
      output.push(record)
    }
  }
  return {
    files: [...new Map(output.map((file) => [file.path, file])).values()].sort((a, b) =>
      a.path < b.path ? -1 : 1,
    ),
    lock: createGraphSourceLock(files, graph.lock, modules.locks),
  }
}

/** Explicit authoring action; boot never changes checked-in locks. */
export const updateDesignGraphSourceLock = async (
  files: readonly DagProjectedFile[],
  packages: DagRuntimePackageManifest['packages'] = {},
): Promise<DagProjectedFile[]> => {
  const sources = files.filter((file) => file.path !== 'graph.lock.json')
  const resolved = await resolveDesignGraphSources(sources, packages)
  return [...sources, graphSourceJson('graph.lock.json', resolved.lock)].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  )
}

/** Offline boot validates the committed lock and reconstructs canonical runtime records. */
export const compileDesignGraphSources = async (
  files: readonly DagProjectedFile[],
): Promise<DagProjectedFile[]> => {
  const file = files.find((file) => file.path === 'graph.lock.json')
  if (!file) throw new Error('Missing graph.lock.json. Run the explicit graph lock update command.')
  const locked = parseGraphSourceLock(JSON.parse(file.content))
  const packages = Object.fromEntries(
    [...locked.moduleLocks.values()].flatMap((lock) =>
      Object.entries(lock.packages).map(([name, pkg]) => [name, { ...pkg, path: '' }]),
    ),
  )
  const resolved = await resolveDesignGraphSources(
    files.filter((file) => file.path !== 'graph.lock.json'),
    packages,
  )
  if (resolved.lock.id !== locked.id)
    throw new Error(
      'Stale graph.lock.json. Review source changes and explicitly update the graph lock.',
    )
  return resolved.files
}
