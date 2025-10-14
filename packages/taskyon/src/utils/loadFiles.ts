//import { PDFLoader } from "langchain/document_loaders/fs/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsLibRaw from 'pdfjs-dist/webpack'
import * as mammoth from 'mammoth'
import type pdfjsLibModule from 'pdfjs-dist'

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
    case 'md':
      return 'text/markdown'
    case 'csv':
      return 'text/csv'
    case 'tsv':
      return 'text/tab-separated-values'
    case 'json':
      return 'application/json'
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
  }
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

export async function convertFileToText(file: File) {
  let mime = file.type
  if (!mime || mime === 'application/octet-stream' || mime === 'text/plain') {
    mime = detectByExtension(file) || mime
  }

  console.log(`detected mime: ${mime} for ${file.name}`)

  switch (mime) {
    case 'application/pdf':
      return await read_pdf(file)

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return await read_docx(file)

    // easy text formats
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
    case 'application/rtf':
      return await file.text()
  }

  if (mime?.startsWith('text/')) {
    return await file.text()
  }

  throw new Error(`Unsupported file type: ${mime} from ${file.name}`)
}
