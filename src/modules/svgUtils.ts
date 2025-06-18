import { initWasm, Resvg } from '@resvg/resvg-wasm'

const wasmPath = new URL('@resvg/resvg-wasm/index_bg.wasm', import.meta.url)

let resvgInitialized = false

async function initResvg() {
  if (!resvgInitialized) {
    const res = await fetch(wasmPath)
    await initWasm(res)
    resvgInitialized = true
  }
}

/*async function loadFont(url: string) {
  const fontResponse = await fetch(url);
  if (!fontResponse.ok) {
    throw new Error('Failed to load font');
  }
  const fontData = await fontResponse.arrayBuffer();
  return new Uint8Array(fontData);
}*/

/*
example options:
{
  //fitTo: { mode: 'width', value: 1200 },
  fitTo: { mode: 'original'},
  fonts: [new Uint8Array(robotoFont)],
  defaultFontFamily: { sansSerifFamily: 'Roboto' },
  scale: 2,
}
*/

export async function svgToPng(svgString: string) {
  await initResvg()

  const font = await fetch('./fonts/Roboto-Regular.ttf')
  if (!font.ok) return

  const fontData = await font.arrayBuffer()
  const buffer = new Uint8Array(fontData)

  /*const fontBuffer = await loadFont(
    '/fonts/KFOmCnqEu92Fr1Mu4mxM.f1e2a767.woff'
  );*/

  const options: Record<string, unknown> = {
    fitTo: { mode: 'width', value: 1024 },
    fonts: [buffer],
    defaultFontFamily: { sansSerif: 'Roboto' },
  }

  /*const options: Record<string, unknown> = {
    //fitTo: { mode: 'width', value: 1200 },
    fitTo: { mode: 'original' },
    font: { fontBuffers: [fontBuffer] },
    //defaultFontFamily: { sansSerifFamily: 'Roboto' },
    //scale: 2,
  };*/

  // Load custom font if specified in options
  /*if (options.fontUrl) {
    const fontBuffer = await loadFont(options.fontUrl);
    options.font = {
      fontBuffers: [fontBuffer],
    };
  }*/

  const resvg = new Resvg(svgString, options)
  const pngData = resvg.render()
  const pngBuffer = pngData.asPng()
  return pngBuffer
}

function getSvgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgEl = doc.documentElement
  // try viewBox first
  const vb = svgEl.getAttribute('viewBox')
  if (vb) {
    const [, , vbW, vbH] = vb.split(/\s+|,/).map(parseFloat)
    if (vbW && vbH) {
      return { width: vbW, height: vbH }
    }
  }
  // fallback to width/height attrs (assume px or unitless)
  const w = parseFloat(svgEl.getAttribute('width') || '0')
  const h = parseFloat(svgEl.getAttribute('height') || '0')
  return { width: w, height: h }
}

function createCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  return { canvas, ctx }
}

async function blobUrlImageDraw(svg: string, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  // img.crossOrigin = 'anonymous'   // only if loading external assets
  img.src = url
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('SVG load failed'))
  })
  URL.revokeObjectURL(url)
  ctx.drawImage(img, 0, 0, w, h)
}

async function canvgDraw(svg: string, ctx: CanvasRenderingContext2D) {
  const { Canvg } = await import('canvg')
  const renderer = Canvg.fromString(ctx, svg)
  await renderer.render()
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/png'))
  if (!blob) throw new Error('toBlob returned null')
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}

export async function svgStringToPngUint8(svg: string, targetWidth: number): Promise<Uint8Array> {
  // compute target size
  const { width: origW, height: origH } = getSvgSize(svg)
  const targetHeight = Math.round(origH * (targetWidth / origW))

  // 1) try with native <img> → canvas
  try {
    const { canvas, ctx } = createCanvas(targetWidth, targetHeight)
    await blobUrlImageDraw(svg, ctx, targetWidth, targetHeight)
    return await canvasToPngBytes(canvas)
  } catch (err) {
    console.warn('Native SVG→PNG failed, falling back to Canvg:', err)
  }

  // 2) fallback: fresh canvas + Canvg render
  const { canvas: fbCanvas, ctx: fbCtx } = createCanvas(targetWidth, targetHeight)
  await canvgDraw(svg, fbCtx)
  return await canvasToPngBytes(fbCanvas)
}
