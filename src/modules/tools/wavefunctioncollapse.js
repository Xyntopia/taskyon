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
    const DEBUG = true // flip to false to silence in-panel logs (console still logs)

    // ---- Validation -----------------------------------------------------------
    if (!Array.isArray(patterns)) throw new Error('patterns must be an array')
    if (!colorMap || typeof colorMap !== 'object') throw new Error('colorMap required')
    if (!output || typeof output !== 'object' || !output.width || !output.height)
      throw new Error('output {width,height} required')

    const tilesize = resolution * tileSize // pixels per tile edge

    // ---- Tile Builder ---------------------------------------------------------
    function buildTile(mask) {
      const cvs = document.createElement('canvas')
      cvs.width = cvs.height = tilesize
      const ctx = cvs.getContext('2d')
      if (!ctx) throw new Error('no 2d ctx')
      ctx.clearRect(0, 0, tilesize, tilesize)
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const ch = mask[y] && mask[y][x]
          if (ch && colorMap[ch]) {
            ctx.fillStyle = colorMap[ch]
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
          }
        }
      }
      const imageData = ctx.getImageData(0, 0, tilesize, tilesize)
      const bitmap = new Uint8Array(imageData.data) // RGBA
      const pngDataURL = cvs.toDataURL('image/png')
      return { bitmap, pngDataURL }
    }

    // ---- Build Tiles Array ----------------------------------------------------
    const tiles = patterns.map((m, i) => {
      const { bitmap, pngDataURL } = buildTile(m)
      return {
        name: `T${i}`,
        symmetry: 'X',
        weight: 1,
        bitmap,
        _preview: pngDataURL,
      }
    })

    // ---- Neighbors (allow all) ------------------------------------------------
    const neighbors = []
    for (const a of tiles) {
      for (const b of tiles) {
        neighbors.push({ left: a.name, right: b.name })
      }
    }

    // ---- Definition Object ----------------------------------------------------
    const definition = {
      tilesize,
      unique: false,
      tiles: tiles.map((t) => ({
        name: t.name,
        symmetry: t.symmetry,
        weight: t.weight,
        bitmap: t.bitmap,
      })),
      subsets: { default: tiles.map((t) => t.name) },
      neighbors,
    }

    // ---- Initial Generation (Server) ------------------------------------------
    let serverGenerationBuffer = null
    let serverGenerationOK = false
    let serverError = null

    try {
      const model = new wfc.SimpleTiledModel(
        definition,
        null, // subset (null matches example)
        output.width,
        output.height,
        false,
      )
      serverGenerationOK = model.generate(Math.random)
      if (serverGenerationOK) {
        const g = model.graphics()
        let buf
        if (g && g.buffer instanceof Uint8Array) buf = g.buffer
        else if (g instanceof Uint8Array) buf = g
        else if (g && g.buffer instanceof ArrayBuffer) buf = new Uint8Array(g.buffer)
        else if (g && g.buffer && g.buffer.buffer instanceof ArrayBuffer)
          buf = new Uint8Array(g.buffer.buffer)
        else if (g && Array.isArray(g.buffer)) buf = new Uint8Array(g.buffer)
        else if (Array.isArray(g)) buf = new Uint8Array(g)
        else buf = new Uint8Array((g && g.buffer) || [])
        serverGenerationBuffer = Array.from(buf)
      } else {
        serverError = 'Contradiction on initial generation'
      }
    } catch (e) {
      serverError = 'Exception during initial generation: ' + (e && e.message ? e.message : e)
    }

    // ---- Serialize for Client -------------------------------------------------
    const serialized = {
      tilesize,
      outputWidth: output.width,
      outputHeight: output.height,
      tiles: tiles.map((t) => ({
        name: t.name,
        symmetry: t.symmetry,
        weight: t.weight,
        png: t._preview,
        bitmap: Array.from(t.bitmap),
      })),
      neighbors,
      serverGenerationOK,
      serverError,
      serverBuffer: serverGenerationBuffer,
    }

    // ---- Markdown + Embedded HTML/JS ------------------------------------------
    const html = `
### Wave Function Collapse (Interactive / Debug)

Tiles (from character masks) and output canvas.
Click **Regenerate** to sample again.

<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px 0;">
${tiles
  .map(
    (t) => `<figure style="margin:0;">
  <img src="${t._preview}" width="${tilesize}" height="${tilesize}"
       alt="${t.name}" style="image-rendering:pixelated;border:1px solid #ccc;display:block;">
  <figcaption style="text-align:center;font-size:0.65rem;">${t.name}</figcaption>
