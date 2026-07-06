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
  </q-page>
</template>

<script setup lang="ts">
import { matContentCopy, matDelete, matDownload, matFolder } from '@quasar/extras/material-icons'
import { mdiFile } from '@quasar/extras/mdi-v6'
import FileDropzone from '@taskyon/ui/components/FileDropzone.vue'
import InfoDialog from '@taskyon/ui/components/InfoDialog.vue'
import type { QTreeNode } from 'quasar'
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

/** OPFS directory handle with typed .entries() (just for TS) */
type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

/** Our node extends Quasar’s, keeps TypeScript happy */
interface TreeNode extends QTreeNode {
  handle: FileSystemHandle
  kind: 'file' | 'directory'
  size?: number
  path: string
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
        label: `${name} · ${formatSize(file.size)}`,
        icon: mdiFile,
        kind: 'file',
        size: file.size,
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
  return sorted
}

/* ---------- initial root ---------- */

async function buildRoot() {
  console.log('[buildRoot] Fetching OPFS root')
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
  await buildRoot()
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
