// src/utils/katexFonts.ts
import katexCssRaw from 'katex/dist/katex.min.css?inline'

// 1️⃣ Glob all font files as raw text
// ?raw gives us the raw bytes of the font
const rawFontModules: Record<string, string> = import.meta.glob(
  '../../node_modules/katex/dist/fonts/*.woff2',
  {
    eager: true,
    as: 'raw',
  },
)

// console.log('converting katex languages for iframes...', fontModules)

// 2) Whitelist only the fonts you want
const WHITELIST = new Set([
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Main-BoldItalic.woff2',
])

function toBase64(raw: string): string {
  let binary = ''
  for (let i = 0; i < raw.length; i++) {
    binary += String.fromCharCode(raw.charCodeAt(i) & 0xff)
  }
  return btoa(binary)
}

// TODO: we currently do not remove katex fonts which can not
// be downloaded..  we should do that.. the regex below
// doesn't work correctly..  but it is the right way to do it.
// also in minified code, possibly we wont be able to see a
// 'node_modules' string in them..
export function generateKaTeXIframeCss(): string {
  let css = katexCssRaw

  // 3) patch src: for whitelisted fonts → inline data: URLs
  for (const [path, raw] of Object.entries(rawFontModules)) {
    const filename = path.split('/').pop()!
    if (!WHITELIST.has(filename)) continue

    const base64 = toBase64(raw)

    const escName = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Replace the entire src: …; block for the woff2 variant
    const srcRe = new RegExp(
      String.raw`src:url\([^)]*${escName}[^)]*\)\s*format\("woff2"\)[^;]*;`,
      'g',
    )

    const replacement = `src:url("data:font/woff2;base64,${base64}") format("woff2");`

    css = css.replace(srcRe, replacement)
  }

  // 4) REMOVE any remaining @font-face rules that still reference node_modules fonts
  //    (i.e. fonts not in whitelist → cannot load → delete them)
  // css = css.replace(/@font-face\s*{[^}]*?\/node_modules\/katex\/dist\/fonts\/[^}]*?}/g, '')

  // Optional dev sanity check
  if (css.includes('/node_modules/katex/dist/fonts/')) {
    console.warn('[KaTeX iframe CSS] Some font URLs were not patched/removed as expected.')
  }

  return css
}
