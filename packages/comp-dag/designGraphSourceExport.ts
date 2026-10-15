import { updateDesignGraphSourceLock } from './designGraphSources.ts'
import type { DagProjectedFile } from './dagGitProjection.ts'
import { parseGraphLock } from './dagGraphAuthoring.ts'
import { parseDagDeclaration, rewriteDagDeclaration } from './dagNodeLoader.ts'
import { parseDagModuleArtifact, parseDagModuleLock } from './dagModule.ts'
import {
  parseDesignGraphRef,
  parseProjectRevision,
  parseProjectExtension,
  parseInvocationDefinition,
} from './designGraphModel.ts'
import { graphSourceJson, rewriteGraphSourceReferences } from './designGraphSources.ts'
import type { Hash } from './caching.ts'
import { z } from 'zod'

const uniqueName = (base: string, names: Set<string>) => {
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'item'
  let name = safe
  for (let suffix = 2; names.has(name); suffix += 1) name = `${safe}-${suffix}`
  names.add(name)
  return name
}

const exportSourceModules = (files: readonly DagProjectedFile[]) => {
  const artifacts = new Map(
    files
      .filter(({ path }) => path.startsWith('modules/') && path.endsWith('.json'))
      .map((file) => {
        const artifact = parseDagModuleArtifact(JSON.parse(file.content))
        return [artifact.id, artifact]
      }),
  )
  const locks = new Map(
    files
      .filter(({ path }) => path.startsWith('module-locks/') && path.endsWith('.json'))
      .map((file) => {
        const lock = parseDagModuleLock(JSON.parse(file.content))
        return [lock.id, lock]
      }),
  )
  const names = new Set<string>()
  const paths = new Map<Hash, string>()
  for (const lock of locks.values())
    for (const entries of Object.values(lock.imports)) {
      for (const [specifier, target] of Object.entries(entries)) {
        if (target.kind !== 'module' || paths.has(target.id)) continue
        const base = specifier
          .split('/')
          .at(-1)!
          .replace(/\.(ts|js)$/, '')
        paths.set(target.id, `modules/${uniqueName(base, names)}.ts`)
      }
    }
  const output: DagProjectedFile[] = []
  for (const [hash, artifact] of artifacts) {
    if (artifact.mediaType !== 'text/typescript')
      throw new Error('Source export requires TypeScript module source.')
    const path = paths.get(hash) ?? `modules/${uniqueName('module', names)}.ts`
    paths.set(hash, path)
    output.push({ path: `${path}`, content: artifact.source })
  }
  return { locks, paths, output }
}

const exportSourceNodes = async (
  files: readonly DagProjectedFile[],
  modules: ReturnType<typeof exportSourceModules>,
) => {
  const lockNames = new Map<Hash, string>()
  const output: DagProjectedFile[] = []
  const names = new Set<string>()
  const modulePath = (hash: string) => {
    const path = [...modules.paths].find(([id]) => id === hash)?.[1]
    if (!path) throw new Error(`Missing authored module source for ${hash}`)
    return path
  }
  for (const file of files.filter(
    ({ path }) => path.startsWith('nodes/') && path.endsWith('.ts'),
  )) {
    const parsed = await parseDagDeclaration(file.content)
    const hash = parsed.fields.moduleLockId
    if (typeof hash !== 'string') {
      output.push({ path: `${file.path}`, content: file.content })
      continue
    }
    const lock = [...modules.locks.values()].find((candidate) => candidate.id === hash)
    if (!lock) throw new Error(`Missing module lock for ${file.path}`)
    let name = lockNames.get(lock.id)
    if (!name) {
      name = uniqueName(file.path.split('/').at(-1)!.slice(0, -3), names)
      lockNames.set(lock.id, name)
      output.push(
        graphSourceJson(`imports/${name}.json`, {
          imports: Object.fromEntries(
            Object.entries(lock.imports).map(([owner, entries]) => [
              owner === '$node' ? owner : modulePath(owner),
              Object.fromEntries(
                Object.entries(entries).map(([specifier, target]) => [
                  specifier,
                  target.kind === 'module'
                    ? { module: modulePath(target.id) }
                    : { package: target.name },
                ]),
              ),
            ]),
          ),
          packages: Object.fromEntries(
            Object.entries(lock.packages).map(([name, pkg]) => [name, { range: pkg.range }]),
          ),
        }),
      )
    }
    output.push({
      path: `${file.path}`,
      content: await rewriteDagDeclaration(file.content, {
        moduleLockId: undefined,
        moduleImports: JSON.stringify(name),
      }),
    })
  }
  return output
}

