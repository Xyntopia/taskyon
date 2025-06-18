// src/modules/svgUtils.ts

import type { Resvg as ResvgClass, ResvgRenderOptions } from '@resvg/resvg-wasm'

interface ResvgModule {
  initWasm(bytes: Response): Promise<void>
  Resvg: typeof ResvgClass
}

let wasmModule: ResvgModule | null = null
async function loadResvg(): Promise<ResvgModule> {
  if (wasmModule) return wasmModule
  const mod = (await import('@resvg/resvg-wasm')) as unknown as ResvgModule
  const wasmPath = new URL('index_bg.wasm', import.meta.url)
  await mod.initWasm(await fetch(wasmPath))
  return (wasmModule = mod)
}

function getSvgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  const vb = el.getAttribute('viewBox')
  if (vb) {
    const [, , w, h] = vb.split(/[\s,]+/).map(parseFloat)
    if (w && h) return { width: w, height: h }
  }
  return {
    width: parseFloat(el.getAttribute('width') || '0'),
    height: parseFloat(el.getAttribute('height') || '0'),
  }
}

function createCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  return { canvas, ctx }
}

async function nativeRender(svg: string, w: number, h: number): Promise<Uint8Array> {
  const { canvas, ctx } = createCanvas(w, h)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.src = url
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('native SVG load failed'))
  })
  URL.revokeObjectURL(url)
  ctx.drawImage(img, 0, 0, w, h)
  const out = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png'))
  if (!out) throw new Error('toBlob returned null')
  return new Uint8Array(await out.arrayBuffer())
}

/**
 * Replace each <foreignObject> with a <text>, preserving:
 * - inner <div> style & class
 * - textContent
 * - if style contains "text-align: center", adjust x & text-anchor
 */
function transformForeignObjects(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')

  doc.querySelectorAll('foreignObject').forEach((fo) => {
    const div = fo.querySelector('div')
    const style = div?.getAttribute('style') ?? ''
    const cls = div?.getAttribute('class') ?? ''

    // original x/y and width
    const xAttr = fo.getAttribute('x') ?? '0'
    const yAttr = fo.getAttribute('y') ?? '0'
    const widthAttr = fo.getAttribute('width') ?? '0'

    const text = div?.textContent?.trim() || fo.textContent?.trim() || ''
    const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text')

    // parse numbers once
    const xNum = parseFloat(xAttr)

    // if the div had text-align:center, shift to midpoint & middle-anchor
    if (/text-align\s*:\s*center/.test(style)) {
      const wNum = parseFloat(widthAttr)
      textEl.setAttribute('text-anchor', 'middle')
      textEl.setAttribute('x', String(xNum + wNum / 2))
    } else {
      textEl.setAttribute('x', xAttr)
    }

    textEl.setAttribute('y', yAttr)

    if (style) textEl.setAttribute('style', style)
    if (cls) textEl.setAttribute('class', cls)
    textEl.textContent = text

    fo.replaceWith(textEl)
  })

  return new XMLSerializer().serializeToString(doc)
}

async function resvgRender(svg: string): Promise<Uint8Array> {
  const { Resvg } = await loadResvg()
  const { width } = getSvgSize(svg)
  const opts: ResvgRenderOptions = { fitTo: { mode: 'width', value: width } }
  const r = new Resvg(svg, opts)
  return r.render().asPng()
}

/**
 * Convert an SVG string into a PNG Uint8Array
 * @param svg         raw SVG markup
 * @param targetWidth desired pixel width
 */
export async function svgStringToPngUint8(svg: string, targetWidth: number): Promise<Uint8Array> {
  const { width: origW, height: origH } = getSvgSize(svg)
  const targetHeight = Math.round(origH * (targetWidth / origW))

  // 1) native
  try {
    return await nativeRender(svg, targetWidth, targetHeight)
  } catch (e1) {
    console.warn('native render failed:', e1)
  }

  // 2) transform + native
  const transformed = transformForeignObjects(svg)
  try {
    return await nativeRender(transformed, targetWidth, targetHeight)
  } catch (e2) {
    console.warn('native after transform failed:', e2)
  }

  // 3) resvg fallback
  return await resvgRender(svg)
}
