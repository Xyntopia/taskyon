import { layoutGraph, routeLayoutEdges } from './layout'
import { svgStringToPngUint8 } from '../svgUtils'
import {
  applyWheelZoom,
  fitGraphToViewport,
  initialViewportState,
  viewportTransform,
  type ViewportState,
} from './interactions'
import type {
  EdgeStyle,
  GraphData,
  GraphTheme,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  NodeStyle,
  RenderOptions,
} from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'

const createSvgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
): SVGElementTagNameMap[K] => document.createElementNS(SVG_NS, tag)

const mergeNodeStyle = (theme: GraphTheme | undefined, node: LayoutNode): Required<NodeStyle> => {
  const base = theme?.defaultNodeStyle ?? {}
  const custom = node.type ? (theme?.nodeStyles?.[node.type] ?? {}) : {}
  return {
    fill: custom.fill ?? base.fill ?? 'rgba(16, 24, 40, 0.06)',
    stroke: custom.stroke ?? base.stroke ?? 'rgba(16, 24, 40, 0.45)',
    strokeWidth: custom.strokeWidth ?? base.strokeWidth ?? 1.5,
    rx: custom.rx ?? base.rx ?? 8,
    ry: custom.ry ?? base.ry ?? 8,
    textColor: custom.textColor ?? base.textColor ?? 'rgba(16, 24, 40, 1)',
    fontSize: custom.fontSize ?? base.fontSize ?? 12,
    fontFamily: custom.fontFamily ?? base.fontFamily ?? 'ui-monospace, SFMono-Regular, monospace',
    fontWeight: custom.fontWeight ?? base.fontWeight ?? 600,
    glowColor: custom.glowColor ?? base.glowColor ?? '',
    glowBlur: custom.glowBlur ?? base.glowBlur ?? 0,
  }
}

const mergePartialNodeStyle = (
  base: Required<NodeStyle>,
  patch: NodeStyle | undefined,
): Required<NodeStyle> => ({
  ...base,
  ...(patch ?? {}),
})

const mergeEdgeStyle = (theme: GraphTheme | undefined, edge: LayoutEdge): Required<EdgeStyle> => {
  const base = theme?.defaultEdgeStyle ?? {}
  const custom = edge.type ? (theme?.edgeStyles?.[edge.type] ?? {}) : {}
  return {
    stroke: custom.stroke ?? base.stroke ?? 'rgba(71, 84, 103, 0.9)',
    strokeWidth: custom.strokeWidth ?? base.strokeWidth ?? 1.4,
    dasharray: custom.dasharray ?? base.dasharray ?? '',
    opacity: custom.opacity ?? base.opacity ?? 1,
    glowColor: custom.glowColor ?? base.glowColor ?? '',
    glowBlur: custom.glowBlur ?? base.glowBlur ?? 0,
  }
}

const setAttrs = (el: Element, attrs: Record<string, string | number | undefined>) => {
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined) return
    el.setAttribute(key, String(value))
  })
}

const clearChildren = (el: Element) => {
  while (el.firstChild) el.removeChild(el.firstChild)
}

