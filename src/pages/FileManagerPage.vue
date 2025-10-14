<!-- FileManagerPage.vue – DEBUG INSTRUMENTED -->
<template>
  <q-page padding>
    <FileDropzone class="q-mb-md" enable-paste @add-files="addFiles" />

    <q-card>
      <q-card-section>
        <div class="text-h6">
          Taskyon File Browser
          <InfoDialog
            info-text="This browser shows all files that taskyon saved in its [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) file system and can interact with!"
          />
        </div>
      </q-card-section>
      <q-separator />

      <q-card-section>
        <q-tree :nodes="treeData" node-key="id" accordion dense @lazy-load="handleLazyLoad">
          <template #default-header="{ node }">
            <div class="row items-center no-wrap cursor-pointer" @click="onNodeClick(node)">
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
            </div>
          </template>
        </q-tree>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { uid } from 'quasar'
import FileDropzone from 'src/components/FileDropzone.vue'
import type { QTreeNode } from 'quasar'
import { matDownload, matFolder } from '@quasar/extras/material-icons'
import { mdiFile } from '@quasar/extras/mdi-v6'
import InfoDialog from 'src/components/InfoDialog.vue'

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
}

/* ---------- state ---------- */

const treeData = ref<TreeNode[]>([])

/* ---------- directory → nodes ---------- */

async function dirHandleToNodes(dir: DirHandle): Promise<TreeNode[]> {
  console.log('[dirHandleToNodes] Reading directory', dir)
  const out: TreeNode[] = []
  for await (const [name, handle] of dir.entries()) {
    console.log('  ├─ found', name, 'kind=', handle.kind)
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      out.push({
        id: uid(),
        label: `${name} · ${formatSize(file.size)}`,
        icon: mdiFile,
        kind: 'file',
        size: file.size,
        handle,
      })
    } else {
      out.push({
        id: uid(),
        label: name,
        icon: matFolder,
        kind: 'directory',
        handle,
        lazy: true, // let QTree know it should invoke @lazy-load
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
  const root: DirHandle = await navigator.storage.getDirectory()
  treeData.value = await dirHandleToNodes(root)
  /* Force refresh in case Quasar cached the array reference */
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
      const children = await dirHandleToNodes(node.handle as DirHandle)

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

/* ---------- uploads ---------- */

async function addFiles(files: File[]) {
  const root: DirHandle = await navigator.storage.getDirectory()
  console.log('[addFiles] Adding', files.length, 'file(s) to root')
  for (const f of files) {
    const h = await root.getFileHandle(f.name, { create: true })
    const w = await h.createWritable()
    await f.stream().pipeTo(w)
    console.log('  └─ Added', f.name)
  }
  await buildRoot()
}

/* ---------- bootstrap ---------- */

onMounted(buildRoot)
</script>
