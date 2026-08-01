import { hashFilePart } from './dagNodeIdentity.ts'
import type { SavedStoredGraphNode } from './dagNodeLoader.ts'
import type { DagInvocationRecord } from './dagInvocation.ts'
import type { Hash } from './caching.ts'

export type DagDefinitionRef = { nodeId: Hash } | { invocationId: Hash }

export type DagProjectedFile = {
  path: string
  content: string
}

const safeSegment = (value: string, label: string): string => {
  const segment = value.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!segment || segment === '.' || segment === '..') {
    throw new Error(`${label} must contain a safe filename character.`)
  }
  return segment
}

const jsonFile = (path: string, value: unknown): DagProjectedFile => ({
  path,
  content: `${JSON.stringify(value, null, 2)}\n`,
})

export const projectDagDefinitions = (args: {
  nodes: readonly SavedStoredGraphNode[]
  invocations: readonly DagInvocationRecord[]
  refs: Record<string, DagDefinitionRef>
}): DagProjectedFile[] => {
  const files: DagProjectedFile[] = []
  for (const node of args.nodes) {
    files.push({
      path: `nodes/${safeSegment(node.node.localName, 'Node local name')}.${hashFilePart(node.hash)}.ts`,
      content: node.file.source.endsWith('\n') ? node.file.source : `${node.file.source}\n`,
    })
  }
  for (const invocation of args.invocations) {
    files.push(
      jsonFile(
        `invocations/${safeSegment(invocation.localName, 'Invocation local name')}.${hashFilePart(invocation.id)}.json`,
        invocation,
      ),
    )
  }
  for (const [name, ref] of Object.entries(args.refs)) {
    files.push(jsonFile(`refs/${safeSegment(name, 'Ref name')}.json`, ref))
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
