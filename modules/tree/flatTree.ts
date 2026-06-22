export type TreeIndex<T> = {
  roots: string[]
  nodeById: Record<string, T>
  childrenById: Record<string, string[]>
  parentById: Record<string, string | null>
}

export function createTreeIndex<T extends { id: string; children?: T[] }>(nodes: T[]): TreeIndex<T> {
  const roots: string[] = []
  const nodeById: Record<string, T> = {}
  const childrenById: Record<string, string[]> = {}
  const parentById: Record<string, string | null> = {}

  const visit = (node: T, parentId: string | null): void => {
    if (!node.id || nodeById[node.id]) return
    nodeById[node.id] = node
    parentById[node.id] = parentId
    const children = Array.isArray(node.children) ? node.children : []
    const childIds = children.map((child) => child.id).filter((id) => Boolean(id))
    childrenById[node.id] = childIds
    for (const child of children) visit(child, node.id)
  }

  for (const node of nodes) {
    if (!node.id) continue
    roots.push(node.id)
    visit(node, null)
  }

  return { roots, nodeById, childrenById, parentById }
}

export function toggleExpandedId(expandedIds: string[], id: string): string[] {
  if (!id) return expandedIds
  if (expandedIds.includes(id)) return expandedIds.filter((entry) => entry !== id)
  return [...expandedIds, id]
}

export function collapseAll(): string[] {
  return []
}

export function expandRoots<T>(index: TreeIndex<T>): string[] {
  return [...index.roots]
}

export function buildVisibleRows<T, R>(
  index: TreeIndex<T>,
  expandedIds: string[],
  toRow: (node: T, id: string, depth: number, expanded: boolean, hasChildren: boolean) => R,
): R[] {
  const expanded = new Set(expandedIds)
  const rows: R[] = []

  const visit = (id: string, depth: number): void => {
    const node = index.nodeById[id]
    if (!node) return
    const children = index.childrenById[id] ?? []
    const row = toRow(node, id, depth, expanded.has(id), children.length > 0)
    rows.push(row)
    if (!expanded.has(id)) return
    for (const childId of children) visit(childId, depth + 1)
  }

  for (const rootId of index.roots) visit(rootId, 0)
  return rows
}

function collectAncestors<T>(index: TreeIndex<T>, id: string): string[] {
  const ids: string[] = []
  let current = index.parentById[id] ?? null
  while (current) {
    ids.push(current)
    current = index.parentById[current] ?? null
  }
  return ids
}

function depthFor<T>(index: TreeIndex<T>, id: string): number {
  let depth = 0
  let current = index.parentById[id] ?? null
  while (current) {
    depth += 1
    current = index.parentById[current] ?? null
  }
  return depth
}

export function buildFilteredRows<T, R>(
  index: TreeIndex<T>,
  query: string,
  matches: (node: T, queryLower: string) => boolean,
  toRow: (node: T, id: string, depth: number, expanded: boolean, hasChildren: boolean) => R,
  maxRows = 2000,
): R[] {
  const queryLower = query.trim().toLowerCase()
  if (!queryLower) return []

  const include = new Set<string>()
  for (const id of Object.keys(index.nodeById)) {
    const node = index.nodeById[id]
    if (!node || !matches(node, queryLower)) continue
    include.add(id)
    for (const ancestorId of collectAncestors(index, id)) include.add(ancestorId)
  }

  const rows: R[] = []
  const visit = (id: string): void => {
    if (rows.length >= maxRows || !include.has(id)) return
    const node = index.nodeById[id]
    if (!node) return
    const children = index.childrenById[id] ?? []
    rows.push(toRow(node, id, depthFor(index, id), true, children.length > 0))
    for (const childId of children) visit(childId)
  }

  for (const rootId of index.roots) visit(rootId)
  return rows
}
