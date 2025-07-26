<template>
  <q-layout>
    <q-page-container>
      <q-page padding>
        <FileDropzone class="q-mb-md" enable-paste @add-files="addFiles" />

        <q-card>
          <q-card-section>
            <div class="text-h6">Taskyon OPFS Browser</div>
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
import { ref, onMounted } from 'vue'
import { uid } from 'quasar'
import FileDropzone from 'src/components/FileDropzone.vue'
import type { QTreeNode } from 'quasar'
import { matFolder } from '@quasar/extras/material-icons'
import { mdiFile } from '@quasar/extras/mdi-v6'

/** Helper for browsers that haven’t shipped full typing for .entries() */
type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

/** Our node extends Quasar’s, keeps TypeScript happy */
interface TreeNode extends QTreeNode {
  /** Quasar’s QTreeNode already has id/label/icon/children */
  handle: FileSystemHandle
  kind: 'file' | 'directory'
  size?: number // for files
}

const treeData = ref<TreeNode[]>([]) // QTreeNode compatible

function formatSize(s?: number) {
  if (s == null) return ''
  if (s >= 1_048_576) return `${(s / 1_048_576).toFixed(2)} MB`
  if (s >= 1_024) return `${(s / 1_024).toFixed(2)} KB`
  return `${s} B`
}

// ---------- directory → nodes ----------
async function dirHandleToNodes(dir: DirHandle): Promise<TreeNode[]> {
  const out: TreeNode[] = []
  for await (const [name, handle] of dir.entries()) {
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
        lazy: true, // omit `children` → optional stays absent
      })
    }
  }
  return out.sort((a, b) =>
    a.kind === b.kind
      ? (a.label ?? '').localeCompare(b.label ?? '')
      : a.kind === 'directory'
        ? -1
        : 1,
  )
}

// ---------- initial root ----------
async function buildRoot() {
  const root: DirHandle = await navigator.storage.getDirectory()
  treeData.value = await dirHandleToNodes(root)
}

// ---------- lazy loader (adapter to Quasar signature) ----------
/* Quasar emits { node, key, done, fail }.  Cast `children` so
   the callback sees the plain QTreeNode[] it expects. */
async function handleLazyLoad({
  node,
  done,
}: {
  node: TreeNode
  key: string
  done: (c?: QTreeNode[]) => void
}) {
  if (node.kind === 'directory' && node.children === undefined) {
    const children = await dirHandleToNodes(node.handle as DirHandle)
    node.children = children
    done(children as QTreeNode[]) // cast → type matches Quasar
  } else {
    done((node.children ?? []) as QTreeNode[])
  }
}

// ---------- click selection ----------
async function onSelect(ids: string[]) {
  const id = ids[0]
  if (!id) return
  // depth-first search for clicked node
  const stack: TreeNode[] = [...treeData.value]
  while (stack.length) {
    const n = stack.pop()!
    if (n.id === id) {
      if (n.kind === 'file') {
        const file = await (n.handle as FileSystemFileHandle).getFile()
        console.log(`▼ ${n.label}\n${await file.text()}`)
      }
      break
    }
    if (n.children) stack.push(...(n.children as TreeNode[]))
  }
}

// ---------- uploads ----------
async function addFiles(list: File[]) {
  const root: DirHandle = await navigator.storage.getDirectory()
  for (const f of list) {
    const h = await root.getFileHandle(f.name, { create: true })
    const w = await h.createWritable()
    await f.stream().pipeTo(w)
  }
  await buildRoot()
}

onMounted(buildRoot)
</script>