const px = (value: string): number => {
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const createTooltip = (container: HTMLElement) => {
  const tooltip = document.createElement('div')
  tooltip.style.position = 'absolute'
  tooltip.style.pointerEvents = 'none'
  tooltip.style.zIndex = '3'
  tooltip.style.display = 'none'
  tooltip.style.maxWidth = '340px'
  tooltip.style.padding = '6px 8px'
  tooltip.style.borderRadius = '6px'
  tooltip.style.background = 'rgba(15, 23, 42, 0.92)'
  tooltip.style.color = 'white'
  tooltip.style.fontSize = '12px'
  tooltip.style.lineHeight = '1.35'
  tooltip.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace'
  container.appendChild(tooltip)
  return tooltip
}

type GraphController<N = unknown, E = unknown> = {
  setGraph: (graph: GraphData<N, E>) => void
  setOptions: (options: RenderOptions<N, E>) => void
  resize: () => void
  fit: () => void
  copyAsPng: (options?: {
    scale?: number
    cropToContent?: boolean
    cropPadding?: number
    backgroundColor?: string
  }) => Promise<boolean>
  exportSvgString: (options?: {
    includeHtmlLayer?: boolean
    cropToContent?: boolean
    cropPadding?: number
    backgroundColor?: string
  }) => string
  downloadSvg: (fileName?: string) => void
  destroy: () => void
}

export const createGraphController = <N = unknown, E = unknown>(
  container: HTMLElement,
  initialGraph: GraphData<N, E>,
  initialOptions: RenderOptions<N, E> = {},
): GraphController<N, E> => {
  let graph = initialGraph
  let options = initialOptions
  let layout: LayoutGraph<N, E> = layoutGraph(graph, options)
  let viewport: ViewportState = initialViewportState()
  let isDragging = false
  let dragStart = { x: 0, y: 0, tx: 0, ty: 0 }
  let draggedNodeId: string | null = null
  let suppressClickForNodeId: string | null = null
  let draggedNodeMoved = false
  let nodeDragStart = { x: 0, y: 0, nodeX: 0, nodeY: 0 }

  container.style.position = 'relative'
  container.style.overflow = 'hidden'

  const svg = createSvgEl('svg')
  svg.style.display = 'block'
  svg.style.width = '100%'
  svg.style.height = '100%'
  svg.style.userSelect = 'none'

  const scene = createSvgEl('g')
  const defs = createSvgEl('defs')
  const edgeLayer = createSvgEl('g')
  const nodeLayer = createSvgEl('g')
  svg.appendChild(defs)
  scene.append(edgeLayer, nodeLayer)
  svg.appendChild(scene)
  container.appendChild(svg)

  const htmlLayer = document.createElement('div')
  htmlLayer.style.position = 'absolute'
  htmlLayer.style.left = '0'
  htmlLayer.style.top = '0'
  htmlLayer.style.width = '100%'
  htmlLayer.style.height = '100%'
  htmlLayer.style.pointerEvents = 'none'
  htmlLayer.style.zIndex = '2'
  container.appendChild(htmlLayer)

  const tooltip = createTooltip(container)

  const showTooltip = (html: string, clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect()
    tooltip.innerHTML = html
    tooltip.style.display = 'block'
    tooltip.style.left = `${clientX - rect.left + 10}px`
    tooltip.style.top = `${clientY - rect.top + 10}px`
  }

  const hideTooltip = () => {
    tooltip.style.display = 'none'
  }

  const updateTransforms = () => {
    setAttrs(scene, { transform: viewportTransform(viewport) })
    htmlLayer.style.transform = `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`
    htmlLayer.style.transformOrigin = '0 0'
  }

  const getSize = () => ({
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
  })

  const fit = () => {
    const { width, height } = getSize()
    viewport = fitGraphToViewport(layout, width, height, 24)
    updateTransforms()
  }

  const renderEdges = () => {
    clearChildren(edgeLayer)
    clearChildren(defs)
    const markerByKey = new Map<string, string>()
    let markerIndex = 0
    layout.edges.forEach((edge) => {
      const pathEl = createSvgEl('path')
      const style = {
        ...mergeEdgeStyle(options.theme, edge),
        ...(options.edgeStyle?.(edge) ?? {}),
      }
      const markerKey = `${style.stroke}|${style.opacity}`
      let markerId = markerByKey.get(markerKey)
      if (!markerId) {
        markerId = `graph-arrow-${markerIndex}`
        markerIndex += 1
        markerByKey.set(markerKey, markerId)
        const marker = createSvgEl('marker')
        setAttrs(marker, {
          id: markerId,
          viewBox: '0 0 10 10',
          refX: 9,
          refY: 5,
          markerWidth: 6,
          markerHeight: 6,
          orient: 'auto-start-reverse',
          markerUnits: 'userSpaceOnUse',
        })
        const arrow = createSvgEl('path')
        setAttrs(arrow, {
          d: 'M 0 0 L 10 5 L 0 10 z',
          fill: style.stroke,
          'fill-opacity': style.opacity,
        })
        marker.appendChild(arrow)
        defs.appendChild(marker)
      }
      setAttrs(pathEl, {
        d: edge.path,
        fill: 'none',
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        'stroke-dasharray': style.dasharray,
        'stroke-opacity': style.opacity,
        'marker-end': `url(#${markerId})`,
      })
      if (style.glowColor && style.glowBlur > 0) {
        pathEl.style.filter = `drop-shadow(0 0 ${style.glowBlur}px ${style.glowColor})`
      } else {
        pathEl.style.filter = ''
      }
      const tip = options.edgeTooltipHtml?.(edge)
      if (tip) {
        pathEl.style.pointerEvents = 'stroke'
        pathEl.addEventListener('mousemove', (evt) => showTooltip(tip, evt.clientX, evt.clientY))
        pathEl.addEventListener('mouseleave', hideTooltip)
      } else {
        pathEl.style.pointerEvents = 'none'
      }
      edgeLayer.appendChild(pathEl)
    })
  }

  const renderNodeHtml = (node: LayoutNode<N>) => {
    if (!options.nodeHtml) return
    const html = options.nodeHtml(node)
    if (!html) return
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.left = `${node.x}px`
    host.style.top = `${node.y}px`
    host.style.width = `${node.width}px`
    host.style.height = `${node.height}px`
    host.style.pointerEvents = options.nodeHtmlPointerEvents ?? 'auto'
    if (typeof html === 'string') {
      host.innerHTML = html
    } else {
      host.appendChild(html)
    }
    htmlLayer.appendChild(host)
  }

  const renderNodes = () => {
    clearChildren(nodeLayer)
    clearChildren(htmlLayer)

    layout.nodes.forEach((node) => {
      renderNodeHtml(node)

      const group = createSvgEl('g')
      group.setAttribute('data-graph-node', '1')
      const rect = createSvgEl('rect')
      const hitRect = createSvgEl('rect')
      const text = createSvgEl('text')
      const baseStyle = mergeNodeStyle(options.theme, node)
      const style = mergePartialNodeStyle(baseStyle, options.nodeStyle?.(node))

      setAttrs(rect, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: style.fill,
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        rx: style.rx,
        ry: style.ry,
      })
      if (style.glowColor && style.glowBlur > 0) {
        rect.style.filter = `drop-shadow(0 0 ${style.glowBlur}px ${style.glowColor})`
      } else {
        rect.style.filter = ''
      }

      setAttrs(hitRect, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: 'transparent',
        stroke: 'transparent',
        'stroke-width': 0,
        rx: style.rx,
        ry: style.ry,
      })
      hitRect.style.pointerEvents = 'all'

      if (options.showDefaultNodeLabel !== false) {
        setAttrs(text, {
          x: node.x + 10,
          y: node.y + 28,
          fill: style.textColor,
          'font-size': style.fontSize,
          'font-family': style.fontFamily,
          'font-weight': style.fontWeight,
        })
        text.textContent = node.label ?? node.id
      }

      group.append(rect)
      const svgOverlay = options.nodeSvg?.(node)
      if (svgOverlay) {
        if (typeof svgOverlay === 'string') {
          const svgOverlayHost = createSvgEl('g')
          svgOverlayHost.innerHTML = svgOverlay
          group.append(svgOverlayHost)
        } else {
          group.append(svgOverlay)
        }
      }
      if (options.showDefaultNodeLabel !== false) group.append(text)
      group.append(hitRect)
      if (options.enableNodeDrag !== false) {
        const startNodeDrag = (evt: PointerEvent) => {
          if (evt.button !== 0) return
          evt.stopPropagation()
          draggedNodeId = node.id
          draggedNodeMoved = false
          nodeDragStart = { x: evt.clientX, y: evt.clientY, nodeX: node.x, nodeY: node.y }
          svg.setPointerCapture(evt.pointerId)
          group.style.cursor = 'grabbing'
        }
        group.style.cursor = 'grab'
        group.addEventListener('pointerdown', startNodeDrag)
        hitRect.addEventListener('pointerdown', startNodeDrag)
        group.addEventListener('pointerup', () => {
          if (draggedNodeId !== node.id) group.style.cursor = 'grab'
        })
      }
      const hoverStyle = options.nodeHoverStyle?.(node)
      if (hoverStyle) {
        group.addEventListener('mouseenter', () => {
          const applied = mergePartialNodeStyle(style, hoverStyle)
          setAttrs(rect, {
            fill: applied.fill,
            stroke: applied.stroke,
            'stroke-width': applied.strokeWidth,
          })
        })
        group.addEventListener('mouseleave', () => {
          setAttrs(rect, {
            fill: style.fill,
            stroke: style.stroke,
            'stroke-width': style.strokeWidth,
          })
          if (options.enableNodeDrag !== false) group.style.cursor = 'grab'
        })
      }
      if (options.onNodeClick) {
        group.addEventListener('click', () => {
          if (suppressClickForNodeId === node.id) {
            suppressClickForNodeId = null
            return
          }
          options.onNodeClick?.(node)
        })
      }
      const tip = options.nodeTooltipHtml?.(node)
      if (tip) {
        group.addEventListener('mousemove', (evt) => showTooltip(tip, evt.clientX, evt.clientY))
        group.addEventListener('mouseleave', hideTooltip)
      }
      nodeLayer.appendChild(group)
    })
  }

  const render = () => {
    const { width, height } = getSize()
    setAttrs(svg, {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
    })
    renderEdges()
    renderNodes()
    updateTransforms()
  }

  const exportFrame = (config?: {
    cropToContent?: boolean
    cropPadding?: number
  }): { x: number; y: number; width: number; height: number } => {
    const { width, height } = getSize()
    if (!config?.cropToContent || layout.nodes.length === 0) return { x: 0, y: 0, width, height }
    const padding = Math.max(0, config.cropPadding ?? 24)
    const x = layout.bounds.x * viewport.scale + viewport.tx - padding
    const y = layout.bounds.y * viewport.scale + viewport.ty - padding
    const croppedWidth = Math.max(1, layout.bounds.width * viewport.scale + padding * 2)
    const croppedHeight = Math.max(1, layout.bounds.height * viewport.scale + padding * 2)
    return { x, y, width: croppedWidth, height: croppedHeight }
  }

  const exportSvg = (config?: {
    includeHtmlLayer?: boolean
    cropToContent?: boolean
    cropPadding?: number
    backgroundColor?: string
  }): { markup: string; width: number } => {
    const serializer = new XMLSerializer()
    const clone = svg.cloneNode(true) as SVGSVGElement
    const frame = exportFrame(config)
    const includeHtmlLayer = config?.includeHtmlLayer !== false
    const backgroundColor = config?.backgroundColor?.trim()
    if (backgroundColor) {
      const bg = createSvgEl('rect')
      setAttrs(bg, {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        fill: backgroundColor,
      })
      clone.insertBefore(bg, clone.firstChild)
    }
    if (includeHtmlLayer && htmlLayer.childElementCount > 0) {
      const foreignLayer = createSvgEl('g')
      setAttrs(foreignLayer, { transform: viewportTransform(viewport) })
      Array.from(htmlLayer.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return
        const foreign = createSvgEl('foreignObject')
        const left = px(child.style.left)
        const top = px(child.style.top)
        const w = px(child.style.width)
        const h = px(child.style.height)
        setAttrs(foreign, { x: left, y: top, width: w, height: h })
        const wrapper = document.createElement('div')
        wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
        wrapper.style.width = `${w}px`
        wrapper.style.height = `${h}px`
        wrapper.style.pointerEvents = 'none'
        wrapper.innerHTML = child.innerHTML
        foreign.appendChild(wrapper)
        foreignLayer.appendChild(foreign)
      })
      clone.appendChild(foreignLayer)
    }
    setAttrs(clone, {
      xmlns: SVG_NS,
      width: frame.width,
      height: frame.height,
      viewBox: `${frame.x} ${frame.y} ${frame.width} ${frame.height}`,
    })
    return { markup: serializer.serializeToString(clone), width: frame.width }
  }

  const exportSvgString = (config?: {
    includeHtmlLayer?: boolean
    cropToContent?: boolean
    cropPadding?: number
    backgroundColor?: string
  }): string => {
    const exported = exportSvg(config)
    return exported.markup
  }

  const copyAsPng = async (config?: {
    scale?: number
    cropToContent?: boolean
    cropPadding?: number
    backgroundColor?: string
  }): Promise<boolean> => {
    const requestedScale = config?.scale ?? window.devicePixelRatio ?? 1
    const scale = Math.max(1, Math.min(6, requestedScale))
    const exportConfig = {
      ...(config?.cropToContent !== undefined ? { cropToContent: config.cropToContent } : {}),
      ...(config?.cropPadding !== undefined ? { cropPadding: config.cropPadding } : {}),
      ...(config?.backgroundColor !== undefined ? { backgroundColor: config.backgroundColor } : {}),
    }
    const exported = exportSvg(exportConfig)
    const pngBytes = await svgStringToPngUint8(exported.markup, Math.ceil(exported.width * scale))
    const pngBytesForBlob = new Uint8Array(pngBytes)
    const pngBlob = new Blob([pngBytesForBlob], { type: 'image/png' })

    const clipboardItemCtor = (window as Window & { ClipboardItem?: typeof ClipboardItem })
      .ClipboardItem
    if (navigator.clipboard?.write && clipboardItemCtor) {
      await navigator.clipboard.write([new clipboardItemCtor({ 'image/png': pngBlob })])
      return true
    }

    const a = document.createElement('a')
    const pngUrl = URL.createObjectURL(pngBlob)
    a.href = pngUrl
    a.download = 'graph.png'
    a.click()
    URL.revokeObjectURL(pngUrl)
    return false
  }

  const downloadSvg = (fileName = 'graph.svg') => {
    const svgMarkup = exportSvgString()
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)
    const a = document.createElement('a')
    a.href = svgUrl
    a.download = fileName
    a.click()
    URL.revokeObjectURL(svgUrl)
  }

  const relayout = () => {
    layout = layoutGraph(graph, options)
  }

  const reroute = () => {
    layout = {
      ...layout,
      edges: routeLayoutEdges(layout.nodes, layout.edges, options),
    }
  }

  const setGraph = (nextGraph: GraphData<N, E>) => {
    graph = nextGraph
    relayout()
    fit()
    render()
  }

  const setOptions = (nextOptions: RenderOptions<N, E>) => {
    options = nextOptions
    relayout()
    fit()
    render()
  }

  const resize = () => {
    render()
  }

  const onPointerDown = (evt: PointerEvent) => {
    if (draggedNodeId) return
    if (evt.button !== 0 || options.enablePanZoom === false) return
    if (evt.target instanceof SVGElement && evt.target.closest('[data-graph-node="1"]')) return
    isDragging = true
    dragStart = { x: evt.clientX, y: evt.clientY, tx: viewport.tx, ty: viewport.ty }
    svg.setPointerCapture(evt.pointerId)
  }

  const onPointerMove = (evt: PointerEvent) => {
    if (draggedNodeId) {
      const node = layout.nodes.find((n) => n.id === draggedNodeId)
      if (!node) return
      if (!draggedNodeMoved && (Math.abs(evt.clientX - nodeDragStart.x) > 3 || Math.abs(evt.clientY - nodeDragStart.y) > 3)) {
        draggedNodeMoved = true
      }
      const dx = (evt.clientX - nodeDragStart.x) / viewport.scale
      const dy = (evt.clientY - nodeDragStart.y) / viewport.scale
      node.x = nodeDragStart.nodeX + dx
      node.y = nodeDragStart.nodeY + dy
      reroute()
      render()
      return
    }
    if (!isDragging) return
    viewport = {
      ...viewport,
      tx: dragStart.tx + (evt.clientX - dragStart.x),
      ty: dragStart.ty + (evt.clientY - dragStart.y),
    }
    updateTransforms()
  }

  const onPointerUp = (evt: PointerEvent) => {
    if (draggedNodeId) {
      if (draggedNodeMoved) {
        suppressClickForNodeId = draggedNodeId
      }
      draggedNodeId = null
      draggedNodeMoved = false
      svg.releasePointerCapture(evt.pointerId)
      const groups = nodeLayer.querySelectorAll('g')
      groups.forEach((group) => {
        group.style.cursor = options.enableNodeDrag !== false ? 'grab' : 'default'
      })
      return
    }
    if (!isDragging) return
    isDragging = false
    svg.releasePointerCapture(evt.pointerId)
  }

  const onWheel = (evt: WheelEvent) => {
    if (options.enablePanZoom === false) return
    evt.preventDefault()
    const rect = svg.getBoundingClientRect()
    viewport = applyWheelZoom(viewport, {
      deltaY: evt.deltaY,
      anchorX: evt.clientX - rect.left,
      anchorY: evt.clientY - rect.top,
      minZoom: options.minZoom ?? 0.2,
      maxZoom: options.maxZoom ?? 3.5,
      step: options.zoomStep ?? 0.12,
    })
    updateTransforms()
  }

  svg.addEventListener('pointerdown', onPointerDown)
  svg.addEventListener('pointermove', onPointerMove)
  svg.addEventListener('pointerup', onPointerUp)
  svg.addEventListener('wheel', onWheel, { passive: false })

  relayout()
  fit()
  render()

  return {
    setGraph,
    setOptions,
    resize,
    fit,
    copyAsPng,
    exportSvgString,
    downloadSvg,
    destroy: () => {
      svg.removeEventListener('pointerdown', onPointerDown)
      svg.removeEventListener('pointermove', onPointerMove)
      svg.removeEventListener('pointerup', onPointerUp)
      svg.removeEventListener('wheel', onWheel)
      hideTooltip()
      container.removeChild(svg)
      container.removeChild(htmlLayer)
      container.removeChild(tooltip)
    },
  }
}
