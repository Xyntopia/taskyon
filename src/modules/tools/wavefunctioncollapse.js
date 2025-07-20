import { createTool, makeTaskResult } from '../taskyon/tools'
// wafefunctioncollapse doesn't have any typescript types that come with it
// thats why we are using a pure js function here...
import * as wfc from 'wavefunctioncollapse'

export const wfcGenerator = createTool({
  name: 'wfcGenerator',
  description: 'Generates abstract line-art via Wave Function Collapse in a new browser window.',
  longDescription: `This tool uses a small set of character‑based tile patterns (default 4×4) and a color map
 to produce an output grid of collapsed wave patterns. It opens a new window and
 renders the final image on a canvas.`,
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['output'],
    properties: {
      patterns: {
        type: 'array',
        description:
          'An array of base tile patterns, each represented as a 2D array of single-character strings. Each character corresponds to a color code defined in the colorMap. These patterns serve as the foundational tiles for the Wave Function Collapse algorithm.',
        items: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 1,
              maxLength: 1,
            },
          },
        },
        default: [
          ['r', 'r', 'r', 'r'],
          ['r', ' ', ' ', 'r'],
          ['r', ' ', ' ', 'r'],
          ['r', 'r', 'r', 'r'],
          ['g', ' ', 'g', ' '],
          [' ', 'g', ' ', 'g'],
          ['o', 'o', ' ', ' '],
          [' ', ' ', 'o', 'o'],
        ],
      },
      resolution: {
        type: 'integer',
        description:
          'The resolution of each tile pattern, indicating the number of cells along one edge of the square tile. For example, a resolution of 4 means each tile is a 4x4 grid.',
        default: 4,
      },
      tileSize: {
        type: 'integer',
        description:
          'The size in pixels of each cell within a tile. This determines the rendered size of each tile on the canvas.',
        default: 16,
      },
      colorMap: {
        type: 'object',
        description:
          'A mapping from single-character color codes used in the patterns to their corresponding CSS color values. This defines the actual colors rendered for each character in the tile patterns.',
        additionalProperties: {
          type: 'string',
        },
        default: {
          r: '#f00',
          g: '#0f0',
          o: '#f70',
          w: '#fff',
          b: '#00f',
        },
      },
      output: {
        type: 'object',
        description:
          'The dimensions of the output grid, specifying how many tiles to generate horizontally and vertically.',
        required: ['width', 'height'],
        properties: {
          width: {
            type: 'integer',
            description: 'The number of tiles to generate horizontally.',
          },
          height: {
            type: 'integer',
            description: 'The number of tiles to generate vertically.',
          },
        },
        default: {
          width: 10,
          height: 10,
        },
      },
    },
  },
  function: ({ patterns, resolution = 4, tileSize = 16, colorMap, output }) => {
    if (!Array.isArray(patterns)) throw new Error('patterns must be an array')
    if (!colorMap || typeof colorMap !== 'object') throw new Error('colorMap required')
    if (!output || typeof output !== 'object' || !output.width || !output.height)
      throw new Error('output {width,height} required')

    const tilesize = resolution * tileSize // pixels per tile edge

    function buildTile(mask) {
      const cvs = document.createElement('canvas')
      cvs.width = cvs.height = tilesize
      const ctx = cvs.getContext('2d')
      if (!ctx) throw new Error('no 2d ctx')
      ctx.clearRect(0, 0, tilesize, tilesize)
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const ch = mask[y]?.[x]
          if (ch && colorMap[ch]) {
            ctx.fillStyle = colorMap[ch]
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
          }
        }
      }
      const imageData = ctx.getImageData(0, 0, tilesize, tilesize)
      const bitmap = new Uint8Array(imageData.data) // library wants Uint8Array
      const pngDataURL = cvs.toDataURL('image/png')
      return { bitmap, pngDataURL }
    }

    // Build tile array in required shape
    const tiles = patterns.map((m, i) => {
      const { bitmap, pngDataURL } = buildTile(m)
      return {
        name: `T${i}`,
        symmetry: 'X', // simplest: no rotations
        weight: 1,
        bitmap, // REQUIRED key name
        _preview: pngDataURL,
      }
    })

    // Naive neighbor set: allow any tile next to any tile (works; just unconstrained)
    const neighbors = []
    for (const a of tiles) {
      for (const b of tiles) {
        neighbors.push({ left: a.name, right: b.name })
      }
    }

    const definition = {
      tilesize,
      unique: false, // we are not providing rotated variants
      tiles: tiles.map((t) => ({
        name: t.name,
        symmetry: t.symmetry,
        weight: t.weight,
        bitmap: t.bitmap,
      })),
      subsets: { default: tiles.map((t) => t.name) },
      neighbors,
    }

    // Construct model (note the second arg is subset name or null)
    const model = new wfc.SimpleTiledModel(
      definition,
      'default',
      output.width,
      output.height,
      false,
    )

    const finished = model.generate(Math.random)
    if (!finished) {
      // (Optional) retry / handle contradiction
      throw new Error('Generation ended in a contradiction')
    }

    // model.graphics(): this port commonly returns { buffer: Uint8Array, ... }
    const result = model.graphics()
    // Some versions accept an ImageData arg; this code path uses returned buffer:
    const buffer = result && result.buffer ? result.buffer : result // fallback

    const pxW = output.width * tilesize
    const pxH = output.height * tilesize
    // Create ImageData from raw buffer
    const imgData = new ImageData(new Uint8ClampedArray(buffer), pxW, pxH)

    // Serialize for client regeneration (we re-derive neighbors client side the same way)
    const serialized = {
      tilesize,
      outputWidth: output.width,
      outputHeight: output.height,
      tiles: tiles.map((t) => ({
        name: t.name,
        symmetry: t.symmetry,
        weight: t.weight,
        png: t._preview,
        bitmap: Array.from(t.bitmap), // numbers for JSON
      })),
    }

    const html = `
### Wave Function Collapse (Interactive)

Input tiles (raw bitmaps) & generated output. Click **Regenerate Variation** to sample a fresh result.

<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
  ${tiles
    .map(
      (t) => `<figure style="margin:0;">
    <img src="${t._preview}" width="${tilesize}" height="${tilesize}"
         alt="${t.name}" style="image-rendering:pixelated;border:1px solid #ccc;display:block;">
    <figcaption style="text-align:center;font-size:0.7rem;">${t.name}</figcaption>
  </figure>`,
    )
    .join('')}
</div>

<button id="wfc-regenerate" style="padding:4px 10px;cursor:pointer;margin:8px 0;">Regenerate Variation</button>
<canvas id="wfc-canvas" width="${pxW}" height="${pxH}"
        style="border:1px solid #999;image-rendering:pixelated;display:block;"></canvas>
<div style="margin-top:6px;">
  <img id="wfc-thumb" alt="output preview"
       style="max-width:200px;border:1px solid #ccc;image-rendering:pixelated;">
</div>

<script type="module">
(() => {
  const serialized = ${JSON.stringify(serialized)}

  async function getLib() {
    if (window.wfc?.SimpleTiledModel) return window.wfc
    if (window.wavefunctioncollapse?.SimpleTiledModel) return window.wavefunctioncollapse
    return await import('wavefunctioncollapse')
  }

  function buildDefinition() {
    const tiles = serialized.tiles.map(t => ({
      name: t.name,
      symmetry: t.symmetry,
      weight: t.weight,
      bitmap: new Uint8Array(t.bitmap)
    }))
    // allow-all neighbors again (mirror server)
    const neighbors = []
    for (const a of tiles) for (const b of tiles)
      neighbors.push({ left: a.name, right: b.name })
    return {
      tilesize: serialized.tilesize,
      unique: false,
      tiles,
      subsets: { default: tiles.map(t => t.name) },
      neighbors
    }
  }

  const cvs = document.getElementById('wfc-canvas')
  const ctx = cvs.getContext('2d')
  const thumb = document.getElementById('wfc-thumb')
  const btn = document.getElementById('wfc-regenerate')

  function putBuffer(buffer) {
    const w = serialized.outputWidth * serialized.tilesize
    const h = serialized.outputHeight * serialized.tilesize
    const id = new ImageData(new Uint8ClampedArray(buffer), w, h)
    ctx.putImageData(id, 0, 0)
    thumb.src = cvs.toDataURL('image/png')
  }

  async function generate() {
    const lib = await getLib()
    const def = buildDefinition()
    const model = new lib.SimpleTiledModel(
      def,
      'default',
      serialized.outputWidth,
      serialized.outputHeight,
      false
    )
    const ok = model.generate(Math.random)
    if (!ok) { console.warn('contradiction'); return }
    const g = model.graphics()
    const buffer = (g && g.buffer) ? g.buffer : g
    putBuffer(buffer)
  }

  // initial draw (server sample)
  putBuffer(${JSON.stringify(Array.from(buffer))})

  btn.addEventListener('click', () => {
    btn.disabled = true
    generate().finally(() => btn.disabled = false)
  })
})()
</script>
`

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: { type: 'message', data: html },
        },
      ],
    ])
  },
})
