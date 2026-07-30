<template>
  <q-page padding class="column q-gutter-md">
    <q-card>
      <q-tabs v-model="viewMode" dense align="left">
        <q-tab name="logical" label="Logical storage" />
        <q-tab name="physical" label="Physical OPFS" />
      </q-tabs>
      <q-separator />

      <q-tab-panels v-model="viewMode" animated>
        <q-tab-panel name="logical" class="column q-gutter-md">
          <q-banner rounded class="bg-blue-1 text-blue-10">
            Browse Taskyon objects through StorageClient. Namespace slashes are logical prefixes,
            not physical directories.
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
          <q-list bordered separator>
            <q-item v-for="entry in logicalEntries" :key="entry.id">
              <q-item-section>
                <q-item-label>{{ entry.id }}</q-item-label>
                <q-item-label caption>{{ entry.caption }}</q-item-label>
              </q-item-section>
              <q-item-section side class="row no-wrap">
                <q-btn
                  v-if="objectKind === 'blob'"
                  flat
                  round
                  :icon="matDownload"
                  @click="downloadLogicalBlob(entry.id)"
                />
                <q-btn
                  flat
                  round
                  color="negative"
                  :icon="matDelete"
                  @click="deleteLogical(entry.id)"
                />
              </q-item-section>
            </q-item>
            <q-item v-if="logicalEntries.length === 0">
              <q-item-section
                ><q-item-label caption>No stored objects.</q-item-label></q-item-section
              >
            </q-item>
          </q-list>
        </q-tab-panel>

        <q-tab-panel name="physical" class="column q-gutter-md">
          <q-banner rounded class="bg-orange-1 text-orange-10">
            Read-only backend diagnostics. Physical paths are private implementation details and
            cannot be modified from this view.
          </q-banner>
          <div>
            <q-btn label="Refresh OPFS" :icon="matRefresh" @click="refreshPhysical" />
          </div>
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
  </q-page>
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
import { useTaskyonStore } from 'src/stores/taskyonState'
import { onMounted, ref } from 'vue'

type LogicalEntry = { id: string; caption: string }
type PhysicalNode = {
  label: string
  path: string
  kind: 'file' | 'directory'
  size?: number
  file?: File
  children?: PhysicalNode[]
}

defineProps<{ initialPath?: string | string[] }>()

const taskyon = useTaskyonStore()
const viewMode = ref<'logical' | 'physical'>('logical')
const namespace = ref('modelica/projects')
const objectKind = ref<'record' | 'blob'>('record')
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

const refreshLogical = async () => {
  const selectedNamespace = namespace.value.trim()
  if (!selectedNamespace) return
  logicalEntries.value =
    objectKind.value === 'record'
      ? (await taskyon.storageClient.list({ namespace: selectedNamespace })).rows.map((row) => ({
          id: String(row.id),
          caption: JSON.stringify(row.data).slice(0, 180),
        }))
      : (await taskyon.storageClient.listBlobs({ namespace: selectedNamespace })).blobs.map(
          (blob) => ({
            id: blob.id,
            caption: `${formatSize(blob.size)} · ${blob.contentType ?? 'application/octet-stream'}`,
          }),
        )
}

const deleteLogical = async (id: string) => {
  if (!window.confirm(`Delete ${namespace.value}/${id}?`)) return
  if (objectKind.value === 'record') {
    await taskyon.storageClient.delete({ namespace: namespace.value, id })
  } else {
    await taskyon.storageClient.deleteBlob({ namespace: namespace.value, id })
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
  const stored = await taskyon.storageClient.getBlob({ namespace: namespace.value, id })
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
    await taskyon.storageClient.setBlob({
      namespace: namespace.value,
      id,
      data: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || 'application/octet-stream',
    })
  }
  input.value = ''
  await refreshLogical()
}

const readPhysicalDirectory = async (
  directory: FileSystemDirectoryHandle,
  parent = '',
): Promise<PhysicalNode[]> => {
  const nodes: PhysicalNode[] = []
  for await (const [name, handle] of directory.entries()) {
    const path = parent ? `${parent}/${name}` : name
    if (handle.kind === 'directory') {
      nodes.push({
        label: name,
        path,
        kind: 'directory',
        children: await readPhysicalDirectory(handle, path),
      })
    } else {
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
