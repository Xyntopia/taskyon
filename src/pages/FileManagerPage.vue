<!-- FileManagerPage.vue – DEBUG INSTRUMENTED -->
<template>
  <q-layout>
    <q-page-container>
      <q-page padding>
        <FileDropzone class="q-mb-md" enable-paste @add-files="addFiles" />

        <q-card>
          <q-card-section>
            <div class="text-h6">
              Taskyon OPFS Browser <span class="text-caption text-grey">(debug build)</span>
            </div>
          </q-card-section>
          <q-separator />

          <q-card-section>
            <q-tree
              :nodes="treeData"
              node-key="id"
              accordion
              dense
              selected-color="primary"
              @lazy-load="handleLazyLoad"
              @update:selected="onSelect"
            />
          </q-card-section>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { uid } from 'quasar'
import FileDropzone from 'src/components/FileDropzone.vue'
import type { QTreeNode } from 'quasar'
import { matFolder } from '@quasar/extras/material-icons'
import { mdiFile } from '@quasar/extras/mdi-v6'

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

async function onSelect(ids: string[]) {
  const id = ids[0]
  if (!id) return
  console.log('[onSelect] Clicked node id=', id)

  // depth-first search for the clicked node
  const stack: TreeNode[] = [...treeData.value]
  while (stack.length) {
    const n = stack.pop()!
    if (n.id === id) {
      console.log('  ├─ Node found:', n)
      if (n.kind === 'file') {
        const file = await (n.handle as FileSystemFileHandle).getFile()
        console.log(`▼ FILE CONTENT (${n.label}) ▼\n${await file.text()}\n▲ END FILE ▲`)
      }
      break
    }
    if (n.children) stack.push(...(n.children as TreeNode[]))
  }
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
