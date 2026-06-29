<!-- FileManagerPage.vue – DEBUG INSTRUMENTED -->
<template>
  <q-page padding>
    <FileDropzone class="q-mb-md" enable-paste @add-files="addFiles" />

    <q-card>
      <q-card-section>
        <div class="text-h6">
          Joulios File Browser
          <InfoDialog
            info-text="This browser shows all files that taskyon saved in its [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) file system and can interact with!"
          />
        </div>
      </q-card-section>
      <q-separator />

      <q-card-section>
        <q-tree
          v-model:expanded="expandedNodeIds"
          :nodes="treeData"
          node-key="id"
          accordion
          dense
          selected-color="secondary"
          @lazy-load="handleLazyLoad"
        >
          <template #default-header="{ node }">
            <div
              class="row items-center no-wrap cursor-pointer"
              :class="{ 'highlighted-leaf': node.id === selectedNodeId }"
              @click="onNodeClick(node)"
            >
              <q-icon :name="node.icon" class="q-mr-sm" />
              <div class="ellipsis">{{ node.label }}</div>
              <q-space />
              <div
                v-if="node.kind === 'file' || (node.kind === 'directory' && node.size != null)"
                class="text-caption text-grey-7 q-mr-sm"
              >
                {{ formatSize(node.size) }}
              </div>
              <div class="text-caption text-grey-7 q-mr-sm">
                {{ formatModified(node.modifiedAt) }}
              </div>
              <q-btn
                v-if="node.kind === 'directory'"
                dense
                flat
                round
                :icon="matInfo"
                @click.stop="showFolderInfo(node)"
              />
              <q-btn
                v-if="node.kind === 'file'"
                dense
                flat
                round
                :icon="matDownload"
                @click.stop="downloadFile(node)"
              />
              <q-btn
                v-if="node.kind === 'file'"
                dense
                flat
                round
                :icon="matContentCopy"
                @click.stop="copyPath(node)"
              />
              <q-btn
                v-if="node.kind === 'file' || node.kind === 'directory'"
                dense
                flat
                round
                color="negative"
                :icon="matDelete"
                @click.stop="deleteEntry(node)"
              />
            </div>
          </template>
        </q-tree>
      </q-card-section>
    </q-card>

    <q-card v-if="markdownPreview != null" class="q-mt-md">
      <q-card-section class="row items-center q-gutter-sm">
        <div class="text-subtitle1">Markdown Preview</div>
        <q-space />
        <div class="text-caption text-grey-7">{{ markdownPreviewPath }}</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <TyMarkdown :src="markdownPreview" />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import {
  matContentCopy,
  matDelete,
  matDownload,
  matFolder,
  matInfo,
} from '@quasar/extras/material-icons'
import { mdiFile } from '@quasar/extras/mdi-v6'
import type { QTreeNode } from 'quasar'
import FileDropzone from '../components/FileDropzone.vue'
import InfoDialog from '../components/InfoDialog.vue'
import TyMarkdown from '../components/tyMarkdown.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  initialPath?: string | string[]
}>()

const normalizedPath = computed(() => {
  if (!props.initialPath) return ''
  return Array.isArray(props.initialPath)
    ? props.initialPath.filter(Boolean).join('/')
    : props.initialPath
})

/* ---------- state ---------- */

const treeData = ref<TreeNode[]>([])
const selectedNodeId = ref<string | null>(null)
const expandedNodeIds = ref<string[]>([])
const markdownPreview = ref<string | null>(null)
const markdownPreviewPath = ref<string | null>(null)

watch(normalizedPath, async (path) => {
  if (path && treeData.value.length > 0) {
    await openPath(path)
  }
})

onMounted(async () => {
  await buildRoot()
  if (normalizedPath.value) {
    await openPath(normalizedPath.value)
  }
})

async function openPath(path: string) {
  const segments = path.split('/').filter(Boolean)
  let currentNodes = treeData.value
  let current: TreeNode | undefined

  console.log(
    '[openPath] path=',
    path,
    'segments=',
    segments,
    'root IDs=',
    treeData.value.map((n) => n.id),
  )

  for (let i = 0; i < segments.length; i++) {
    const segPath = segments.slice(0, i + 1).join('/')
    current = currentNodes.find((n) => n.id === segPath)

    if (!current) {
      console.warn('[openPath] segment not found:', segPath)
      return
    }

    if (current.kind === 'directory') {
      if (current.lazy) {
        const children = await dirHandleToNodes(current.handle as DirHandle, current.path)
        current.children = children
        current.lazy = false
      }
      if (!expandedNodeIds.value.includes(current.id)) {
        expandedNodeIds.value.push(current.id)
      }
      currentNodes = (current.children ?? []) as TreeNode[]
    } else {
      if (i === segments.length - 1) {
        console.log('[openPath] normalizedPath', path, '→ selecting', current?.id)
        selectedNodeId.value = current.id
        console.log('[openPath] selected leaf', current.id)
      }
    }
  }
}

