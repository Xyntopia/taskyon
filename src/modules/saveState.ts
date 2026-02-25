import type { Ref } from 'vue'
import { computed, watch, isRef, toRaw, isReactive } from 'vue'

/* ------------------------------------------------------------------ */
/* localStorage version (unchanged)                                   */
/* ------------------------------------------------------------------ */

interface LocalStorageSyncOptions {
  debounceMs?: number
}

export function syncRefsWithLocalStorage(
  key: string,
  refs: Record<string, Ref<unknown>>,
  options: LocalStorageSyncOptions = {},
) {
  // Load saved state if available
  const savedRaw = localStorage.getItem(key)
  if (savedRaw) {
    try {
      const saved = JSON.parse(savedRaw)
      for (const k in refs) {
        if (k in saved) {
          refs[k]!.value = saved[k as keyof typeof saved]
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Wrap the refs into a computed POJO of plain values.
  const wrapped = computed(() => {
    const out: Record<string, unknown> = {}
    for (const k in refs) {
      out[k] = refs[k]!.value
    }
    return out
  })

  const debounceMs = options.debounceMs ?? 0
  let debounceHandle: ReturnType<typeof setTimeout> | null = null

  // Watch the computed wrapper and persist to localStorage.
  watch(
    wrapped,
    (newVals) => {
      const persist = () => {
        try {
          localStorage.setItem(key, JSON.stringify(newVals))
        } catch (e) {
          console.error('Failed to save state to localStorage', e)
        }
      }

      if (debounceMs <= 0) {
        persist()
        return
      }

      if (debounceHandle) {
        clearTimeout(debounceHandle)
      }

      debounceHandle = setTimeout(() => {
        persist()
        debounceHandle = null
      }, debounceMs)
    },
    { deep: true },
  )
}

/* ------------------------------------------------------------------ */
/* OPFS-backed version with File serialization + ref/reactive support */
/* ------------------------------------------------------------------ */

interface OPFSFileDescriptor {
  __opfsFile: true
  path: string
  fileName: string
  mimeType: string
  lastModified: number
}

function isOPFSFileDescriptor(v: unknown): v is OPFSFileDescriptor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!v && typeof v === 'object' && (v as any).__opfsFile === true
}

async function serializeStateWithFiles(
  state: Record<string, unknown>,
  filesDir: FileSystemDirectoryHandle,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(state)) {
    if (value instanceof File) {
      const safeName = `${key}__${value.name || 'file'}`
      const fileHandle = await filesDir.getFileHandle(safeName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(value)
      await writable.close()

      out[key] = {
        __opfsFile: true,
        path: safeName,
        fileName: value.name,
        mimeType: value.type,
        lastModified: value.lastModified,
      } satisfies OPFSFileDescriptor
    } else {
      out[key] = value
    }
  }

  return out
}

async function deserializeStateWithFiles(
  serialized: Record<string, unknown>,
  filesDir: FileSystemDirectoryHandle,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(serialized)) {
    if (isOPFSFileDescriptor(value)) {
      try {
        const fileHandle = await filesDir.getFileHandle(value.path)
        const storedFile = await fileHandle.getFile()
        const blob = storedFile.slice()
        const file = new File([blob], value.fileName, {
          type: value.mimeType,
          lastModified: value.lastModified,
        })

        out[key] = file
      } catch (e) {
        console.warn(`Failed to load OPFS file for key "${key}"`, e)
        out[key] = value
      }
    } else {
      out[key] = value
    }
  }

  return out
}

/**
 * OPFS sync that works with both:
 *   - an object of refs:     { foo: ref(1), file: ref<File | null>(null) }
 *   - a reactive object:     const state = reactive({ foo: 1, file: null })
 *
 * Top-level `File` values are stored under `<folder>/files/…`,
 * with descriptors kept in `<folder>/state.json`.
 */
export async function syncStateWithOPFSFolder(
  folderName: string,
  state: Record<string, unknown>, // can be reactive or a plain object of refs
) {
  const navAny = navigator

  console.log('syc with opfs store', folderName)

  if (!navAny.storage?.getDirectory) {
    console.warn('OPFS is not supported in this browser; skipping OPFS sync.')
    return
  }

  let stateDir: FileSystemDirectoryHandle
  let filesDir: FileSystemDirectoryHandle
  let stateFileHandle: FileSystemFileHandle

  try {
    const rootDir: FileSystemDirectoryHandle = await navAny.storage.getDirectory()
    stateDir = await rootDir.getDirectoryHandle(folderName, { create: true })
    filesDir = await stateDir.getDirectoryHandle('files', { create: true })
    stateFileHandle = await stateDir.getFileHandle('state.json', { create: true })
  } catch (e) {
    console.error('Failed to access OPFS directory', e)
    return
  }

  // Load existing state from state.json
  try {
    const file = await stateFileHandle.getFile()
    const text = await file.text()
    if (text.trim()) {
      const serialized = JSON.parse(text) as Record<string, unknown>
      const hydrated = await deserializeStateWithFiles(serialized, filesDir)

      // Write back into either refs or reactive props
      for (const key in hydrated) {
        const targetProp = state[key]
        const value = hydrated[key]

        if (isRef(targetProp)) {
          // For refs: assign to .value
          targetProp.value = value
        } else if (isReactive(targetProp) && value && typeof value === 'object') {
          // For reactive objects: merge properties into the existing object
          Object.assign(targetProp as Record<string, unknown>, value as Record<string, unknown>)
        } else {
          // Fallback: overwrite
          state[key] = value
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load state from OPFS (starting with defaults)', e)
  }

  // Build a computed snapshot that unwraps refs but also works for reactive.
  const snapshot = computed(() => {
    const out: Record<string, unknown> = {}
    const raw = toRaw(state)

    for (const key in raw) {
      const v = raw[key]
      out[key] = isRef(v) ? v.value : v
    }
    return out
  })

  // Watch and persist to OPFS whenever anything changes (deeply).
  watch(
    snapshot,
    async (newVals) => {
      try {
        const serialized = await serializeStateWithFiles(newVals, filesDir)
        const writable = await stateFileHandle.createWritable()
        await writable.write(JSON.stringify(serialized))
        await writable.close()
      } catch (e) {
        console.error('Failed to save state to OPFS', e)
      }
    },
    { deep: true },
  )
}
