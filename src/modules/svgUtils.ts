import { initWasm, Resvg } from '@resvg/resvg-wasm';
//import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm';

const wasmPath = new URL('@resvg/resvg-wasm/index_bg.wasm', import.meta.url);

let resvgInitialized = false;

async function initResvg() {
  if (!resvgInitialized) {
    const res = await fetch(wasmPath);
    await initWasm(res);
    resvgInitialized = true;
  }
}

export async function svgToPng(svgString: string, options = {}) {
  await initResvg();

  const resvg = new Resvg(svgString, options);
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  return pngBuffer;
}
