<template>
  <div class="storage-manager column q-gutter-md">
    <q-card>
      <q-tabs v-if="showPhysical" v-model="viewMode" dense align="left">
        <q-tab name="logical" label="Logical storage" />
        <q-tab name="physical" label="Physical OPFS" />
      </q-tabs>
      <q-separator v-if="showPhysical" />

      <q-tab-panels v-model="viewMode" animated>
        <q-tab-panel name="logical" class="column q-gutter-md">
          <q-banner rounded class="bg-blue-1 text-blue-10">
            Browse objects through StorageClient. Namespace slashes are logical prefixes, not
            physical directories.
          </q-banner>
          <div class="row q-col-gutter-sm items-center">
            <q-input v-model="namespace" class="col" dense outlined label="Namespace" />
            <q-select
              v-model="objectKind"
              class="col-auto"
              dense
              outlined
              emit-value
              map-options
              :options="kindOptions"
            />
            <q-btn label="Refresh" :icon="matRefresh" @click="refreshLogical" />
            <q-btn
              v-if="objectKind === 'blob'"
              label="Upload"
              :icon="matUpload"
              @click="fileInput?.click()"
            />
            <input ref="fileInput" type="file" hidden multiple @change="uploadFiles" />
          </div>
          <q-tree
            v-if="logicalTree.length > 0"
            :nodes="logicalTree"
            node-key="path"
            default-expand-all
          >
            <template #default-header="{ node }">
              <div
                :data-storage-object-id="node.entry?.id"
                :class="[
                  'row items-center full-width q-py-xs',
                  node.entry?.id === initialObjectId ? 'bg-blue-1 text-blue-10' : '',
                ]"
              >
                <q-icon :name="node.entry ? matDescription : matFolder" />
                <div class="q-ml-sm">
                  <div>{{ node.label }}</div>
                  <div v-if="node.entry" class="text-caption text-grey-7">
                    {{ node.entry.caption }}
                  </div>
                </div>
                <q-space />
                <q-btn
                  v-if="node.entry && objectKind === 'blob'"
                  flat
                  round
                  :icon="matDownload"
                  @click.stop="downloadLogicalBlob(node.entry.id)"
                />
                <q-btn
                  v-if="node.entry"
                  flat
                  round
                  color="negative"
                  :icon="matDelete"
                  @click.stop="deleteLogical(node.entry.id)"
                />
              </div>
            </template>
          </q-tree>
          <div v-else class="text-caption">No stored objects.</div>
        </q-tab-panel>

        <q-tab-panel v-if="showPhysical" name="physical" class="column q-gutter-md">
          <q-banner rounded class="bg-orange-1 text-orange-10">
            Read-only backend diagnostics. Physical paths are private implementation details and
            cannot be modified from this view.
          </q-banner>
          <div><q-btn label="Refresh OPFS" :icon="matRefresh" @click="refreshPhysical" /></div>
          <q-tree :nodes="physicalNodes" node-key="path" default-expand-all>
            <template #default-header="{ node }">
              <div class="row items-center full-width">
                <q-icon :name="node.kind === 'directory' ? matFolder : matDescription" />
                <span class="q-ml-sm">{{ node.label }}</span>
                <q-space />
                <span v-if="node.size != null" class="text-caption text-grey-7">
                  {{ formatSize(node.size) }}
                </span>
                <q-btn
                  v-if="node.kind === 'file'"
                  flat
                  round
                  :icon="matDownload"
                  @click.stop="downloadPhysical(node)"
                />
              </div>
            </template>
          </q-tree>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import {
  matDelete,
  matDescription,
  matDownload,
  matFolder,
  matRefresh,
  matUpload,
} from '@quasar/extras/material-icons'
import type { TaskyonStorageClient } from '@taskyon/taskyon'
import { computed, onMounted, ref } from 'vue'

type LogicalEntry = { id: string; caption: string }
type LogicalNode = {
  label: string
  path: string
  entry?: LogicalEntry
  children?: LogicalNode[]
}
type PhysicalNode = {
  label: string
  path: string
  kind: 'file' | 'directory'
  size?: number
  file?: File
  children?: PhysicalNode[]
}

const {
  storageClient,
  initialNamespace = 'modelica/projects',
  initialObjectKind = 'record',
  initialObjectId = undefined,
  showPhysical = false,
} = defineProps<{
  storageClient: TaskyonStorageClient
  initialNamespace?: string
  initialObjectKind?: 'record' | 'blob'
  initialObjectId?: string | undefined
  showPhysical?: boolean
}>()

