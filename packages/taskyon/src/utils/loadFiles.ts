//import { PDFLoader } from "langchain/document_loaders/fs/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
//import type pdfjsLibModule from 'pdfjs-dist'
import { cleanWebpageEnhanced } from './cleanHtml'

// TODO: handle encrypted files
// TODO: handle image some other files with content
export type ConvertFileToTextOptions = {
  htmlMode?: 'clean' | 'raw'
}

let pdfWorkerInitialized = false

async function read_pdf(file: File) {
  const pdfjsLib = await import('pdfjs-dist')

  if (!pdfWorkerInitialized) {
    const { GlobalWorkerOptions } = pdfjsLib

    // Vite will bundle this worker as an asset and give you a correct URL
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

    GlobalWorkerOptions.workerSrc = workerUrl
    pdfWorkerInitialized = true
  }

  const typedArray = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: typedArray })
  const pdf = await loadingTask.promise

  let textContent = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const text = await page.getTextContent()
    textContent += text.items.map((it) => ('str' in it ? it.str : '')).join('\n')
  }
  return textContent
}

async function read_docx(file: File) {
  const { extractRawText } = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await extractRawText({ arrayBuffer })
  return result.value
}

async function read_spreadsheet(file: File) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return ''
    const csv = XLSX.utils.sheet_to_csv(sheet)
    return [`# Sheet: ${sheetName}`, csv].filter(Boolean).join('\n')
  })
    .filter(Boolean)
    .join('\n\n')
}

function detectByName(name: string): string | undefined {
  const lowerName = name.toLowerCase()
  if (lowerName.endsWith('.tar.gz')) return 'application/gzip'

  const ext = lowerName.split('.').pop()
  switch (ext) {
    case 'txt':
    case 'log':
    case 'ini':
    case 'env':
    case 'properties':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'mdx':
      return 'text/mdx'
    case 'csv':
      return 'text/csv'
    case 'tsv':
      return 'text/tab-separated-values'
    case 'json':
      return 'application/json'
    case 'jsonl':
    case 'ndjson':
      return 'application/x-ndjson'
    case 'xml':
      return 'application/xml'
    case 'html':
      return 'text/html'
    case 'yaml':
    case 'yml':
      return 'text/yaml'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'application/javascript'
    case 'ts':
      return 'text/typescript'
    case 'css':
      return 'text/css'
    case 'svg':
      return 'image/svg+xml'
    case 'rtf':
      return 'application/rtf'
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'docm':
      return 'application/vnd.ms-word.document.macroEnabled.12' // treat like docx
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'ods':
      return 'application/vnd.oasis.opendocument.spreadsheet'
    case 'ipynb':
      return 'application/x-ipynb+json'
    case 'ics':
      return 'text/calendar'
    case 'srt':
      return 'application/x-subrip'
    case 'vtt':
      return 'text/vtt'
    case 'tex':
      return 'text/x-tex'
    case 'toml':
      return 'application/toml'
    case 'eml':
      return 'message/rfc822'
    case 'gz':
      return 'application/gzip'
  }
}

function detectByExtension(file: File): string | undefined {
  return detectByName(file.name)
}

type EncodingLabel = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'iso-8859-1'

function sniffBom(buf: Uint8Array): EncodingLabel | undefined {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
}

function decodeWith(enc: EncodingLabel, buf: ArrayBuffer): string {
  return new TextDecoder(enc, { fatal: true }).decode(new Uint8Array(buf))
}

function looksMostlyText(s: string): boolean {
  if (!s) return false
  // Keep: Letters, Numbers, Punctuation, Symbols, Space_Separator + tab/newline/CR.
  const printable = s.replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Zs}\t\n\r]/gu, '').length
  return printable / s.length >= 0.85
}

async function maybeGunzip(file: File, pre?: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(pre ?? (await file.slice(0, 2).arrayBuffer()))
  const hasGzipHeader = head[0] === 0x1f && head[1] === 0x8b

  if (hasGzipHeader && 'DecompressionStream' in globalThis) {
    // TS has DecompressionStream in lib.dom; if not, add "dom" to tsconfig lib.
    const ds = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>
    const decompressed = (file.stream() as ReadableStream<Uint8Array>).pipeThrough(ds)
    return await new Response(decompressed).arrayBuffer()
  }

  return pre ?? (await file.arrayBuffer())
}

