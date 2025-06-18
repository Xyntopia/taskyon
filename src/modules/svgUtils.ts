// src/modules/svgUtils.ts

import type { Resvg as ResvgClass, ResvgRenderOptions } from '@resvg/resvg-wasm'

/** shape of the dynamically‑loaded resvg module */
interface ResvgModule {
  initWasm(bytes: Response): Promise<void>
  Resvg: typeof ResvgClass
}

let wasmModule: ResvgModule | null = null

async function loadResvg(): Promise<ResvgModule> {
  if (wasmModule) return wasmModule

  const mod = (await import('@resvg/resvg-wasm')) as unknown as ResvgModule
  const wasmPath = new URL('index_bg.wasm', import.meta.url)
  const resp = await fetch(wasmPath)
  await mod.initWasm(resp)

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

function stripForeignObjects(svg: string): string {
  return svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')
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

  // 1) try native
  try {
    return await nativeRender(svg, targetWidth, targetHeight)
  } catch (e1) {
    console.warn('native render failed → stripping foreignObject…', e1)
  }

  // 2) strip foreignObject + retry native
  const cleaned = stripForeignObjects(svg)
  try {
    return await nativeRender(cleaned, targetWidth, targetHeight)
  } catch (e2) {
    console.warn('native after strip failed → falling back to resvg…', e2)
  }

  // 3) final fallback: resvg
  return await resvgRender(svg)
}
