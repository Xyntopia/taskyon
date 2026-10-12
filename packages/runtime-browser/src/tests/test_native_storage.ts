import { createFileSystemStorageProvider } from '@taskyon/taskyon/api'
import {
  runStorageBackendContract,
  runStorageStreamingContract,
} from '@taskyon/taskyon/test-support'
import {
  createBrowserStoragePreferenceStore,
  selectBrowserStorageProvider,
} from '../browserStorageSelection'
import { createTauriStorageFileSystem } from '../nativeStorage'

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as Record<string, unknown>)

const unavailable = { skipped: true, reason: 'Native Tauri filesystem is unavailable.' }

const testRoot = () => `taskyon-storage/tests/${crypto.randomUUID()}`

export const testNativeStorageIsAvailable = async () => {
  if (!isTauri()) return unavailable
  const fs = await createTauriStorageFileSystem(testRoot())
  await fs.mkdir('')
  await fs.writeFile('probe.txt', new TextEncoder().encode('native-storage-probe'))
  const data = await fs.readFile('probe.txt')
  await fs.remove('', { recursive: true })
  if (new TextDecoder().decode(data ?? new Uint8Array()) !== 'native-storage-probe') {
    throw new Error('Native Tauri filesystem did not round-trip a file.')
  }
}

testNativeStorageIsAvailable.description =
  'Reads and writes a file through the Tauri native filesystem adapter.'

export const testNativeStorageImplementsStorageBackendContract = async () => {
  if (!isTauri()) return unavailable
  const fs = await createTauriStorageFileSystem(testRoot())
  try {
    await runStorageBackendContract(createFileSystemStorageProvider(fs))
  } finally {
    await fs.remove('', { recursive: true }).catch(() => undefined)
  }
}

testNativeStorageImplementsStorageBackendContract.description =
  'Runs the shared record and blob contract against the Tauri native filesystem.'

export const testNativeStorageStreamsLargeObjects = async () => {
  if (!isTauri()) return unavailable
  const fs = await createTauriStorageFileSystem(testRoot())
  try {
    await runStorageStreamingContract(createFileSystemStorageProvider(fs))
  } finally {
    await fs.remove('', { recursive: true }).catch(() => undefined)
  }
}

testNativeStorageStreamsLargeObjects.description =
  'Stages and reopens a 17 MiB blob through the Tauri native filesystem.'

export const testNativeStorageIsPreferredOnDesktop = async () => {
  if (!isTauri()) return unavailable
  const values = new Map<string, string>()
  const preferences = createBrowserStoragePreferenceStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  })
  const { selection } = await selectBrowserStorageProvider({ preferences })
  if (selection.records !== 'native' || selection.blobs !== 'native') {
    throw new Error(
      `Desktop storage did not select native: ${selection.records}/${selection.blobs}`,
    )
  }
}

testNativeStorageIsPreferredOnDesktop.description =
  'Selects the native filesystem backend for records and blobs on desktop.'
