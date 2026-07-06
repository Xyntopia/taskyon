// src/utils/katexFonts.ts
import katexCssRaw from 'katex/dist/katex.min.css?inline'

// 1️⃣ Glob all font files as raw text
// ?raw gives us the raw bytes of the font
const rawFontModules: Record<string, string> = import.meta.glob(
  '../../node_modules/katex/dist/fonts/*.woff2',
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
)

// console.log('converting katex languages for iframes...', fontModules)

// 2) Whitelist the fonts we want to inline (filenames only)
const WHITELIST = new Set([
  // core set:
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Math-Italic.woff2',

  // your new errors (bold variants):
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Math-BoldItalic.woff2',

  // optional if you ever need them:
  // 'KaTeX_Main-BoldItalic.woff2',
])

// 3) raw → base64 helper
function toBase64(raw: string): string {
  let binary = ''
  for (let i = 0; i < raw.length; i++) {
    binary += String.fromCharCode(raw.charCodeAt(i) & 0xff)
  }
  return btoa(binary)
}

// 4) Generate iframe-safe KaTeX CSS
export function generateKaTeXIframeCss(): string {
  // 4a) Build our own @font-face rules with data: URLs
  let fontFaceCss = ''

  for (const [path, raw] of Object.entries(rawFontModules)) {
    const filename = path.split('/').pop()!
    if (!WHITELIST.has(filename)) continue

    const base64 = toBase64(raw)

    let fontFamily = ''
    let fontStyle = 'normal'
    let fontWeight = '400'

    if (filename.startsWith('KaTeX_Main')) fontFamily = 'KaTeX_Main'
    else if (filename.startsWith('KaTeX_Math')) fontFamily = 'KaTeX_Math'
    else continue // we’re strict for now

    if (filename.includes('Italic')) fontStyle = 'italic'
    if (filename.includes('Bold')) fontWeight = '700'

    fontFaceCss += `
@font-face {
  font-family: "${fontFamily}";
  font-style: ${fontStyle};
  font-weight: ${fontWeight};
  font-display: block;
  src:url("data:font/woff2;base64,${base64}") format("woff2");
}
`
  }

  // 4b) Strip *all* @font-face blocks from the original KaTeX CSS
  //     (so no /node_modules/ or /assets/... URLs can survive)
  const cssWithoutFontFaces = katexCssRaw.replace(/@font-face\s*{[^}]*}/gs, '')

  // 4c) Final CSS = our font faces + KaTeX rules (without their original @font-face)
  return fontFaceCss + '\n' + cssWithoutFontFaces
}
