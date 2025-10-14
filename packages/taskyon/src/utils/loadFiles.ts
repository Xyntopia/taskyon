//import { PDFLoader } from "langchain/document_loaders/fs/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsLibRaw from 'pdfjs-dist/webpack'
import * as mammoth from 'mammoth'
import type pdfjsLibModule from 'pdfjs-dist'

// TODO: handle compressed files
// TODO: handle encrypted files
// TODO: handle open office files
// TODO: handle image some other files with content
// TODO: handle excel files

const pdfjsLib = pdfjsLibRaw as typeof pdfjsLibModule

async function read_pdf(file: File) {
  const typedArray = await file.arrayBuffer()

  // Load the PDF file.
  //const loadingTask = PDFJS.getDocument(pdfData);
  //const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  //const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  const loadingTask = pdfjsLib.getDocument({ data: typedArray })
  const pdf = await loadingTask.promise

  let textContent = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    // Fetch the page
    const page = await pdf.getPage(i)

    // Fetch the text content
    const text = await page.getTextContent()

    // Concatenate the text
    textContent += text.items.map((item) => ('str' in item ? item.str : '')).join('\n')
  }

  return textContent
}

async function read_docx(file: File) {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer })
  return result.value
}

function detectByExtension(file: File): string | undefined {
  const ext = file.name.split('.').pop()?.toLowerCase()
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

export async function convertFileToText(file: File): Promise<string> {
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

    case 'application/x-ipynb+json':
      return await read_ipynb(file)

    case 'application/gzip': {
      const ab = await maybeGunzip(file)
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
    case 'text/html':
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
