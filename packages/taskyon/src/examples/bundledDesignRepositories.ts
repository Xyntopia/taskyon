import type { DagProjectedFile } from '@taskyon/comp-dag/dagGitProjection'

/** Vite discovers source files; canonical graph records are generated only when the example opens. */
export const loadBundledDesignRepositorySources = async (
  projectId: string,
): Promise<DagProjectedFile[]> => {
  if (!/^[a-z][a-z0-9-]*$/.test(projectId)) throw new Error('Invalid bundled repository id.')
  const modules = import.meta.glob<string>(
    [
      '../../../../public/design-repositories/*/{nodes,modules,imports,projects,assets}/**/*.{ts,json,md}',
      '../../../../public/design-repositories/*/graph.lock.json',
    ],
    { query: '?raw', import: 'default' },
  )
  const prefix = `../../../../public/design-repositories/${projectId}/`
  const selected = Object.entries(modules).filter(([path]) => path.startsWith(prefix))
  if (!selected.length) throw new Error(`Bundled design repository not found: ${projectId}`)
  return await Promise.all(
    selected.map(async ([path, load]) => ({
      path: path.slice(prefix.length),
      content: await load(),
    })),
  )
}
