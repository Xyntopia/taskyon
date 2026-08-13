import type * as ts from 'typescript'
import type { Hash } from './caching.ts'
import {
  getDagModuleLockModuleIds,
  type DagModuleArtifact,
  type DagModuleLock,
} from './dagModule.ts'

const transpileCommonJs = (tsModule: typeof ts, source: string, fileName: string): string =>
  tsModule.transpileModule(source, {
    compilerOptions: {
      target: tsModule.ScriptTarget.ES2022,
      module: tsModule.ModuleKind.CommonJS,
      removeComments: false,
      typeRoots: [],
    },
    fileName,
  }).outputText

export const compileLockedDagNodeRunCode = async (args: {
  importsSource: string
  runSource: string
  lock: DagModuleLock
  modules: Record<Hash, DagModuleArtifact>
}): Promise<string> => {
  const tsModule = await import('typescript')
  const sources: Record<string, string> = {
    $node: `${args.importsSource}\nexport default ${args.runSource}\n`,
  }
  for (const moduleId of getDagModuleLockModuleIds(args.lock)) {
    const artifact = args.modules[moduleId]
    if (!artifact) throw new Error(`Locked DAG module ${moduleId} is unavailable.`)
    sources[moduleId] = artifact.source
  }
  const factories = Object.entries(sources)
    .map(([moduleId, source]) => {
      const body = transpileCommonJs(tsModule, source, `${moduleId.replace(':', '_')}.ts`)
      return `${JSON.stringify(moduleId)}: (module, exports, require) => {\n${body}\n}`
    })
    .join(',\n')
  return `(() => {
    const factories = {${factories}};
    const imports = ${JSON.stringify(args.lock.imports)};
    const cache = Object.create(null);
    const load = (moduleId) => {
      if (cache[moduleId]) return cache[moduleId].exports;
      const factory = factories[moduleId];
      if (factory === undefined) throw new Error('Locked DAG module is unavailable: ' + moduleId);
      const module = { exports: {} };
      cache[moduleId] = module;
      const require = (specifier) => {
        const target = imports[moduleId] && imports[moduleId][specifier];
        if (!target) throw new Error('Unlocked DAG import: ' + moduleId + ' -> ' + specifier);
        return load(target);
      };
      factory(module, module.exports, require);
      return module.exports;
    };
    return load('$node').default;
  })()`
}
