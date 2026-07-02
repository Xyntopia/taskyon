import type { GraphData } from '../modules/graph/types.ts'
import { describeExploreInputs } from './dagCore.ts'

type RuntimeDagNode = {
  name: string
  outputSchema?: unknown
  hiddenInputs?: Record<string, RuntimeDagNode>
  exposedInputs?: Record<string, RuntimeDagNode | { kind: 'oneOf'; options: RuntimeDagNode[] }>
}

export type DagNodeGraphNodeData = {
  isOutput: boolean
  isExploded: boolean
  outputDescription: string
}

export type DagNodeGraphEdgeData = {
  alias: string
  visibility: 'hidden' | 'exposed'
  isExplodedOutput: boolean
  sourcePath?: string
}

export type DagNodeGraph = GraphData<DagNodeGraphNodeData, DagNodeGraphEdgeData>

const isOneOf = (
  value: RuntimeDagNode | { kind: 'oneOf'; options: RuntimeDagNode[] },
): value is { kind: 'oneOf'; options: RuntimeDagNode[] } =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'oneOf'

const isExplodedNode = (node: RuntimeDagNode): boolean => node.name.includes('__explode__')

const toTitleCaseToken = (token: string): string => {
  if (!token) return token
  if (token.toUpperCase() === token) return token
  return token[0]!.toUpperCase() + token.slice(1)
}

const formatNodeLabel = (rawName: string): string => {
  const explodeNormalized = rawName.replace(/__explode__/g, ' explode ')
  const withSpaces = explodeNormalized
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  const titled = withSpaces
    .split(' ')
    .map((x) => toTitleCaseToken(x))
    .join(' ')
  return titled.length > 0 ? titled : rawName
}

const unwrapSchema = (schema: unknown): unknown => {
  let cur = schema as
    | { _def?: { innerType?: unknown; schema?: unknown; type?: unknown } }
    | undefined
  const seen = new Set<unknown>()
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const def = cur._def
    if (!def || typeof def !== 'object') break
    const next = def.innerType ?? def.schema ?? def.type
    if (!next || next === cur) break
    cur = next as typeof cur
  }
  return cur
}

const inferSchemaSummary = (schema: unknown): string => {
  if (!schema || typeof schema !== 'object') return 'Output value'
  const z = schema as {
    _def?: {
      typeName?: string
      type?: string
      shape?: unknown
      element?: unknown
      innerType?: unknown
    }
  }
  const def = z._def
  const typeName = String(def?.typeName ?? def?.type ?? '').toLowerCase()
  const shapeMaybe = def?.shape as
    | { [k: string]: unknown }
    | (() => { [k: string]: unknown })
    | undefined
  const shape =
    typeof shapeMaybe === 'function'
      ? (() => {
          try {
            return shapeMaybe()
          } catch {
            return undefined
          }
        })()
      : shapeMaybe

  if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
    const keys = Object.keys(shape)
    if (keys.length === 0) return 'Object output'
    const preview = keys.slice(0, 5).join(', ')
    const suffix = keys.length > 5 ? `, +${keys.length - 5} more` : ''
    return `Object output with fields: ${preview}${suffix}`
  }
  if (typeName.includes('array')) return 'Array output'
  if (typeName.includes('string')) return 'String output'
  if (typeName.includes('number')) return 'Numeric output'
  if (typeName.includes('boolean')) return 'Boolean output'
  if (typeName.includes('object')) return 'Object output'
  return 'Output value'
}

const schemaTopDescription = (schema: unknown): string => {
  if (!schema || typeof schema !== 'object') return 'Output value'
  const direct = (schema as { description?: unknown }).description
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  const unwrapped = unwrapSchema(schema)
  if (unwrapped && typeof unwrapped === 'object') {
    const d = (unwrapped as { description?: unknown }).description
    if (typeof d === 'string' && d.trim().length > 0) return d.trim()
    return inferSchemaSummary(unwrapped)
  }
  return inferSchemaSummary(schema)
}

