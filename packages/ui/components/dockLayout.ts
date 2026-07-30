export interface DockNode {
  id: string
  type: 'container' | 'leaf'
  direction?: 'row' | 'column'
  children?: DockNode[]
  views?: string[]
  activeViewIndex?: number
  showTabs?: 'always' | 'auto' | 'never'
  tabPosition?: 'top' | 'left'
  tabRailMode?: 'expanded' | 'compact'
  tabRailCollapsible?: boolean
  tabRailAutoCompact?: boolean
  animateTransitions?: boolean
  size?: number
  sizeMode?: 'weight' | 'content'
  collapsed?: boolean
  lastSize?: number
  keepAliveViews?: string[]
  retainWhenEmpty?: boolean
}

export type DockPosition = 'tab' | 'left' | 'right' | 'top' | 'bottom'

export interface DockViewDropContext {
  viewId: string
  sourceLeafId: string
  sourceIndex: number
  targetLeafId: string
  targetIndex?: number
  position: DockPosition
}

export const MIN_RESTORE_WEIGHT = 20

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const viewIds = (root: DockNode): string[] => {
  if (root.type === 'leaf') return root.views ?? []
  return (root.children ?? []).flatMap(viewIds)
}

export const findLeaf = (root: DockNode, leafId: string): DockNode | undefined => {
  if (root.type === 'leaf') return root.id === leafId ? root : undefined
  for (const child of root.children ?? []) {
    const match = findLeaf(child, leafId)
    if (match) return match
  }
  return undefined
}

export const updateLeaf = (
  root: DockNode,
  leafId: string,
  update: (leaf: DockNode) => DockNode,
): DockNode => {
  if (root.type === 'leaf') return root.id === leafId ? update(root) : root
  const children = (root.children ?? []).map((child) => updateLeaf(child, leafId, update))
  return children.every((child, index) => child === root.children?.[index])
    ? root
    : { ...root, children }
}

export const addViewToLeaf = (leaf: DockNode, viewId: string, makeActive = true): DockNode => {
  if (leaf.type !== 'leaf') return leaf
  const views = [...(leaf.views ?? []), viewId]
  const activeViewIndex = makeActive ? views.length - 1 : (leaf.activeViewIndex ?? 0)
  return { ...leaf, views, activeViewIndex }
}

export const getLeafRestoreSize = (leaf: DockNode): number =>
  Math.max(leaf.lastSize ?? MIN_RESTORE_WEIGHT, MIN_RESTORE_WEIGHT)

const removeViewFromLeaf = (
  leaf: DockNode,
  sourceIndex: number,
): { leaf: DockNode | null; keepAlive: boolean } => {
  const views = leaf.views ?? []
  const viewId = views[sourceIndex]
  if (!viewId) return { leaf, keepAlive: false }

  const nextViews = views.filter((_, index) => index !== sourceIndex)
  const keepAlive = (leaf.keepAliveViews ?? []).includes(viewId)
  if (nextViews.length === 0 && leaf.retainWhenEmpty !== true) return { leaf: null, keepAlive }

  const activeIndex = leaf.activeViewIndex ?? 0
  const nextActiveIndex =
    nextViews.length === 0
      ? 0
      : sourceIndex < activeIndex
        ? activeIndex - 1
        : Math.min(activeIndex, nextViews.length - 1)

  return {
    leaf: {
      ...leaf,
      views: nextViews,
      activeViewIndex: nextActiveIndex,
      keepAliveViews: (leaf.keepAliveViews ?? []).filter((id) => id !== viewId),
    },
    keepAlive,
  }
}

const removeDockedView = (
  root: DockNode,
  sourceLeafId: string,
  sourceIndex: number,
): { node: DockNode | null; keepAlive: boolean } => {
  if (root.type === 'leaf') {
    if (root.id !== sourceLeafId) return { node: root, keepAlive: false }
    const removed = removeViewFromLeaf(root, sourceIndex)
    return { node: removed.leaf, keepAlive: removed.keepAlive }
  }

  let keepAlive = false
  const children = (root.children ?? []).flatMap((child) => {
    const removed = removeDockedView(child, sourceLeafId, sourceIndex)
    keepAlive ||= removed.keepAlive
    return removed.node ? [removed.node] : []
  })

  if (children.length === 0) return { node: null, keepAlive }
  if (children.length === 1) {
    const child = children[0]!
    return {
      node: root.size === undefined ? child : { ...child, size: root.size },
      keepAlive,
    }
  }
  return { node: { ...root, children }, keepAlive }
}

