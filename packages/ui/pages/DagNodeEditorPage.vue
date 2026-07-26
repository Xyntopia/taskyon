<template>
  <q-page class="q-pa-md column q-gutter-md">
    <div class="row items-center q-gutter-sm">
      <div class="text-h5">DAG Record Nodes</div>
      <q-space />
      <q-btn outline icon="refresh" label="Refresh" @click="refreshFiles" />
      <q-btn color="primary" icon="add" label="New" @click="createDraft" />
    </div>

    <div class="row q-col-gutter-md node-editor-body">
      <div class="col-12 col-md-3">
        <q-list bordered separator>
          <q-item-label header>Stored record nodes</q-item-label>
          <q-item
            v-for="file in files"
            :key="file.path"
            clickable
            :active="file.path === selectedPath"
            @click="selectFile(file.path)"
          >
            <q-item-section>
              <q-item-label>{{ file.label }}</q-item-label>
              <q-item-label caption>{{ file.path }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <div class="col-12 col-md-9">
        <q-card flat bordered>
          <q-card-section class="column q-gutter-md">
            <q-input v-model="directory" dense outlined label="Record node directory" />
            <DagNodeViewer
              v-model="source"
              :label="selectedLabel"
              :path="selectedPath ?? directory"
              :hash="normalizedHash ?? undefined"
              :read-only="false"
              :input-schema="viewerInputSchema"
              :output-schema="validatedNode?.outputSchema"
              :upstream-nodes="upstreamNodes"
              :downstream-nodes="downstreamNodes"
              show-navigation
              class="node-viewer"
              @select-node="selectLoadedNode"
            />
          </q-card-section>

          <q-separator />

          <q-card-actions align="right">
            <q-btn
              v-if="selectedPath"
              flat
              color="negative"
              icon="delete"
              label="Delete"
              @click="deleteSelected"
            />
            <q-btn outline icon="check" label="Validate" @click="validateSource" />
            <q-btn color="primary" icon="save" label="Normalize & Save" @click="saveSource" />
          </q-card-actions>
        </q-card>

        <q-card v-if="status" flat bordered class="q-mt-md">
          <q-card-section>
            <pre class="node-status">{{ status }}</pre>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { deleteFile, listFiles, openFile, writeFile } from '@taskyon/comp-dag/opfsStorage'
import {
  loadStoredGraphNodeFile,
  normalizeStoredGraphNodeSource,
  saveStoredGraphNodeSource,
  type SavedStoredGraphNode,
  type StoredDagNodeDefinition,
} from '@taskyon/comp-dag/dagNodeLoader'
import {
  getDagNodeRecordInputSchema,
  getDagNodeRecordRelations,
  savedStoredNodesToRecordGraph,
} from '@taskyon/comp-dag/dagNodeGraph'
import { SELF_HASH_PLACEHOLDER } from '@taskyon/comp-dag/dagNodeIdentity'
import type { Hash } from '@taskyon/comp-dag/caching'
import { objectSchema, type DagJsonSchema } from '@taskyon/comp-dag/dagSchema'
import { computed, onMounted, ref } from 'vue'
import DagNodeViewer from '../components/DagNodeViewer.vue'

type RecordNodeFile = {
  path: string
  label: string
}

const defaultSource = `export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'example_record_node',
  label: 'Example Record Node',
  version: 1,
  localParamsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      input: {
        type: 'object',
        additionalProperties: true,
        default: {},
      },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  inputs: {},
  run: ({ params }: { params: Record<string, unknown> }) => ({
    value: params.input ?? {},
  }),
}
`

const directory = ref('dag-record-nodes')
const files = ref<RecordNodeFile[]>([])
const selectedPath = ref<string | null>(null)
const source = ref(defaultSource)
const status = ref<string | null>(null)
const normalizedHash = ref<Hash | null>(null)
const validatedNode = ref<StoredDagNodeDefinition | null>(null)
const storedNodes = ref<Record<Hash, SavedStoredGraphNode>>({})

const selectedLabel = computed(() => {
  if (!selectedPath.value) return 'New record node'
  return files.value.find((file) => file.path === selectedPath.value)?.label ?? selectedPath.value
})

const nodePath = (fileName: string): string => `${directory.value.replace(/\/+$/, '')}/${fileName}`

const fileLabel = (fileName: string): string => fileName.replace(/\.sha256_[A-Za-z0-9_-]+\.ts$/, '')

const setStatus = (message: string, data?: unknown) => {
  status.value = data === undefined ? message : `${message}\n${JSON.stringify(data, null, 2)}`
}

const loadListedNodes = async () => {
  const loaded = await Promise.all(
    files.value.map(async (file) => {
      try {
        return await loadStoredGraphNodeFile({
          path: file.path,
          source: await (await openFile(file.path)).text(),
        })
      } catch {
        return null
      }
    }),
  )
  const nodes: Record<Hash, SavedStoredGraphNode> = {}
  for (const item of loaded) {
    if (item) nodes[item.hash] = item
  }
  storedNodes.value = nodes
}

const refreshFiles = async () => {
  try {
    const names = await listFiles(directory.value)
    files.value = names
      .filter((name) => name.endsWith('.ts'))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ path: nodePath(name), label: fileLabel(name) }))
    await loadListedNodes()
    setStatus(`Loaded ${files.value.length} record node file(s).`)
  } catch (error) {
    files.value = []
    storedNodes.value = {}
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

const createDraft = () => {
  selectedPath.value = null
  source.value = defaultSource
  normalizedHash.value = null
  validatedNode.value = null
  status.value = null
}

const selectFile = async (path: string) => {
  selectedPath.value = path
  normalizedHash.value = null
  try {
    source.value = await (await openFile(path)).text()
    await validateSource()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

const validateSource = async () => {
  try {
    const normalized = await normalizeStoredGraphNodeSource(source.value)
    validatedNode.value = normalized.node
    normalizedHash.value = normalized.node.id === SELF_HASH_PLACEHOLDER ? null : normalized.node.id
    setStatus('Record node source is valid.', {
      id: normalized.node.id,
      localName: normalized.node.localName,
      label: normalized.node.label,
      version: normalized.node.version,
    })
  } catch (error) {
    validatedNode.value = null
    normalizedHash.value = null
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

const storedGraph = computed(() => savedStoredNodesToRecordGraph(storedNodes.value))
const fallbackInputSchema = computed<DagJsonSchema | undefined>(() => {
  const current = validatedNode.value
  if (!current) return undefined
  const properties: Record<string, DagJsonSchema> = { params: current.localParamsSchema }
  for (const alias of Object.keys(current.inputs ?? {})) properties[alias] = {}
  return objectSchema({ properties, required: Object.keys(properties) })
})
const viewerInputSchema = computed(() => {
  const hash = normalizedHash.value
  return hash && storedGraph.value[hash]
    ? getDagNodeRecordInputSchema(storedGraph.value, hash)
    : fallbackInputSchema.value
})
const navigationItems = computed(() => {
  const hash = normalizedHash.value
  if (!hash || !storedGraph.value[hash]) return { upstream: [], downstream: [] }
  const relations = getDagNodeRecordRelations(storedGraph.value, hash)
  const item = (relatedHash: Hash) => {
    const related = storedNodes.value[relatedHash]
    return {
      id: relatedHash,
      label: related?.node.label ?? relatedHash,
      ...(related ? { caption: related.node.localName } : {}),
    }
  }
  return {
    upstream: relations.upstream.map(item),
    downstream: relations.downstream.map(item),
  }
})
const upstreamNodes = computed(() => navigationItems.value.upstream)
const downstreamNodes = computed(() => navigationItems.value.downstream)
const selectLoadedNode = (hash: string) => {
  const selected = Object.entries(storedNodes.value).find(([candidate]) => candidate === hash)?.[1]
  if (selected) void selectFile(selected.file.path)
}

const saveSource = async () => {
  try {
    const saved = await saveStoredGraphNodeSource(source.value, { directory: directory.value })
    if (selectedPath.value && selectedPath.value !== saved.file.path) {
      await deleteFile(selectedPath.value)
    }
    await writeFile(
      saved.file.path,
      new File([saved.file.source], saved.file.path.split('/').at(-1) ?? 'node.ts', {
        type: 'text/typescript',
      }),
    )
    selectedPath.value = saved.file.path
    source.value = saved.file.source
    normalizedHash.value = saved.hash
    await refreshFiles()
    setStatus('Record node normalized and saved.', {
      path: saved.file.path,
      hash: saved.hash,
      localName: saved.node.localName,
    })
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

const deleteSelected = async () => {
  if (!selectedPath.value) return
  try {
    await deleteFile(selectedPath.value)
    createDraft()
    await refreshFiles()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

onMounted(refreshFiles)
</script>

<style scoped>
.node-editor-body {
  min-height: 0;
}

.node-viewer {
  min-height: 460px;
  border: 1px solid rgba(127, 127, 127, 0.35);
}

.node-status {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
