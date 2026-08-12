import { findLeavesByRegion, splitDockView, type DockNode } from './dockLayout'

export const testDockLayoutPreservesDocumentRegionsAcrossSplits = () => {
  const layout: DockNode = {
    id: 'document',
    type: 'leaf',
    region: 'document',
    views: ['first'],
  }
  const inherited = splitDockView(layout, {
    viewId: 'second',
    targetLeafId: 'document',
    position: 'right',
  })
  if (findLeavesByRegion(inherited, 'document').length !== 2) {
    throw new Error('Expected a split document leaf to create another document leaf.')
  }

  const navigation: DockNode = {
    id: 'navigation',
    type: 'leaf',
    region: 'navigation',
    views: ['tree'],
  }
  const fallback = splitDockView(navigation, {
    viewId: 'editor',
    targetLeafId: 'navigation',
    position: 'right',
    region: 'document',
  })
  const documentLeaves = findLeavesByRegion(fallback, 'document')
  if (documentLeaves.length !== 1 || documentLeaves[0]?.views?.[0] !== 'editor') {
    throw new Error('Expected an explicit document fallback beside the navigation leaf.')
  }
}

testDockLayoutPreservesDocumentRegionsAcrossSplits.description =
  'Preserves semantic DockView regions and supports an explicit document split fallback.'