/* ---------- helpers ---------- */

/** Pretty-print file sizes for the UI */
function formatSize(size?: number) {
  if (size == null) return ''
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(2)} MB`
  if (size >= 1_024) return `${(size / 1_024).toFixed(2)} KB`
  return `${size} B`
}

/** Pretty-print "last modified" values */
function formatModified(timestamp?: number) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

/** OPFS directory handle with typed .entries() (just for TS) */
type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

/** Our node extends Quasar’s, keeps TypeScript happy */
interface TreeNode extends QTreeNode {
  handle: FileSystemHandle
  kind: 'file' | 'directory'
  size?: number
  modifiedAt?: number
  path: string
}

interface DirectoryStats {
  totalSize: number
  latestModified?: number
  fileCount: number
  directoryCount: number
}

const directoryStatsCache = new Map<string, Promise<DirectoryStats>>()

async function getDirectoryStats(dir: DirHandle, dirPath: string): Promise<DirectoryStats> {
  const cacheKey = dirPath || '.'
  const cached = directoryStatsCache.get(cacheKey)
  if (cached) return cached

  const pending = (async () => {
    let totalSize = 0
    let latestModified: number | undefined
    let fileCount = 0
    let directoryCount = 0

    for await (const [name, handle] of dir.entries()) {
      const fullPath = dirPath ? `${dirPath}/${name}` : name
      if (handle.kind === 'file') {
        const file = await handle.getFile()
        totalSize += file.size
        fileCount += 1
        if (latestModified == null || file.lastModified > latestModified) {
          latestModified = file.lastModified
        }
      } else {
        directoryCount += 1
        const child = await getDirectoryStats(handle as DirHandle, fullPath)
        totalSize += child.totalSize
        fileCount += child.fileCount
        directoryCount += child.directoryCount
        if (
          child.latestModified != null &&
          (latestModified == null || child.latestModified > latestModified)
        ) {
          latestModified = child.latestModified
        }
      }
    }

    const result: DirectoryStats = { totalSize, fileCount, directoryCount }
    if (latestModified != null) {
      result.latestModified = latestModified
    }
    return result
  })()

  directoryStatsCache.set(cacheKey, pending)
  return pending
}

async function hydrateDirectoryMetadata(node: TreeNode) {
  if (node.kind !== 'directory') return
  try {
    const stats = await getDirectoryStats(node.handle as DirHandle, node.path)
    node.size = stats.totalSize
    if (stats.latestModified != null) {
      node.modifiedAt = stats.latestModified
    } else {
      delete node.modifiedAt
    }
  } catch (err) {
    console.warn('[hydrateDirectoryMetadata] failed for', node.path, err)
  }
}

/* ---------- directory → nodes ---------- */

async function dirHandleToNodes(dir: DirHandle, parentPath = ''): Promise<TreeNode[]> {
  console.log('[dirHandleToNodes] Reading directory', dir)
  const out: TreeNode[] = []

  for await (const [name, handle] of dir.entries()) {
    console.log('  ├─ found', name, 'kind=', handle.kind)
    const fullPath = parentPath ? `${parentPath}/${name}` : name

    if (handle.kind === 'file') {
      const fileHandle = handle
      const file = await fileHandle.getFile()
      out.push({
        id: fullPath,
        label: name,
        icon: mdiFile,
        kind: 'file',
        size: file.size,
        modifiedAt: file.lastModified,
        handle,
        path: fullPath,
      })
    } else {
      out.push({
        id: fullPath,
        label: name,
        icon: matFolder,
        kind: 'directory',
        handle,
        lazy: true,
        path: fullPath,
      })
    }
  }

  const sorted = out.sort((a, b) =>
    a.kind === b.kind
      ? (a.label ?? '').localeCompare(b.label ?? '')
      : a.kind === 'directory'
        ? -1
        : 1,
  )

  console.log('[dirHandleToNodes] → returning', sorted.length, 'nodes')
  for (const node of sorted) {
    if (node.kind === 'directory') {
      void hydrateDirectoryMetadata(node)
    }
  }
  return sorted
}

/* ---------- initial root ---------- */

async function buildRoot() {
  console.log('[buildRoot] Fetching OPFS root')
  directoryStatsCache.clear()
  const root = (await navigator.storage.getDirectory()) as DirHandle
  treeData.value = await dirHandleToNodes(root, '')
  await nextTick()
  console.log('[buildRoot] Root built; nodes =', treeData.value.length)
}

/* ---------- lazy loader ---------- */

async function handleLazyLoad({
  node,
  done,
}: {
  node: TreeNode
  key: string
  done: (c?: QTreeNode[]) => void
}) {
  // 1️⃣  use node.lazy as the decisive flag
  if (node.kind === 'directory' && node.lazy) {
    try {
      const children = await dirHandleToNodes(node.handle as DirHandle, node.path)

      // update the node so later clicks can find the files
      node.children = children
      node.lazy = false // Quasar will also flip this, but safe to do

      done(children as QTreeNode[])
    } catch (err) {
      console.error('[handleLazyLoad] failed:', err)
      done() // prevent spinner from hanging
    }
  } else {
    done((node.children ?? []) as QTreeNode[])
  }
}

/* ---------- click selection ---------- */

async function onNodeClick(node: TreeNode) {
  if (node.kind === 'directory') return // let expand/collapse happen
  const label = typeof node.label === 'string' ? node.label : ''
  if (label.toLowerCase().endsWith('.md')) {
    selectedNodeId.value = node.id
    const file = await (node.handle as FileSystemFileHandle).getFile()
    markdownPreview.value = await file.text()
    markdownPreviewPath.value = node.path
    return
  }
  markdownPreview.value = null
  markdownPreviewPath.value = null
  await downloadFile(node)
}

async function downloadFile(node: TreeNode) {
  const file = await (node.handle as FileSystemFileHandle).getFile()
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  URL.revokeObjectURL(url)
}

async function copyPath(node: TreeNode) {
  try {
    await navigator.clipboard.writeText(node.path)
    console.log('[copyPath] copied', node.path)
  } catch (err) {
    console.error('[copyPath] failed:', err)
  }
}

async function deleteEntry(node: TreeNode) {
  const confirmed = window.confirm(
    node.kind === 'directory'
      ? `Delete directory "${node.path}" and ALL its contents?`
      : `Delete file "${node.path}"?`,
  )
  if (!confirmed) return

  try {
    directoryStatsCache.clear()
    const segments = node.path.split('/')
    const name = segments.pop()
    const parentPath = segments.join('/')

    let parent: FileSystemDirectoryHandle = await navigator.storage.getDirectory()
    if (parentPath) {
      for (const p of parentPath.split('/')) {
        parent = await parent.getDirectoryHandle(p)
      }
    }

    if (!name) return

    await parent.removeEntry(name, {
      recursive: node.kind === 'directory',
    })

    // 🔪 surgically remove from UI tree
    removeNodeById(treeData.value, node.id)

    // clean expansion state
    expandedNodeIds.value = expandedNodeIds.value.filter((id) => !id.startsWith(node.id))

    if (selectedNodeId.value === node.id) {
      selectedNodeId.value = null
    }
    if (markdownPreviewPath.value === node.path) {
      markdownPreview.value = null
      markdownPreviewPath.value = null
    }

    console.log('[deleteEntry] removed', node.path)
  } catch (err) {
    console.error('[deleteEntry] failed:', err)
  }
}

/* ---------- uploads ---------- */

async function addFiles(files: File[]) {
  const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory()
  console.log('[addFiles] Adding', files.length, 'file(s) to root')
  for (const f of files) {
    const h = await root.getFileHandle(f.name, { create: true })
    const w = await h.createWritable()
    await f.stream().pipeTo(w)
    console.log('  └─ Added', f.name)
  }
  directoryStatsCache.clear()
  await buildRoot()
}

async function showFolderInfo(node: TreeNode) {
  if (node.kind !== 'directory') return
  try {
    const stats = await getDirectoryStats(node.handle as DirHandle, node.path)
    node.size = stats.totalSize
    if (stats.latestModified != null) {
      node.modifiedAt = stats.latestModified
    } else {
      delete node.modifiedAt
    }
    window.alert(
      [
        `Folder: ${node.path || '/'}`,
        `Total size: ${formatSize(stats.totalSize)}`,
        `Files: ${stats.fileCount}`,
        `Subfolders: ${stats.directoryCount}`,
        `Last modified: ${formatModified(stats.latestModified)}`,
      ].join('\n'),
    )
  } catch (err) {
    console.error('[showFolderInfo] failed:', err)
  }
}

function removeNodeById(nodes: TreeNode[], id: string): boolean {
  const idx = nodes.findIndex((n) => n.id === id)
  if (idx !== -1) {
    nodes.splice(idx, 1)
    return true
  }

  for (const n of nodes) {
    if (n.children && removeNodeById(n.children as TreeNode[], id)) {
      return true
    }
  }

  return false
}
</script>

<style scoped>
.highlighted-leaf {
  background: var(--q-secondary);
  color: white;
  border-radius: 4px;
}
</style>