const edgeType = (
  visibility: 'hidden' | 'exposed',
  isExplodedOutput: boolean,
): 'hidden-normal' | 'hidden-exploded-output' | 'exposed-normal' | 'exposed-exploded-output' => {
  if (visibility === 'hidden') return isExplodedOutput ? 'hidden-exploded-output' : 'hidden-normal'
  return isExplodedOutput ? 'exposed-exploded-output' : 'exposed-normal'
}

export const buildDagNodeGraphFromOutputNodes = (
  outputNodes: Record<string, RuntimeDagNode>,
): DagNodeGraph => {
  const nodes = new Map<
    string,
    { id: string; label: string; type: string; data: DagNodeGraphNodeData }
  >()
  const edges = new Map<
    string,
    {
      id: string
      source: string
      target: string
      type:
        | 'hidden-normal'
        | 'hidden-exploded-output'
        | 'exposed-normal'
        | 'exposed-exploded-output'
      label: string
      data: DagNodeGraphEdgeData
    }
  >()
  const visited = new Set<string>()

  const addNode = (node: RuntimeDagNode) => {
    const existing = nodes.get(node.name)
    if (existing) return
    const exploded = isExplodedNode(node)
    nodes.set(node.name, {
      id: node.name,
      label: formatNodeLabel(node.name),
      type: exploded ? 'exploded' : 'default',
      data: {
        isOutput: false,
        isExploded: exploded,
        outputDescription: schemaTopDescription(node.outputSchema),
      },
    })
  }

  const addEdge = (
    source: RuntimeDagNode,
    target: RuntimeDagNode,
    alias: string,
    visibility: 'hidden' | 'exposed',
    sourcePath?: string,
  ) => {
    const isExplodedOutput = isExplodedNode(source)
    const type = edgeType(visibility, isExplodedOutput)
    const id = `${source.name}->${target.name}::${visibility}:${alias}`
    if (edges.has(id)) return
    edges.set(id, {
      id,
      source: source.name,
      target: target.name,
      type,
      label: alias,
      data: {
        alias,
        visibility,
        isExplodedOutput,
        ...(sourcePath ? { sourcePath } : {}),
      },
    })
  }

  const walk = (node: RuntimeDagNode) => {
    addNode(node)
    if (visited.has(node.name)) return
    visited.add(node.name)

    const explodedByAlias = new Map(
      describeExploreInputs(node)
        .filter((x) => x.isExploded)
        .map((x) => [x.alias, x.explode?.sourcePath]),
    )

    const hidden = node.hiddenInputs ?? {}
    for (const [alias, child] of Object.entries(hidden)) {
      addNode(child)
      addEdge(child, node, alias, 'hidden')
      walk(child)
    }

    const exposed = node.exposedInputs ?? {}
    for (const [alias, def] of Object.entries(exposed)) {
      const providers = isOneOf(def) ? def.options : [def]
      const sourcePath = explodedByAlias.get(alias)
      for (const provider of providers) {
        addNode(provider)
        addEdge(provider, node, alias, 'exposed', sourcePath)
        walk(provider)
      }
    }
  }

  Object.values(outputNodes).forEach((node) => walk(node))

  const incomingCounts = new Map<string, number>()
  const outgoingCounts = new Map<string, number>()
  for (const edge of edges.values()) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1)
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1)
  }

  for (const node of nodes.values()) {
    const incoming = incomingCounts.get(node.id) ?? 0
    const outgoing = outgoingCounts.get(node.id) ?? 0
    const isOutput = outgoing === 0
    node.data = { ...node.data, isOutput }

    if (isOutput) {
      node.type = node.data.isExploded ? 'exploded-output' : 'output'
      continue
    }

    if (incoming === 0) {
      node.type = node.data.isExploded ? 'exploded-input' : 'input'
      continue
    }

    node.type = node.data.isExploded ? 'exploded' : 'default'
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  }
}
