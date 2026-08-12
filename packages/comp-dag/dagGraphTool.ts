import type { StoredGraphNodeFile } from './dagNodeLoader.ts'
import {
  createStoredDagSourceGraph,
  patchStoredDagSourceGraphNode,
  type DagGraphRoots,
  type StoredDagSourceGraphPatch,
} from './storedDagSourceGraph.ts'

export const dagGraphToolResultType = 'graphPatchResult' as const

export type DagGraphPatchToolResult = StoredDagSourceGraphPatch & {
  type: typeof dagGraphToolResultType
  projectId: string
  createdFiles: StoredGraphNodeFile[]
}

export type DagGraphPatchToolParams = {
  projectId: string
  files: StoredGraphNodeFile[]
  roots: DagGraphRoots
  rootName: string
  targetLocalName: string
  source: string
}

export type DagGraphPatchToolDefinition = {
  name: 'dagGraphPatch'
  description: string
  longDescription: string
  parameters: typeof dagGraphPatchToolParameters
  function: (params: DagGraphPatchToolParams) => Promise<DagGraphPatchToolResult>
}

export type DagGraphCreateTool = <T extends DagGraphPatchToolDefinition>(tool: T) => T

const dagGraphPatchToolParameters = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Stable project or graph id used by the caller to identify this graph snapshot.',
    },
    files: {
      type: 'array',
      description: 'Stored TypeScript DAG node files that define the current graph snapshot.',
      items: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative stored node file path.',
          },
          source: {
            type: 'string',
            description: 'Full TypeScript source of the stored DAG node file.',
          },
        },
        required: ['path', 'source'] as string[],
        additionalProperties: false,
      },
    },
    roots: {
      type: 'object',
      description: 'Named graph roots for the current selected graph snapshot.',
      additionalProperties: { type: 'string' },
    },
    rootName: {
      type: 'string',
      description: 'Name of the selected root to patch and advance.',
    },
    targetLocalName: {
      type: 'string',
      description: 'Local node name inside the selected subgraph that should be replaced.',
    },
    source: {
      type: 'string',
      description:
        'Full replacement TypeScript source for the target stored DAG node. The tool normalizes and hashes it.',
    },
  },
  required: ['projectId', 'files', 'roots', 'rootName', 'targetLocalName', 'source'] as string[],
  additionalProperties: false,
} as const

const changedNodeFiles = (
  filesByHash: Awaited<ReturnType<typeof createStoredDagSourceGraph>>['nodesByHash'],
  patch: StoredDagSourceGraphPatch,
): StoredGraphNodeFile[] =>
  Object.values(patch.changedNodes).map((change) => {
    const saved = filesByHash[change.newHash]
    if (!saved) throw new Error(`Patched graph is missing changed node ${change.newHash}`)
    return saved.file
  })

export const createDagGraphPatchTool = (createTool: DagGraphCreateTool) =>
  createTool({
    name: 'dagGraphPatch',
    description: 'Patch a stored DAG graph node and advance the selected immutable graph root.',
    longDescription: `Patch one TypeScript stored DAG node by local name, normalize and hash the replacement,
propagate hash changes through downstream nodes, and return the new immutable root pointer plus the created files.`,
    parameters: dagGraphPatchToolParameters,
    function: async (params) => {
      const storedGraph = await createStoredDagSourceGraph({
        files: params.files,
        roots: params.roots,
      })
      const patched = await patchStoredDagSourceGraphNode({
        storedGraph,
        rootName: params.rootName,
        targetLocalName: params.targetLocalName,
        updateSource: () => params.source,
      })

      return {
        type: dagGraphToolResultType,
        projectId: params.projectId,
        ...patched.patch,
        createdFiles: changedNodeFiles(patched.storedGraph.nodesByHash, patched.patch),
      }
    },
  })
