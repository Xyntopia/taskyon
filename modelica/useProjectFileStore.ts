import { Dialog, Notify } from 'quasar'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

type UseProjectFileStoreParams<TProjectFile> = {
  packProjectFile: () => TProjectFile
  applyProjectFile: (projectFile: TProjectFile) => void
  validateProjectFile: (value: unknown) => TProjectFile
  storageKey?: string
  projectFolderPrefix?: string
}

function downloadTextFile(opts: { fileName: string; content: string; mime?: string }) {
  const blob = new Blob([opts.content ?? ''], { type: opts.mime ?? 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

async function confirmDialog(opts: {
  title: string
  message: string
  okLabel?: string
  cancelLabel?: string
}): Promise<boolean> {
  return await new Promise((resolve) => {
    Dialog.create({
      title: opts.title,
      message: opts.message,
      ok: { label: opts.okLabel ?? 'OK' },
      cancel: { label: opts.cancelLabel ?? 'Cancel' },
      persistent: true,
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false))
      .onDismiss(() => resolve(false))
  })
}

async function promptDialog(opts: {
  title: string
  message: string
  okLabel?: string
  cancelLabel?: string
  initialValue?: string
}): Promise<string | null> {
  return await new Promise((resolve) => {
    Dialog.create({
      title: opts.title,
      message: opts.message,
      prompt: {
        model: opts.initialValue ?? '',
        type: 'text',
      },
      ok: { label: opts.okLabel ?? 'OK' },
      cancel: { label: opts.cancelLabel ?? 'Cancel' },
      persistent: true,
    })
      .onOk((v: unknown) => {
        if (typeof v === 'string') return resolve(v.trim() || null)
        if (typeof v === 'number') return resolve(String(v).trim() || null)
        return resolve(null)
      })
      .onCancel(() => resolve(null))
      .onDismiss(() => resolve(null))
  })
}

export function useProjectFileStore<TProjectFile>(
  params: UseProjectFileStoreParams<TProjectFile>,
): {
  projectImportEl: Ref<HTMLInputElement | null>
  currentProjectId: Ref<string>
  availableProjectIds: Ref<string[]>
  projectFile: ShallowRef<TProjectFile | null>
  refreshAvailableProjects: () => Promise<void>
  deleteCurrentProject: () => Promise<void>
  createNewProjectDialog: () => Promise<void>
  onProjectSelected: (val: string) => void
  exportProjectJson: () => void
  triggerImportProject: () => void
  onImportProjectFile: (e: Event) => Promise<void>
  loadProjectById: (projectId: string) => void
} {
  const storageKey = params.storageKey ?? 'taskyon.modelica.projectId'
  const projectFolderPrefix = params.projectFolderPrefix ?? 'modelicaProject_'
  const initialProjectId = String(localStorage.getItem(storageKey) || 'default').trim() || 'default'

  const projectImportEl = ref<HTMLInputElement | null>(null)
  const currentProjectId = ref<string>(initialProjectId)
  const availableProjectIds = ref<string[]>([])
  const projectFile = shallowRef<TProjectFile | null>(null)

  const coerceProjectId = (value: unknown, fallback: string): string => {
    if (typeof value === 'string') return value.trim() || fallback
    if (typeof value === 'number') return String(value)
    return fallback
  }

  async function refreshAvailableProjects() {
    try {
      const navAny = navigator as unknown as {
        storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
      }
      if (!navAny.storage?.getDirectory) {
        Notify.create({ type: 'warning', message: 'OPFS directory listing not supported.' })
        return
      }
      const root = await navAny.storage.getDirectory()
      const ids: string[] = []
      for await (const [name, handle] of root.entries()) {
        if (
          handle?.kind === 'directory' &&
          typeof name === 'string' &&
          name.startsWith(projectFolderPrefix)
        ) {
          ids.push(name.slice(projectFolderPrefix.length))
        }
      }
      ids.sort()
      availableProjectIds.value = ids
    } catch (e) {
      console.warn('Failed to list OPFS projects:', e)
      Notify.create({
        type: 'warning',
        message: `Failed to detect saved projects: ${(e as Error).message}`,
      })
    }
  }

  function loadProjectById(projectId: string) {
    const id = String(projectId || '').trim()
    if (!id) return
    localStorage.setItem(storageKey, id)
    currentProjectId.value = id
    setTimeout(() => window.location.reload(), 50)
  }

  async function deleteCurrentProject() {
    const id = String(currentProjectId.value || '').trim()
    if (!id) return

    const confirmed = await confirmDialog({
      title: 'Delete project',
      message: `Delete project '${id}'? This cannot be undone.`,
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
    })
    if (!confirmed) return

    const dirName = `${projectFolderPrefix}${id}`
    try {
      const navAny = navigator as unknown as {
        storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
      }
      if (!navAny.storage?.getDirectory) {
        Notify.create({ type: 'warning', message: 'OPFS not supported in this browser.' })
        return
      }
      const root = await navAny.storage.getDirectory()
      const rootWithRemoveEntry = root as unknown as {
        removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>
      }
      if (typeof rootWithRemoveEntry.removeEntry !== 'function') {
        Notify.create({ type: 'warning', message: 'OPFS delete is not supported in this browser.' })
        return
      }
      await rootWithRemoveEntry.removeEntry(dirName, { recursive: true })
      Notify.create({ type: 'positive', message: `Deleted project '${id}'` })
      await refreshAvailableProjects()
      const next = availableProjectIds.value.find((x) => x !== id) ?? 'default'
      loadProjectById(next)
    } catch (e) {
      console.warn('Failed to delete OPFS project:', e)
      Notify.create({
        type: 'negative',
        message: `Failed to delete project: ${(e as Error).message}`,
      })
    }
  }

  async function createNewProjectDialog() {
    const id = await promptDialog({
      title: 'New project',
      message: 'Enter a project name',
      okLabel: 'Create',
      cancelLabel: 'Cancel',
      initialValue: '',
    })
    if (!id) return
    if (availableProjectIds.value.includes(id)) {
      Notify.create({ type: 'warning', message: `Project '${id}' already exists. Switching to it.` })
      loadProjectById(id)
      return
    }
    availableProjectIds.value = [...availableProjectIds.value, id].sort()
    loadProjectById(id)
  }

  function onProjectSelected(val: string) {
    const id = String(val || '').trim()
    if (!id) return
    if (id === currentProjectId.value) return
    loadProjectById(id)
  }

  function exportProjectJson() {
    const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const pf = params.packProjectFile()
    const id = coerceProjectId((pf as { projectId?: unknown })?.projectId, currentProjectId.value)
    downloadTextFile({
      fileName: `project_${id}_${now}.json`,
      content: JSON.stringify(pf, null, 2),
      mime: 'application/json',
    })
  }

  function triggerImportProject() {
    projectImportEl.value?.click()
  }

  async function onImportProjectFile(e: Event) {
    const el = e.target as HTMLInputElement
    const f = el.files?.[0]
    if (!f) return
    const txt = await f.text()
    try {
      const pf = params.validateProjectFile(JSON.parse(txt))
      currentProjectId.value = coerceProjectId((pf as { projectId?: unknown })?.projectId, 'default')
      projectFile.value = pf
      params.applyProjectFile(pf)
      Notify.create({ type: 'positive', message: `Project imported: ${currentProjectId.value}` })
    } catch (err) {
      Notify.create({ type: 'negative', message: `Project import failed: ${(err as Error).message}` })
    } finally {
      el.value = ''
    }
  }

  return {
    projectImportEl,
    currentProjectId,
    availableProjectIds,
    projectFile,
    refreshAvailableProjects,
    deleteCurrentProject,
    createNewProjectDialog,
    onProjectSelected,
    exportProjectJson,
    triggerImportProject,
    onImportProjectFile,
    loadProjectById,
  }
}