const insertView = (
  leaf: DockNode,
  viewId: string,
  targetIndex: number | undefined,
  keepAlive: boolean,
): DockNode => {
  const views = [...(leaf.views ?? [])]
  const insertAt = clamp(targetIndex ?? views.length, 0, views.length)
  views.splice(insertAt, 0, viewId)
  const expanded = leaf.collapsed === true || leaf.size === 0
  return {
    ...leaf,
    collapsed: false,
    ...(expanded ? { size: getLeafRestoreSize(leaf) } : {}),
    views,
    activeViewIndex: insertAt,
    ...(keepAlive
      ? { keepAliveViews: [...new Set([...(leaf.keepAliveViews ?? []), viewId])] }
      : {}),
  }
}

const reorderView = (leaf: DockNode, sourceIndex: number, targetIndex: number): DockNode => {
  const views = [...(leaf.views ?? [])]
  const [viewId] = views.splice(sourceIndex, 1)
  if (!viewId) return leaf
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  const insertAt = clamp(adjustedTarget, 0, views.length)
  views.splice(insertAt, 0, viewId)
  return { ...leaf, views, activeViewIndex: insertAt }
}

const createDockNodeId = (kind: 'leaf' | 'container'): string => {
  const id =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `dock-${kind}-${id}`
}

const insertEdgeSplit = (
  root: DockNode,
  targetLeafId: string,
  viewId: string,
  position: Exclude<DockPosition, 'tab'>,
  keepAlive: boolean,
): DockNode => {
  if (root.type === 'leaf') {
    if (root.id !== targetLeafId) return root
    const direction = position === 'left' || position === 'right' ? 'row' : 'column'
    const newLeaf: DockNode = {
      id: createDockNodeId('leaf'),
      type: 'leaf',
      views: [viewId],
      activeViewIndex: 0,
      ...(keepAlive ? { keepAliveViews: [viewId] } : {}),
      size: 1,
    }
    const target = { ...root, collapsed: false, size: 1 }
    const before = position === 'left' || position === 'top'
    return {
      id: createDockNodeId('container'),
      type: 'container',
      direction,
      ...(root.size === undefined ? {} : { size: root.size }),
      children: before ? [newLeaf, target] : [target, newLeaf],
    }
  }

  const children = root.children ?? []
  const targetIndex = children.findIndex((child) => child.id === targetLeafId)
  const direction = position === 'left' || position === 'right' ? 'row' : 'column'
  if (root.direction === direction && targetIndex >= 0) {
    const target = children[targetIndex]!
    const targetSize = target.size ?? 1
    const newLeaf: DockNode = {
      id: createDockNodeId('leaf'),
      type: 'leaf',
      views: [viewId],
      activeViewIndex: 0,
      ...(keepAlive ? { keepAliveViews: [viewId] } : {}),
      size: targetSize / 2,
    }
    const resizedTarget = { ...target, collapsed: false, size: targetSize / 2 }
    const next = [...children]
    const before = position === 'left' || position === 'top'
    next.splice(targetIndex, 1, ...(before ? [newLeaf, resizedTarget] : [resizedTarget, newLeaf]))
    return { ...root, children: next }
  }

  const next = children.map((child) =>
    insertEdgeSplit(child, targetLeafId, viewId, position, keepAlive),
  )
  return next.every((child, index) => child === children[index])
    ? root
    : { ...root, children: next }
}

export const applyDockDrop = (root: DockNode, context: DockViewDropContext): DockNode => {
  if (context.position === 'tab' && context.sourceLeafId === context.targetLeafId) {
    const targetIndex = context.targetIndex
    if (targetIndex === undefined) return root
    return updateLeaf(root, context.sourceLeafId, (leaf) =>
      reorderView(leaf, context.sourceIndex, targetIndex),
    )
  }

  const removed = removeDockedView(root, context.sourceLeafId, context.sourceIndex)
  if (!removed.node) return root
  if (context.position === 'tab') {
    return updateLeaf(removed.node, context.targetLeafId, (leaf) =>
      insertView(leaf, context.viewId, context.targetIndex, removed.keepAlive),
    )
  }
  return insertEdgeSplit(
    removed.node,
    context.targetLeafId,
    context.viewId,
    context.position,
    removed.keepAlive,
  )
}