async function tryBestEffortText(file: File): Promise<string> {
  // transparently gunzip if needed
  const ab = await maybeGunzip(file)
  const u8 = new Uint8Array(ab)
  const bom = sniffBom(u8)
  const order: EncodingLabel[] = bom
    ? [bom, 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1']
    : ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1']
  for (const enc of order) {
    try {
      const s = decodeWith(enc, ab)
      if (looksMostlyText(s)) return s
    } catch {
      /* try next */
    }
  }
  // last ditch: permissive utf-8 (replacement chars allowed)
  const s = new TextDecoder('utf-8').decode(u8)
  if (looksMostlyText(s)) return s
  throw new Error('File appears binary; no safe text representation found.')
}

function rtfToTextNaive(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(/\\u-?\d+\??/g, '') // drop \uNNNN
    .replace(/\\[a-z]+-?\d*(?:\s|(?=[\\{}]))/gi, '') // strip control words
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type NbCell = { source?: string | string[] }

async function read_ipynb(file: File) {
  const json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(await maybeGunzip(file))))
  const cells = Array.isArray(json?.cells)
    ? (json.cells as NbCell[])
        .map((c) => (Array.isArray(c?.source) ? c.source.join('') : (c?.source ?? '')))
        .join('\n\n')
    : ''
  return cells || JSON.stringify(json, null, 2)
}

/*async function detectFileType(file: File): Promise<string | undefined> {
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type
  }

  // Dynamically import wasmagic only when needed
  const { WASMagic } = await import('wasmagic')

  const magic = await WASMagic.create(wasmUrl)

  const buf = new Uint8Array(await file.arrayBuffer())
  const mime = magic.detect(buf)

  return mime
}*/

export async function convertFileToText(
  file: File,
  options: ConvertFileToTextOptions = {},
): Promise<string> {
  return convertFileToTextInternal(file, options, 0)
}

async function convertFileToTextInternal(
  file: File,
  options: ConvertFileToTextOptions,
  depth: number,
): Promise<string> {
  let mime = file.type
  if (!mime || mime === 'application/octet-stream' || mime === 'text/plain') {
    mime = detectByExtension(file) || mime
  }
  console.log(`detected mime: ${mime} for ${file.name}`)

  switch (mime) {
    case 'application/pdf':
      return await read_pdf(file)

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.ms-word.document.macroEnabled.12': // docm -> docx path
      return await read_docx(file)

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel.sheet.macroEnabled.12':
    case 'application/vnd.ms-excel':
    case 'application/vnd.oasis.opendocument.spreadsheet':
      return await read_spreadsheet(file)

    case 'application/x-ipynb+json':
      return await read_ipynb(file)

    case 'application/gzip': {
      const ab = await maybeGunzip(file)
      const innerName = file.name.replace(/\.gz$/i, '')
      const innerMime = detectByName(innerName)
      if (depth < 2 && innerMime && innerMime !== 'application/gzip') {
        const innerFile = new File([ab], innerName || file.name, { type: innerMime })
        return await convertFileToTextInternal(innerFile, options, depth + 1)
      }
      return tryBestEffortArrayBuffer(ab)
    }

    case 'application/rtf': {
      const raw = await tryBestEffortText(file)
      return rtfToTextNaive(raw)
    }

    // easy text formats (keep your list)
    case 'application/json':
    case 'application/xml':
    case 'text/xml':
    case 'text/html': {
      const raw = await file.text()
      return options.htmlMode === 'raw' ? raw : cleanWebpageEnhanced(raw)
    }
    case 'text/markdown':
    case 'text/csv':
    case 'text/tab-separated-values':
    case 'text/yaml':
    case 'application/x-yaml':
    case 'application/javascript':
    case 'text/javascript':
    case 'text/typescript':
    case 'text/css':
    case 'image/svg+xml':
    case 'text/plain':
    case 'text/mdx':
    case 'text/calendar':
    case 'application/x-subrip':
    case 'text/vtt':
    case 'text/x-tex':
    case 'application/toml':
    case 'message/rfc822':
    case 'application/x-ndjson':
      return await tryBestEffortText(file)
  }

  // Fallbacks
  if (mime?.startsWith('text/')) return await tryBestEffortText(file)
  // Unknown? still attempt best-effort decode (covers mislabeled text and gzipped files)
  try {
    return await tryBestEffortText(file)
  } catch {
    throw new Error(`Unsupported or binary file: ${mime ?? 'unknown'} from ${file.name}`)
  }
}

function tryBestEffortArrayBuffer(ab: ArrayBuffer): string {
  const u8 = new Uint8Array(ab)
  const bom = sniffBom(u8)
  const order: EncodingLabel[] = bom
    ? [bom, 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1']
    : ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1']

  for (const enc of order) {
    try {
      const s = decodeWith(enc, ab)
      if (looksMostlyText(s)) return s
    } catch {
      // next
    }
  }
  const s = new TextDecoder('utf-8').decode(u8)
  if (looksMostlyText(s)) return s
  throw new Error('Binary after decompression; no text.')
}
