import type { BuildOptions, BuildResult, Plugin } from 'esbuild'
import type { DagModuleBundleRequest, DagModuleBundler } from './dagModuleCompiler.ts'

const dagModulesPlugin = (request: DagModuleBundleRequest): Plugin => ({
  name: 'taskyon-locked-dag-modules',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^\$node$/ }, () => ({ path: '$node', namespace: 'dag' }))
    buildApi.onResolve({ filter: /.*/, namespace: 'dag' }, (imported) => {
      const target = request.imports[imported.importer]?.[imported.path]
      if (!target) {
        return {
          errors: [{ text: `Unlocked DAG import: ${imported.importer} -> ${imported.path}` }],
        }
      }
      return target.kind === 'module'
        ? { path: target.id, namespace: 'dag' }
        : { path: target.name, namespace: 'dag-package' }
    })
    buildApi.onLoad({ filter: /.*/, namespace: 'dag' }, (loaded) => {
      if (loaded.path === '$node') return { contents: request.entrySource, loader: 'ts' }
      const module = Object.entries(request.modules).find(([id]) => id === loaded.path)?.[1]
      if (!module) return { errors: [{ text: `Locked DAG module is unavailable: ${loaded.path}` }] }
      return {
        contents: module.source,
        loader: module.mediaType === 'text/typescript' ? 'ts' : 'js',
      }
    })
    buildApi.onLoad({ filter: /.*/, namespace: 'dag-package' }, (loaded) => {
      const pkg = request.packages.find(({ name }) => name === loaded.path)
      return pkg
        ? { contents: pkg.source, loader: 'js' }
        : { errors: [{ text: `Runtime package is unavailable: ${loaded.path}` }] }
    })
  },
})

export const createEsbuildDagModuleBundler = (esbuild: {
  build: (options: BuildOptions) => Promise<BuildResult>
}): DagModuleBundler => {
  return async (request) => {
    const result = await esbuild.build({
      entryPoints: ['$node'],
      bundle: true,
      format: 'iife',
      globalName: '__taskyonNode',
      platform: 'neutral',
      target: 'es2022',
      treeShaking: true,
      minifySyntax: true,
      minifyWhitespace: true,
      minifyIdentifiers: false,
      legalComments: 'none',
      write: false,
      plugins: [dagModulesPlugin(request)],
    })
    const code = result.outputFiles?.[0]?.text
    if (!code) throw new Error('The DAG bundler produced no executable artifact.')
    return `(() => { ${code}; return __taskyonNode.default; })()`
  }
}
