import { exportFile } from 'quasar'

export type FileSaveOutcome = 'saved' | 'cancelled' | 'downloaded'
export type FileSaveProducer = () => Promise<Blob | string> | Blob | string

type SaveFileWritable = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type SaveFileHandle = {
  createWritable: () => Promise<SaveFileWritable>
}

type SaveFilePicker = (options: {
  suggestedName: string
  types?: { accept: Record<string, string[]> }[]
}) => Promise<SaveFileHandle>

const getSaveFilePicker = (): SaveFilePicker | undefined => {
  if (typeof window === 'undefined') return undefined
  const picker = Reflect.get(window, 'showSaveFilePicker')
  return typeof picker === 'function' ? (picker as SaveFilePicker).bind(window) : undefined
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

const pickerTypes = (fileName: string, mimeType: string) => {
  const extension = fileName.slice(fileName.lastIndexOf('.'))
  if (!extension.startsWith('.') || extension.length < 2) return undefined
  const mime = mimeType.split(';')[0]?.trim() || 'application/octet-stream'
  return [{ accept: { [mime]: [extension] } }]
}

const toBlob = (data: Blob | string, mimeType: string) =>
  typeof data === 'string' ? new Blob([data], { type: mimeType }) : data

export const saveFile = async (
  fileName: string,
  mimeType: string,
  produce: FileSaveProducer,
): Promise<FileSaveOutcome> => {
  const picker = getSaveFilePicker()
  if (picker) {
    const types = pickerTypes(fileName, mimeType)
    let handle: SaveFileHandle | undefined
    try {
      handle = await picker({ suggestedName: fileName, ...(types ? { types } : {}) })
    } catch (error) {
      if (isAbortError(error)) return 'cancelled'
    }
    if (handle) {
      const writable = await handle.createWritable()
      await writable.write(toBlob(await produce(), mimeType))
      await writable.close()
      return 'saved'
    }
  }
  if (exportFile(fileName, toBlob(await produce(), mimeType), mimeType) !== true)
    throw new Error('The browser could not start the download.')
  return 'downloaded'
}
