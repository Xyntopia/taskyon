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

export async function svgStringToPngUint8(svg: string, targetWidth: number): Promise<Uint8Array> {
  // 1. figure out intrinsic size
  const { width: origW, height: origH } = getSvgSize(svg)
  const targetHeight = Math.round(origH * (targetWidth / origW))

  // 2. render into canvas
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(svgBlob)
  const img = new Image()
  img.src = url
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('SVG load failed'))
  })
  URL.revokeObjectURL(url)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  // 3. export to Blob → ArrayBuffer → Uint8Array
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}
