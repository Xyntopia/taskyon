// wafefunctioncollapse doesn't have any typescript types that come with it
// thats why we are using a pure js function here...
// import * as wfc from 'wavefunctioncollapse'
import { createTool } from '../types/toolApi'

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
  function: ({ patterns, resolution = 4, tileSize = 16, colorMap, output }, ctx) => {
    // Basic validation (minimal)
    if (!Array.isArray(patterns)) throw new Error('patterns must be an array')
    if (!colorMap || typeof colorMap !== 'object') throw new Error('colorMap required')
    if (!output || typeof output !== 'object' || !output.width || !output.height)
      throw new Error('output {width,height} required')

    const html = `
### Wave Function Collapse

<button id="wfc-regenerate" style="padding:4px 10px;cursor:pointer;margin:6px 0;">Regenerate</button>
<canvas id="wfc-canvas"
  width="${output.width * resolution * tileSize}"
  height="${output.height * resolution * tileSize}"
  style="border:1px solid #999;image-rendering:pixelated;display:block;background:#fff;"></canvas>
<details style="margin-top:8px;" open>
  <summary style="cursor:pointer;font-weight:bold;">Log</summary>
  <pre id="wfc-log" style="max-height:220px;overflow:auto;background:#111;color:#0f0;padding:6px;font-size:11px;"></pre>
</details>
<div id="wfc-tiles" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;"></div>

<script>
(() => {
  const cfg = ${JSON.stringify({ patterns, resolution, tileSize, colorMap, output })};
  const logEl = document.getElementById('wfc-log');
  const tilesWrap = document.getElementById('wfc-tiles');
  const cvs = document.getElementById('wfc-canvas');
  const ctx = cvs.getContext('2d');

  function log() {
    const line = Array.from(arguments).map(a => {
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }).join(' ');
    logEl.textContent += line + '\\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[WFC]', ...arguments);
  }

  // Build tiles (bitmaps + preview PNGs) from character masks
  function buildTiles() {
    const { patterns, resolution, tileSize, colorMap } = cfg;
    const tilesize = resolution * tileSize;
    const tiles = patterns.map((mask, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = tilesize;
      const cctx = c.getContext('2d');
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const ch = mask[y] && mask[y][x];
            if (ch && colorMap[ch]) {
              cctx.fillStyle = colorMap[ch];
              cctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
        }
      }
      const imgData = cctx.getImageData(0,0,tilesize,tilesize);
      const bmp = new Uint8Array(imgData.data);
      return {
        name: 'T' + i,
        symmetry: 'X',
        weight: 1,
        bitmap: bmp,
        preview: c.toDataURL('image/png')
      };
    });

    // display previews
    tilesWrap.innerHTML = tiles.map(t =>
      '<figure style="margin:0;">' +
        '<img src="'+t.preview+'" width="'+(resolution*tileSize)+'" height="'+(resolution*tileSize)+'" style="image-rendering:pixelated;border:1px solid #333;display:block;">' +
        '<figcaption style="text-align:center;font-size:0.6rem;">'+t.name+'</figcaption>' +
      '</figure>'
    ).join('');

    // fully allowed neighbors (left-right only; lib infers rotations if any)
    const neighbors = [];
    for (const a of tiles) for (const b of tiles) neighbors.push({ left: a.name, right: b.name });

    return { tiles, neighbors, tilesize: resolution * tileSize };
  }

  // CDN loader for the library (UMD preferred; fallback to ESM)
  let libPromise;
  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise(async (resolve, reject) => {
      if (window.wfc && window.wfc.SimpleTiledModel) {
        return resolve(window.wfc);
      }
      const urls = [
        'https://cdn.jsdelivr.net/npm/wavefunctioncollapse/dist/wavefunctioncollapse.umd.js',
        'https://unpkg.com/wavefunctioncollapse/dist/wavefunctioncollapse.umd.js'
      ];
      for (const url of urls) {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => res();
            s.onerror = () => rej();
            document.head.appendChild(s);
          });
          if (window.wfc && window.wfc.SimpleTiledModel) {
            log('Loaded UMD:', url);
            return resolve(window.wfc);
          }
        } catch {}
      }
      // Fallback: ESM dynamic import
      try {
        const m = await import('https://esm.sh/wavefunctioncollapse@latest');
        if (m && m.SimpleTiledModel) return resolve(m);
        if (m.default && m.default.SimpleTiledModel) return resolve(m.default);
      } catch (e) {
        log('ESM fallback failed:', e);
      }
      reject(new Error('Unable to load wavefunctioncollapse library from CDNs'));
    });
    return libPromise;
  }

  let tilesData = buildTiles();

  function buildDefinition() {
    return {
      tilesize: tilesData.tilesize,
      unique: false,
      tiles: tilesData.tiles.map(t => ({
        name: t.name,
        symmetry: t.symmetry,
        weight: t.weight,
        bitmap: t.bitmap
      })),
      subsets: { default: tilesData.tiles.map(t => t.name) },
      neighbors: tilesData.neighbors
    };
  }

  function extractBuffer(g) {
    if (!g) return null;
    if (g.buffer instanceof Uint8Array) return g.buffer;
    if (g instanceof Uint8Array) return g;
    if (g.buffer instanceof ArrayBuffer) return new Uint8Array(g.buffer);
    if (g.buffer && g.buffer.buffer instanceof ArrayBuffer) return new Uint8Array(g.buffer.buffer);
    if (Array.isArray(g.buffer)) return new Uint8Array(g.buffer);
    if (Array.isArray(g)) return new Uint8Array(g);
    return null;
  }

  function drawBuffer(raw) {
    const w = cfg.output.width * tilesData.tilesize;
    const h = cfg.output.height * tilesData.tilesize;
    if (raw.length !== w * h * 4) {
      log('Buffer size mismatch', raw.length, 'expected', w * h * 4);
      const fixed = new Uint8Array(w * h * 4);
      fixed.set(raw.subarray(0, Math.min(raw.length, fixed.length)));
      raw = fixed;
    }
    const id = new ImageData(new Uint8ClampedArray(raw), w, h);
    ctx.putImageData(id, 0, 0);
    log('Rendered', raw.length, 'bytes');
  }

  async function generateOnce() {
    const lib = await loadLib();
    const def = buildDefinition();
    let model;
    try {
      model = new lib.SimpleTiledModel(
        def,
        null,
        cfg.output.width,
        cfg.output.height,
        false
      );
    } catch (e) {
      log('Model ctor failed:', e.message || e);
      throw e;
    }
    let ok = false;
    try {
      ok = model.generate(Math.random);
    } catch (e) {
      log('generate() threw:', e.message || e);
      throw e;
    }
    if (!ok) {
      log('Contradiction (no output)');
      return false;
    }
    let g;
    try {
      g = model.graphics();
    } catch (e) {
      log('graphics() threw:', e.message || e);
      return false;
    }
    const buf = extractBuffer(g);
    if (!buf) {
      log('No buffer extracted');
      return false;
    }
    drawBuffer(buf);
    return true;
  }

  async function generateWithRetry(max = 5) {
    for (let i = 1; i <= max; i++) {
      log('Attempt', i, 'of', max);
      try {
        const ok = await generateOnce();
        if (ok) {
          log('Success on attempt', i);
          return;
        }
      } catch (e) {
        log('Attempt', i, 'error:', e.message || e);
      }
    }
    log('All attempts failed.');
  }

  document.getElementById('wfc-regenerate').addEventListener('click', e => {
    e.target.disabled = true;
    generateWithRetry().finally(() => (e.target.disabled = false));
  });

  // initial
  generateWithRetry();
})();
</script>
`

    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: { type: 'message', data: html },
        },
      ],
    ])
  },
})
