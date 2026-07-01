import { convertFileToText } from '../utils/loadFiles'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const gzipTextFile = async (name: string, text: string) => {
  if (!('CompressionStream' in globalThis)) return null
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const compressed = await new Response(stream).arrayBuffer()
  return new File([compressed], name, { type: 'application/gzip' })
}

export const testConvertFileToTextReadsSpreadsheetFiles = async () => {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['name', 'value'],
    ['solar', 42],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([bytes], 'energy.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const text = await convertFileToText(file)

  assert(text.includes('# Sheet: Data'), `Expected sheet label in output: ${text}`)
  assert(text.includes('solar,42'), `Expected CSV row in output: ${text}`)
  return { text }
}

export const testConvertFileToTextSupportsRawHtmlMode = async () => {
  const raw = '<html><body><h1>Solar</h1><script>ignored()</script></body></html>'
  const file = new File([raw], 'page.html', { type: 'text/html' })

  const text = await convertFileToText(file, { htmlMode: 'raw' })

  assert(text === raw, `Expected raw HTML output, got: ${text}`)
  return { text }
}

export const testConvertFileToTextReadsGzippedTextByInnerExtension = async () => {
  const file = await gzipTextFile('energy.csv.gz', 'name,value\nsolar,42\n')
  if (!file) {
    return { skipped: true, reason: 'CompressionStream is unavailable in this runtime.' }
  }

  const text = await convertFileToText(file)

  assert(text.includes('solar,42'), `Expected decompressed CSV text, got: ${text}`)
  return { text }
}

testConvertFileToTextReadsSpreadsheetFiles.description =
  'Converts spreadsheet files into labeled CSV text.'
testConvertFileToTextSupportsRawHtmlMode.description =
  'Allows callers to read original HTML instead of cleaned HTML.'
testConvertFileToTextReadsGzippedTextByInnerExtension.description =
  'Decompresses .gz files and routes the inner filename through normal text conversion.'