</figure>`,
  )
  .join('')}
</div>

<button id="wfc-regenerate" style="padding:4px 10px;cursor:pointer;margin:6px 0;">Regenerate</button>
<canvas id="wfc-canvas" width="${output.width * tilesize}" height="${output.height * tilesize}"
        style="border:1px solid #999;image-rendering:pixelated;display:block;background:#fff;"></canvas>

<details style="margin-top:10px;" open>
  <summary style="cursor:pointer;font-weight:bold;">Debug Log</summary>
  <pre id="wfc-log" style="max-height:280px;overflow:auto;background:#111;color:#0f0;padding:6px;font-size:11px;"></pre>
</details>

<script type="module">
(() => {
  const serialized = ${JSON.stringify(serialized)};
  const DEBUG = ${DEBUG ? 'true' : 'false'};

  const logEl = document.getElementById('wfc-log');
  function log() {
    if (!DEBUG) return;
    const line = Array.from(arguments).map(a => {
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    if (logEl) {
      logEl.textContent += line + "\\n";
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log('[WFC]', ...arguments);
  }

  function assert(cond, msg) {
    if (!cond) {
      log('ASSERT FAIL:', msg);
      throw new Error(msg);
    }
  }

  async function getLib() {
    const candidates = [];
    if (window.wfc) candidates.push(window.wfc);
    if (window.wavefunctioncollapse) candidates.push(window.wavefunctioncollapse);
    let mod;
    if (!candidates.length) {
      try {
        mod = await import('wavefunctioncollapse');
        candidates.push(mod);
        if (mod.default) candidates.push(mod.default);
      } catch (e) {
        log('Dynamic import failed:', e);
      }
    }
    for (const c of candidates) {
      if (c && c.SimpleTiledModel) {
        log('Using module variant keys:', Object.keys(c));
        return c;
      }
    }
    log('No suitable module export shape found.');
    throw new Error('SimpleTiledModel not found');
  }

  function rebuildDefinition() {
    const tiles = serialized.tiles.map(t => ({
      name: t.name,
      symmetry: t.symmetry,
      weight: t.weight,
      bitmap: new Uint8Array(t.bitmap)
    }));
    const neighbors = serialized.neighbors.map(n => ({ left: n.left, right: n.right }));
    return {
      tilesize: serialized.tilesize,
      unique: false,
      tiles,
      subsets: { default: tiles.map(t => t.name) },
      neighbors
    };
  }

  const cvs = document.getElementById('wfc-canvas');
  const ctx = cvs.getContext('2d');
  assert(ctx, '2D context unavailable');

  function putBuffer(raw) {
    const w = serialized.outputWidth * serialized.tilesize;
    const h = serialized.outputHeight * serialized.tilesize;
    let u8;
    if (raw instanceof Uint8Array) u8 = raw;
    else if (Array.isArray(raw)) u8 = new Uint8Array(raw);
    else if (raw && raw.buffer instanceof ArrayBuffer) u8 = new Uint8Array(raw.buffer);
    else if (raw && raw.buffer && raw.buffer.buffer instanceof ArrayBuffer) u8 = new Uint8Array(raw.buffer.buffer);
    else u8 = new Uint8Array(raw || []);
    if (u8.length !== w * h * 4) {
      log('WARNING buffer size mismatch', u8.length, 'expected', w * h * 4);
    }
    const id = new ImageData(new Uint8ClampedArray(u8), w, h);
    ctx.putImageData(id, 0, 0);
    log('Rendered buffer. Bytes:', u8.length);
  }

  function extractBuffer(g) {
    if (!g) { log('graphics() returned falsy'); return null; }
    if (g.buffer instanceof Uint8Array) return g.buffer;
    if (g instanceof Uint8Array) return g;
    if (g.buffer instanceof ArrayBuffer) return new Uint8Array(g.buffer);
    if (g.buffer && g.buffer.buffer instanceof ArrayBuffer) return new Uint8Array(g.buffer.buffer);
    if (Array.isArray(g.buffer)) return new Uint8Array(g.buffer);
    if (Array.isArray(g)) return new Uint8Array(g);
    log('Unrecognized graphics() shape:', g);
    return null;
  }

  async function generate() {
    log('Starting generation...');
    const lib = await getLib();
    const def = rebuildDefinition();
    log('Definition tiles:', def.tiles.length, 'neighbors:', def.neighbors.length);
    let model;
    try {
      model = new lib.SimpleTiledModel(
        def,
        null,
        serialized.outputWidth,
        serialized.outputHeight,
        false
      );
    } catch (e) {
      log('Constructor failed:', e);
      throw e;
    }
    let ok = false;
    try {
      ok = model.generate(Math.random);
      log('model.generate returned:', ok);
    } catch (e) {
      log('model.generate threw:', e);
      throw e;
    }
    if (!ok) {
      log('Contradiction (no output).');
      return;
    }
    let g;
    try {
      g = model.graphics();
    } catch (e) {
      log('graphics() threw:', e);
      return;
    }
    const buf = extractBuffer(g);
    if (!buf) {
      log('No buffer extracted.');
      return;
    }
    putBuffer(buf);
  }

  // Initial (server) buffer if valid
  if (serialized.serverGenerationOK && serialized.serverBuffer) {
    log('Using server buffer bytes:', serialized.serverBuffer.length);
    try {
      putBuffer(serialized.serverBuffer);
    } catch (e) {
      log('Render server buffer failed:', e);
      generate();
    }
  } else {
    log('No valid server buffer (error: ', serialized.serverError, ') -> client generate');
    generate();
  }

  const btn = document.getElementById('wfc-regenerate');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    generate().finally(() => { btn.disabled = false; });
  });
})();
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
