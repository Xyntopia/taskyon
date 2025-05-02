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
      },
    },
  },
  function: ({ patterns, resolution = 4, tileSize = 16, colorMap, output }) => {
    // Validate required parameters
    if (!patterns || !Array.isArray(patterns)) {
      throw new Error(
        'Invalid or missing "patterns" parameter. It must be an array of character masks.',
      )
    }
    if (!colorMap || typeof colorMap !== 'object') {
      throw new Error(
        'Invalid or missing "colorMap" parameter. It must be an object mapping characters to colors.',
      )
    }
    if (!output || typeof output !== 'object' || !output.width || !output.height) {
      throw new Error(
        'Invalid or missing "output" parameter. It must be an object with "width" and "height" properties.',
      )
    }

    // Build tile image data from character masks
    function buildTile(mask) {
      const sizePx = resolution * tileSize
      const cvs = document.createElement('canvas')
      cvs.width = cvs.height = sizePx
      const ctx = cvs.getContext('2d')
      if (!ctx) {
        throw new Error('Failed to get 2D context for canvas')
      }
      // clear background
      ctx.clearRect(0, 0, sizePx, sizePx)
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const ch = mask[y][x]
          if (ch && colorMap[ch]) {
            ctx.fillStyle = colorMap[ch]
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
          }
        }
      }
      return ctx.getImageData(0, 0, sizePx, sizePx).data
    }

    // Prepare WFC data
    const tiles = patterns.map((m, i) => ({
      name: `T${i}`,
      data: buildTile(m),
      width: resolution * tileSize,
      height: resolution * tileSize,
    }))
    const dataObj = {
      tiles: Object.fromEntries(
        tiles.map((t) => [t.name, { data: t.data, width: t.width, height: t.height }]),
      ),
      subsets: { default: tiles.map((t) => t.name) },
      constraints: [],
    }

    // Create model and generate
    const model = new wfc.SimpleTiledModel(dataObj, 'default', output.width, output.height, false)
    model.generate(Math.random)

    // Collect pixel buffer
    const pxW = output.width * tileSize
    const pxH = output.height * tileSize
    const img = new ImageData(pxW, pxH)
    model.graphics(img.data)

    // Render in new window
    const html = `<!DOCTYPE html>
<html><body style="margin:0;overflow:hidden;">
<canvas id="c"></canvas>
<script>
  const img = new ImageData(new Uint8ClampedArray(\${JSON.stringify(Array.from(img.data))}), \${pxW}, \${pxH});
  const cvs = document.getElementById('c');
  cvs.width = \${pxW}; cvs.height = \${pxH};
  cvs.getContext('2d').putImageData(img,0,0);
</script>
</body></html>\`;
  }`
    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'functioncall',
            data: {
              name: 'newWindowOpener',
              arguments: { html, windowFeatures: 'width=' + pxW + ',height=' + pxH },
            },
          },
        },
      ],
    ])
  },
})
