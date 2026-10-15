import { z } from 'zod'
import { readTextFile } from './builtIn/textFileSource.ts'

export const projectInputReadCapability = 'taskyon.project-input.read-text/v1'

export const readProjectInput = async (
  input: unknown,
  read: (path: string) => Promise<string>,
  projectId?: string,
) => {
  const { path } = z
    .object({ path: z.string().startsWith('inputs/') })
    .strict()
    .parse(input)
  if (projectId && !path.startsWith(`inputs/${projectId}/`))
    throw new Error('Input files must belong to the invocation project.')
  return await readTextFile(path, read)
}

export const projectInputSourceDeclaration = `export default {
  formatVersion: 3, version: 1, effect: 'source',
  capabilities: ['taskyon.project-input.read-text/v1'],
  localParamsSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  outputSchema: { type: 'string', description: 'Pinned UTF-8 project input file contents.' },
  ids: { projectInput: { inputs: {} } },
  run: async ({ params, services }) => await services.callCapability('taskyon.project-input.read-text/v1', { path: params.path }),
}
`
