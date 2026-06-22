import type { ModelicaLibraryTreeNode } from './types'

export type RumocaClassTreeNode = {
  name?: unknown
  qualified_name?: unknown
  class_type?: unknown
  children?: unknown
}

function normalizeNode(input: unknown): RumocaClassTreeNode {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as RumocaClassTreeNode
}

function mapSingleNode(node: RumocaClassTreeNode): ModelicaLibraryTreeNode | null {
  const label = typeof node.name === 'string' ? node.name : ''
  const qualifiedName = typeof node.qualified_name === 'string' ? node.qualified_name : label
  if (!label || !qualifiedName) return null

  const childrenRaw = Array.isArray(node.children) ? node.children : []
  const children = childrenRaw
    .map((entry) => mapSingleNode(normalizeNode(entry)))
    .filter((entry): entry is ModelicaLibraryTreeNode => entry != null)

  const mapped: ModelicaLibraryTreeNode = {
    id: qualifiedName,
    label,
    qualifiedName,
  }

  if (typeof node.class_type === 'string' && node.class_type.length > 0) {
    mapped.classType = node.class_type
  }
  if (children.length > 0) mapped.children = children

  return mapped
}

export function mapRumocaClassTree(input: unknown): ModelicaLibraryTreeNode[] {
  const classes = Array.isArray(input) ? input : []
  return classes
    .map((entry) => mapSingleNode(normalizeNode(entry)))
    .filter((entry): entry is ModelicaLibraryTreeNode => entry != null)
}
