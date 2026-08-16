import type { Hash } from './caching.ts'
import { getDagModuleLockModuleIds, type StoredDagPackageName } from './dagModule.ts'
import type {
  DagCompiledNodeArtifact,
  DagResolvedPackage,
  DagRunCodeArtifactCompiler,
  DagRunCodeCompilerInput,
  DagRunCodeCompiler,
} from './designRepositorySnapshot.ts'

export const DAG_RUN_CODE_COMPILER_VERSION = 'taskyon-esm-bundle-es2022-v2'

export type DagPackageCompilerArtifact = DagResolvedPackage & {
  source: string
}

export type DagPackageArtifactResolver = {
  resolve: (
    requirements: Readonly<Partial<Record<StoredDagPackageName, { range: string }>>>,
  ) => Promise<readonly DagResolvedPackage[]>
  load: (resolved: DagResolvedPackage) => Promise<DagPackageCompilerArtifact>
}

export type DagModuleBundleRequest = {
  entrySource: string
  imports: NonNullable<DagRunCodeCompilerInput['lock']>['imports']
  modules: Readonly<Record<Hash, { mediaType: string; source: string }>>
  packages: readonly DagPackageCompilerArtifact[]
}

export type DagModuleBundler = (request: DagModuleBundleRequest) => Promise<string>

const textBytes = (value: string) => new TextEncoder().encode(value).byteLength

export const createBundledDagNodeArtifactCompiler = (args: {
  compilerAbi: string
  bundle: DagModuleBundler
  packages: DagPackageArtifactResolver
}): DagRunCodeArtifactCompiler => ({
  compilerAbi: args.compilerAbi,
  resolvePackages: async (lock) => await args.packages.resolve(lock?.packages ?? {}),
  compile: async (input, resolvedPackages) => {
    const packageArtifacts = await Promise.all(resolvedPackages.map(args.packages.load))
    const moduleIds = input.lock ? getDagModuleLockModuleIds(input.lock) : []
    const modules = Object.fromEntries(
      moduleIds.map((id) => {
        const module = input.modules[id]
        if (!module) throw new Error(`Locked DAG module ${id} is unavailable.`)
        return [id, { mediaType: module.mediaType, source: module.source }]
      }),
    )
    const entrySource = `${input.importsSource ?? ''}\n${input.preambleSource ?? ''}\nexport default ${input.runSource}\n`
    const code = await args.bundle({
      entrySource,
      imports: input.lock?.imports ?? {},
      modules,
      packages: packageArtifacts,
    })
    return {
      schemaVersion: 1,
      compilerAbi: args.compilerAbi,
      nodeId: input.nodeId,
      ...(input.lock ? { moduleLockId: input.lock.id } : {}),
      sourceBytes:
        textBytes(entrySource) +
        Object.values(modules).reduce((total, module) => total + textBytes(module.source), 0) +
        packageArtifacts.reduce((total, pkg) => total + textBytes(pkg.source), 0),
      outputBytes: textBytes(code),
      packages: resolvedPackages,
      code,
    }
  },
})

const unsupportedPackages: DagPackageArtifactResolver = {
  resolve: (requirements) => {
    const names = Object.keys(requirements)
    if (names.length > 0) {
      throw new Error(`Runtime package artifacts are unavailable: ${names.join(', ')}`)
    }
    return Promise.resolve([])
  },
  load: () => Promise.reject(new Error('Runtime package artifacts are unavailable.')),
}

const createTypeScriptBundle = async (request: DagModuleBundleRequest): Promise<string> => {
  const tsModule = await import('typescript')
  const sources: Array<[string, string]> = [['$node', request.entrySource]]
  sources.push(
    ...Object.entries(request.modules).map(
      ([id, module]) => [id, module.source] as [string, string],
    ),
  )
  const transpiled = sources.map(([id, source]) => {
    const output = tsModule.transpileModule(source, {
      compilerOptions: {
        target: tsModule.ScriptTarget.ES2022,
        module: tsModule.ModuleKind.CommonJS,
        removeComments: false,
      },
      fileName: `${id.replace(':', '_')}.ts`,
    }).outputText
    return [id, output] as const
  })
  const factories = transpiled
    .map(([id, body]) => `${JSON.stringify(id)}: (module, exports, require) => {\n${body}\n}`)
    .join(',\n')
  return `(() => {
    const factories = {${factories}};
    const imports = ${JSON.stringify(request.imports)};
    const cache = Object.create(null);
    const load = (moduleId) => {
      if (cache[moduleId]) return cache[moduleId].exports;
      const factory = factories[moduleId];
      if (!factory) throw new Error('Locked DAG module is unavailable: ' + moduleId);
      const module = { exports: {} };
      cache[moduleId] = module;
      factory(module, module.exports, (specifier) => {
        const target = imports[moduleId] && imports[moduleId][specifier];
        if (!target || target.kind !== 'module') {
          throw new Error('Unlocked DAG import: ' + moduleId + ' -> ' + specifier);
        }
        return load(target.id);
      });
      return module.exports;
    };
    return load('$node').default;
  })()`
}

/**
 * Compatibility-free compiler for package-free Taskyon consumers. Joulios injects the tree-shaking
 * browser or Node bundler instead.
 */
export const createLockedDagNodeRunCodeCompiler = (): DagRunCodeArtifactCompiler =>
  createBundledDagNodeArtifactCompiler({
    compilerAbi: 'taskyon-typescript-module-bundle-es2022-v2',
    bundle: createTypeScriptBundle,
    packages: unsupportedPackages,
  })

export const createUncachedDagRunCodeCompiler = (
  compiler: DagRunCodeArtifactCompiler,
): DagRunCodeCompiler => ({
  get: () => Promise.resolve(null),
  compile: async (input) => {
    const packages = await compiler.resolvePackages(input.lock)
    const artifact = await compiler.compile(input, packages)
    return { ...artifact, cacheId: 'uncached' }
  },
})

export const compileLockedDagNodeRunCode = async (
  input: DagRunCodeCompilerInput,
): Promise<string> => {
  const compiler = createLockedDagNodeRunCodeCompiler()
  const packages = await compiler.resolvePackages(input.lock)
  return (await compiler.compile(input, packages)).code
}

export type { DagCompiledNodeArtifact }