const viewMode = ref<'logical' | 'physical'>('logical')
const namespace = ref(initialNamespace)
const objectKind = ref<'record' | 'blob'>(initialObjectKind)
const kindOptions = [
  { label: 'Records', value: 'record' },
  { label: 'Blobs', value: 'blob' },
]
const logicalEntries = ref<LogicalEntry[]>([])
const physicalNodes = ref<PhysicalNode[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

const formatSize = (size: number) =>
  size >= 1_048_576
    ? `${(size / 1_048_576).toFixed(2)} MB`
    : size >= 1024
      ? `${(size / 1024).toFixed(2)} KB`
      : `${size} B`

const buildLogicalTree = (entries: readonly LogicalEntry[]) => {
  const buildNodes = (
    items: readonly { entry: LogicalEntry; segments: string[] }[],
    parentPath = '',
  ): LogicalNode[] =>
    [
      ...new Set(
        items
          .map(({ segments }) => segments[0])
          .filter((segment): segment is string => segment !== undefined),
      ),
    ]
      .map((segment) => {
        const matching = items.filter(({ segments }) => segments[0] === segment)
        const entry = matching.find(({ segments }) => segments.length === 1)?.entry
        const descendants = matching
          .filter(({ segments }) => segments.length > 1)
          .map(({ entry: descendant, segments }) => ({
            entry: descendant,
            segments: segments.slice(1),
          }))
        const path = parentPath ? `${parentPath}/${segment}` : segment
        return {
          label: segment,
          path,
          ...(entry ? { entry } : {}),
          ...(descendants.length ? { children: buildNodes(descendants, path) } : {}),
        }
      })
      .sort((left, right) => {
        const leftFolder = (left.children?.length ?? 0) > 0
        const rightFolder = (right.children?.length ?? 0) > 0
        return leftFolder === rightFolder
          ? left.label.localeCompare(right.label)
          : leftFolder
            ? -1
            : 1
      })

  return buildNodes(
    entries.map((entry) => ({ entry, segments: entry.id.split('/').filter(Boolean) })),
  )
}

const logicalTree = computed(() => buildLogicalTree(logicalEntries.value))

const refreshLogical = async () => {
  const selectedNamespace = namespace.value.trim()
  if (!selectedNamespace) return
  logicalEntries.value =
    objectKind.value === 'record'
      ? (await storageClient.list({ namespace: selectedNamespace })).rows.map((row) => ({
          id: String(row.id),
          caption: JSON.stringify(row.data).slice(0, 180),
        }))
      : (await storageClient.listBlobs({ namespace: selectedNamespace })).blobs.map((blob) => ({
          id: blob.id,
          caption: `${formatSize(blob.size)} · ${blob.contentType ?? 'application/octet-stream'}`,
        }))
}

const deleteLogical = async (id: string) => {
  if (!window.confirm(`Delete ${namespace.value}/${id}?`)) return
  if (objectKind.value === 'record') {
    await storageClient.delete({ namespace: namespace.value, id })
  } else {
    await storageClient.deleteBlob({ namespace: namespace.value, id })
  }
  await refreshLogical()
}

const download = (file: File) => {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  URL.revokeObjectURL(url)
}

const downloadLogicalBlob = async (id: string) => {
  const stored = await storageClient.getBlob({ namespace: namespace.value, id })
  if (!stored) return
  download(
    new File([stored.data], id, {
      type: stored.metadata.contentType ?? 'application/octet-stream',
    }),
  )
}

const uploadFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) {
    const id = file.name.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 180)
    await storageClient.setBlob({
      namespace: namespace.value,
      id,
      data: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || 'application/octet-stream',
    })
  }
  input.value = ''
  await refreshLogical()
}

const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
  handle.kind === 'directory' && 'entries' in handle

const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
  handle.kind === 'file' && 'getFile' in handle

const readPhysicalDirectory = async (
  directory: FileSystemDirectoryHandle,
  parent = '',
): Promise<PhysicalNode[]> => {
  const nodes: PhysicalNode[] = []
  for await (const [name, handle] of directory.entries()) {
    const path = parent ? `${parent}/${name}` : name
    if (isDirectoryHandle(handle)) {
      nodes.push({
        label: name,
        path,
        kind: 'directory',
        children: await readPhysicalDirectory(handle, path),
      })
    } else if (isFileHandle(handle)) {
      const file = await handle.getFile()
      nodes.push({ label: name, path, kind: 'file', size: file.size, file })
    }
  }
  return nodes.sort((left, right) =>
    left.kind === right.kind
      ? left.label.localeCompare(right.label)
      : left.kind === 'directory'
        ? -1
        : 1,
  )
}

const refreshPhysical = async () => {
  physicalNodes.value = await readPhysicalDirectory(await navigator.storage.getDirectory())
}

const downloadPhysical = (node: PhysicalNode) => {
  if (node.file) download(node.file)
}

onMounted(refreshLogical)
</script>

<style scoped>
.storage-manager {
  min-width: 0;
  min-height: 0;
}
</style>
