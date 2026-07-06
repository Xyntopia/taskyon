import { clamp } from './graphUtils'
import type { LayoutGraph } from './types'

export type ViewportState = {
  scale: number
  tx: number
  ty: number
}

export const initialViewportState = (): ViewportState => ({
  scale: 1,
  tx: 0,
  ty: 0,
})

export const fitGraphToViewport = (
  graph: LayoutGraph,
  width: number,
  height: number,
  padding = 24,
): ViewportState => {
  const gw = Math.max(1, graph.bounds.width)
  const gh = Math.max(1, graph.bounds.height)
  const scale = Math.min((width - padding * 2) / gw, (height - padding * 2) / gh, 1)
  const tx = (width - gw * scale) / 2 - graph.bounds.x * scale
  const ty = (height - gh * scale) / 2 - graph.bounds.y * scale
  return { scale, tx, ty }
}

export const viewportTransform = (state: ViewportState): string =>
  `translate(${state.tx} ${state.ty}) scale(${state.scale})`

export const applyWheelZoom = (
  state: ViewportState,
  opts: {
    deltaY: number
    anchorX: number
    anchorY: number
    minZoom: number
    maxZoom: number
    step: number
  },
): ViewportState => {
  const direction = opts.deltaY > 0 ? -1 : 1
  const factor = 1 + direction * opts.step
  const nextScale = clamp(state.scale * factor, opts.minZoom, opts.maxZoom)
  if (nextScale === state.scale) return state

  const wx = (opts.anchorX - state.tx) / state.scale
  const wy = (opts.anchorY - state.ty) / state.scale
  const tx = opts.anchorX - wx * nextScale
  const ty = opts.anchorY - wy * nextScale
  return { scale: nextScale, tx, ty }
}