const exportSourceProject = async (args: {
  revisionId: Hash
  refs: string[]
  files: ReadonlyMap<string, string>
  bindingNames: ReadonlyMap<string, string>
  projectName: string
}) => {
  const read = (directory: string, id: Hash) => {
    const source = [...args.files].find(
      ([path, content]) =>
        path.startsWith(`${directory}/`) &&
        z.object({ id: z.string() }).parse(JSON.parse(content)).id === id,
    )?.[1]
    if (source === undefined) throw new Error(`Missing ${directory} object ${id}`)
    return JSON.parse(source) as unknown
  }
  const project = parseProjectRevision(read('project-revisions', args.revisionId))
  const references = new Map(args.bindingNames)
  const invocations = new Map<string, unknown>()
  for (const [name, hash] of Object.entries(project.invocations)) {
    const invocation = parseInvocationDefinition(read('invocations', hash))
    const root = args.bindingNames.get(invocation.rootNodeId)
    if (!root)
      throw new Error(
        'Source-only export requires current graph roots and unpinned studies. Use a portable snapshot to retain historical code and observations.',
      )
    const { id, schemaVersion, rootNodeId, ...configuration } = invocation
    void id
    void schemaVersion
    void rootNodeId
    invocations.set(name, { root: root.slice('node:'.length), configuration })
    references.set(hash, `invocation:${name}`)
  }
  const output: DagProjectedFile[] = []
  const templates = new Map<string, string>()
  const templateNames = new Set<string>()
  const extensions = new Map<string, unknown>()
  for (const [name, hash] of Object.entries(project.extensions)) {
    const extension = parseProjectExtension(read('extensions', hash))
    for (const [label, dependency] of Object.entries(extension.dependencies?.invocations ?? {})) {
      if (references.has(dependency)) continue
      const invocation = parseInvocationDefinition(read('invocations', dependency))
      const path = invocation.variables.path
      if (
        !invocation.sourceSnapshotId ||
        path?.kind !== 'constant' ||
        typeof path.value !== 'string'
      )
        throw new Error('Additional extension invocations must be exported in a portable snapshot.')
      const { readPinnedTextFile } = await import('./builtIn/textFileSource.ts')
      const text = await readPinnedTextFile(invocation, {
        get: (namespace, id) => {
          const directory = namespace === 'dag/artifacts' ? 'source-artifacts' : namespace.slice(4)
          const source = args.files.get(`${directory}/${id.replace(':', '_')}.json`)
          return Promise.resolve(source === undefined ? undefined : (JSON.parse(source) as unknown))
        },
        set: () => Promise.reject(new Error('Source export cannot mutate observations.')),
      })
      const templateName = uniqueName(label, templateNames)
      const asset = `assets/${args.projectName}-${templateName}.md`
      templates.set(templateName, asset)
      references.set(dependency, `template:${templateName}`)
      output.push({ path: `${asset}`, content: text })
    }
    extensions.set(name, {
      namespace: extension.namespace,
      value: rewriteGraphSourceReferences(extension.value, references),
      ...(extension.dependencies
        ? { dependencies: rewriteGraphSourceReferences(extension.dependencies, references) }
        : {}),
    })
  }
  output.push(
    graphSourceJson(`projects/${args.projectName}.json`, {
      displayName: project.displayName,
      refs: args.refs,
      invocations: Object.fromEntries(invocations),
      extensions: Object.fromEntries(extensions),
      ...(templates.size ? { templates: Object.fromEntries(templates) } : {}),
    }),
  )
  return output
}

/** Exports current authored choices; histories and captured observations belong in portable archives. */
export const exportDesignGraphSources = async (
  files: readonly DagProjectedFile[],
): Promise<DagProjectedFile[]> => {
  const source = files.find(({ path }) => path === 'graph.lock.json')
  if (!source) throw new Error('Source export requires the current resolved authoring graph.')
  const lock = parseGraphLock(JSON.parse(source.content))
  const bindingNames = new Map(
    Object.entries(lock.bindings).map(([name, nodeHash]) => [nodeHash, `node:${name}`]),
  )
  const modules = exportSourceModules(files)
  const output = [...modules.output, ...(await exportSourceNodes(files, modules))]
  const projects = new Map<Hash, string[]>()
  for (const file of files.filter(({ path }) => path.startsWith('refs/projects/'))) {
    const ref = parseDesignGraphRef(JSON.parse(file.content))
    projects.set(ref.revisionId, [
      ...(projects.get(ref.revisionId) ?? []),
      file.path.slice('refs/projects/'.length, -'.json'.length),
    ])
  }
  const names = new Set<string>()
  for (const [revisionId, refs] of projects) {
    const preferred = refs.find((ref) => !ref.startsWith('templates/')) ?? refs[0]!
    const projectName = uniqueName(preferred.replace(/^templates\//, ''), names)
    output.push(
      ...(await exportSourceProject({
        revisionId,
        refs,
        files: new Map(files.map((file) => [file.path, file.content])),
        bindingNames,
        projectName,
      })),
    )
  }
  const packages = Object.fromEntries(
    [...modules.locks.values()].flatMap((lock) =>
      Object.entries(lock.packages).map(([name, pkg]) => [name, { ...pkg, path: '' }]),
    ),
  )
  return await updateDesignGraphSourceLock(output, packages)
}
