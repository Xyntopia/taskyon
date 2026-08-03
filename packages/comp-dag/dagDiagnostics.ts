import type { DagNode } from './dagCore.ts'
import { describeDagEnvironment } from './dagEnvironment.ts'

export type DagDiagnosticStatus = 'idle' | 'running' | 'cached' | 'completed' | 'failed' | 'blocked'

export type DagDiagnosticLog = {
  atMs: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: unknown
}

export type DagDiagnosticNode = {
  id: string
  label: string
  effect: 'pure' | 'source'
  status: DagDiagnosticStatus
  error?: string
  blockedBy?: string[]
}

type DagExecutionEvent = {
  nodeId: string
  nodeName: string
  status: Exclude<DagDiagnosticStatus, 'idle' | 'blocked'>
  error?: string
}

export const dagExecutionEvent = (value: unknown): DagExecutionEvent | null => {
  if (typeof value !== 'object' || value === null || !('taskyonDag' in value)) return null
  const event = (value as { taskyonDag?: unknown }).taskyonDag
  if (typeof event !== 'object' || event === null) return null
  const nodeId = 'nodeId' in event ? event.nodeId : undefined
  const nodeName = 'nodeName' in event ? event.nodeName : undefined
  const status = 'status' in event ? event.status : undefined
  if (
    typeof nodeId !== 'string' ||
    typeof nodeName !== 'string' ||
    (status !== 'running' && status !== 'cached' && status !== 'completed' && status !== 'failed')
  ) {
    return null
  }
  const error = 'error' in event && typeof event.error === 'string' ? event.error : undefined
  return { nodeId, nodeName, status, ...(error ? { error } : {}) }
}

export const deriveDagDiagnostics = (
  root: DagNode,
  logs: readonly DagDiagnosticLog[],
): DagDiagnosticNode[] => {
  const environment = describeDagEnvironment(root)
  const latestByNode = new Map<string, DagExecutionEvent>()
  for (const entry of logs) {
    const event = dagExecutionEvent(entry.data)
    if (event) latestByNode.set(event.nodeId, event)
  }
  const failedNodes = new Set(
    [...latestByNode.values()]
      .filter(({ status }) => status === 'failed')
      .map(({ nodeId }) => nodeId),
  )
  const nodeId = (node: DagNode) => node.contentHash ?? node.name
  const blockedByNode = new Map<DagNode, Set<string>>()
  const markDownstream = (node: DagNode, failedId: string, visited: Set<DagNode>) => {
    if (visited.has(node)) return
    visited.add(node)
    for (const consumer of environment.downstreamByNode.get(node) ?? []) {
      const blockers = blockedByNode.get(consumer) ?? new Set<string>()
      blockers.add(failedId)
      blockedByNode.set(consumer, blockers)
      markDownstream(consumer, failedId, visited)
    }
  }
  for (const node of environment.nodes) {
    const id = nodeId(node)
    if (failedNodes.has(id)) markDownstream(node, id, new Set())
  }
  return environment.nodes.map((node) => {
    const id = nodeId(node)
    const latest = latestByNode.get(id)
    const blockers = latest?.status === 'failed' ? [] : [...(blockedByNode.get(node) ?? [])]
    return {
      id,
      label: node.localName ?? node.name,
      effect: node.effect,
      status: blockers.length > 0 ? ('blocked' as const) : (latest?.status ?? 'idle'),
      ...(latest?.error ? { error: latest.error } : {}),
      ...(blockers.length > 0 ? { blockedBy: blockers } : {}),
    }
  })
}
