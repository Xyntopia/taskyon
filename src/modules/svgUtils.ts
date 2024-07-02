import { initWasm, Resvg } from '@resvg/resvg-wasm';

const wasmPath = new URL('@resvg/resvg-wasm/index_bg.wasm', import.meta.url);

let resvgInitialized = false;

async function initResvg() {
  if (!resvgInitialized) {
    const res = await fetch(wasmPath);
    await initWasm(res);
    resvgInitialized = true;
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
  await initResvg();

  const font = await fetch('./fonts/Roboto-Regular.ttf');
  if (!font.ok) return;

  const fontData = await font.arrayBuffer();
  const buffer = new Uint8Array(fontData);

  /*const fontBuffer = await loadFont(
    '/fonts/KFOmCnqEu92Fr1Mu4mxM.f1e2a767.woff'
  );*/

  const options: Record<string, unknown> = {
    fitTo: {
      mode: 'width', // If you need to change the size
      value: 1024,
    },
    font: {
      fontBuffers: [buffer], // New in 2.5.0, loading custom fonts
    },
  };

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

  const resvg = new Resvg(svgString, options);
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  return pngBuffer;
}
