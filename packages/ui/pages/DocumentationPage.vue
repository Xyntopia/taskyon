<template>
  <div class="documentation-page fit row no-wrap">
    <aside class="documentation-page__sidebar column">
      <div class="documentation-page__sidebar-header">
        <slot name="sidebar-header" />
        <div class="text-subtitle1">{{ title }}</div>
        <q-input
          v-model="filterText"
          dense
          outlined
          clearable
          placeholder="Filter docs"
          class="q-mt-sm"
          :error="Boolean(filterError)"
          :error-message="filterError"
        >
          <template #prepend>
            <q-icon :name="matSearch" />
          </template>
          <template #append>
            <q-btn
              flat
              round
              dense
              :color="filterMode === 'regex' ? 'secondary' : undefined"
              :icon="mdiRegex"
              @click="filterMode = filterMode === 'literal' ? 'regex' : 'literal'"
            >
              <q-tooltip>Use regular expression</q-tooltip>
            </q-btn>
          </template>
        </q-input>
      </div>

      <div ref="sidebarScrollContainer" class="col overflow-auto">
        <q-list dense padding>
          <q-item
            v-for="node in visibleTreeNodes"
            :key="node.key"
            clickable
            :class="[
              node.kind === 'folder' ? 'documentation-page__folder' : 'documentation-page__item',
            ]"
            :style="{
              paddingLeft: `${12 + node.depth * 18 + (node.kind === 'document' ? 28 : 0)}px`,
            }"
            :data-document-id="node.kind === 'document' ? node.document.id : undefined"
            :active="node.kind === 'document' && node.document.id === selectedDocumentId"
            active-class="documentation-page__item--active"
            @click="selectTreeNode(node)"
          >
            <q-item-section
              v-if="node.kind === 'folder'"
              avatar
              class="documentation-page__tree-icon"
            >
              <q-icon :name="isFolderExpanded(node) ? matExpandMore : matChevronRight" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ node.label }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </aside>

    <main class="documentation-page__content column">
      <div class="col overflow-auto">
        <div class="documentation-page__markdown">
          <q-inner-loading :showing="loading">
            <q-spinner />
          </q-inner-loading>

          <q-banner v-if="loadError" class="bg-negative text-white q-mb-md">
            {{ loadError }}
          </q-banner>
          <slot
            v-else-if="currentDocument"
            name="document"
            :document="currentDocument"
            :content="currentContent"
          >
            <ty-markdown v-if="currentContent" :src="currentContent" no-line-numbers />
          </slot>
          <q-banner v-else-if="missingDocument" class="bg-negative text-white">
            Documentation page not found: {{ props.initialDocumentId }}.
          </q-banner>
          <q-banner v-else class="bg-grey-2 text-grey-8">Select a document.</q-banner>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { matChevronRight, matExpandMore, matSearch } from '@quasar/extras/material-icons'
import { mdiRegex } from '@quasar/extras/mdi-v6'
import TyMarkdown from '../components/tyMarkdown.vue'
import {
  compareDocumentationPaths,
  documentationLabelFromPathSegment,
  parseDocumentationMarkdown,
  searchDocumentation,
  type DocumentationPageDocument,
} from '../modules/documentation'
import { computed, nextTick, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    documents: readonly DocumentationPageDocument[]
    initialDocumentId?: string
    title?: string
  }>(),
  {
    title: 'Documentation',
    initialDocumentId: '',
  },
)

const emit = defineEmits<{
  select: [documentId: string]
}>()

type FolderTreeNode = {
  kind: 'folder'
  key: string
  label: string
  depth: number
  order: number
  children: TreeNode[]
}

type DocumentTreeNode = {
  kind: 'document'
  key: string
  label: string
  depth: number
  order: number
  document: DocumentationPageDocument
}

type TreeNode = FolderTreeNode | DocumentTreeNode

type MutableFolder = {
  key: string
  segment: string
  label: string
  depth: number
  order: number
  folders: Map<string, MutableFolder>
  documents: DocumentationPageDocument[]
}

const filterText = ref<string | null>('')
const filterMode = ref<'literal' | 'regex'>('literal')
const selectedDocumentId = ref('')
const loadedContentById = ref<Record<string, string>>({})
const loading = ref(false)
const loadError = ref('')
const sidebarScrollContainer = ref<HTMLElement | null>(null)
const expandedFolders = ref<Record<string, boolean>>({})

const orderedDocuments = computed(() => [...props.documents])

const documentOrder = computed(
  () => new Map(props.documents.map((document, index) => [document.id, index])),
)

const normalizedFilter = computed(() => (filterText.value ?? '').trim().toLowerCase())

const documentationSearch = computed(() => {
  if (!normalizedFilter.value) return { ids: new Set<string>(), error: '' }
  try {
    const hits = searchDocumentation(
      props.documents.map((document) => ({ ...document, content: document.content ?? '' })),
      {
        query: filterText.value?.trim() ?? '',
        mode: filterMode.value,
        limit: Number.MAX_SAFE_INTEGER,
      },
    )
    return { ids: new Set(hits.map((hit) => hit.documentId)), error: '' }
  } catch (error) {
    return {
      ids: new Set<string>(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

const filterError = computed(() => documentationSearch.value.error)

const filteredDocuments = computed(() => {
  const query = normalizedFilter.value
  if (!query) return orderedDocuments.value
  return orderedDocuments.value.filter(
    (document) =>
      document.id === selectedDocumentId.value || documentationSearch.value.ids.has(document.id),
  )
})

const currentDocument = computed(() =>
  orderedDocuments.value.find((document) => document.id === selectedDocumentId.value),
)

const missingDocument = computed(
  () =>
    orderedDocuments.value.length > 0 &&
    Boolean(props.initialDocumentId) &&
    !orderedDocuments.value.some((document) => document.id === props.initialDocumentId),
)

const documentFolderSegments = (document: DocumentationPageDocument) =>
  document.chapters.length > 0
    ? document.chapters.map((chapter) => ({ key: chapter, label: chapter }))
    : document.path
        .split('/')
        .filter(Boolean)
        .slice(0, -1)
        .map((segment) => ({ key: segment, label: documentationLabelFromPathSegment(segment) }))

const selectedFolderKeys = computed(() => {
  const segments = currentDocument.value ? documentFolderSegments(currentDocument.value) : []
  return new Set(
    segments.map((_, index) =>
      segments
        .slice(0, index + 1)
        .map((segment) => segment.key)
        .join('/'),
    ),
  )
})

const sortFolder = (folder: MutableFolder): TreeNode[] =>
  [
    ...[...folder.folders.values()].map(
      (child): FolderTreeNode => ({
        kind: 'folder',
        key: child.key,
        label: child.label,
        depth: child.depth,
        order: child.order,
        children: sortFolder(child),
      }),
    ),
    ...folder.documents.map(
      (document): DocumentTreeNode => ({
        kind: 'document',
        key: `document:${document.id}`,
        label: document.title,
        depth: documentFolderSegments(document).length,
        order: documentOrder.value.get(document.id) ?? Number.MAX_SAFE_INTEGER,
        document,
      }),
    ),
  ].sort(
    (left, right) =>
      left.order - right.order ||
      (left.kind === 'document' && right.kind === 'document'
        ? compareDocumentationPaths(left.document.path, right.document.path)
        : left.key.localeCompare(right.key, undefined, { numeric: true })),
  )

const documentTree = computed(() => {
  const root: MutableFolder = {
    key: '',
    segment: '',
    label: '',
    depth: -1,
    order: -1,
    folders: new Map(),
    documents: [],
  }

  for (const document of filteredDocuments.value) {
    const order = documentOrder.value.get(document.id) ?? Number.MAX_SAFE_INTEGER
    const segments = documentFolderSegments(document)
    let folder = root
    for (const [index, segment] of segments.entries()) {
      const key = segments
        .slice(0, index + 1)
        .map((part) => part.key)
        .join('/')
      const child = folder.folders.get(segment.key) ?? {
        key,
        segment: segment.key,
        label: segment.label,
        depth: index,
        order,
        folders: new Map(),
        documents: [],
      }
      child.order = Math.min(child.order, order)
      folder.folders.set(segment.key, child)
      folder = child
    }
    folder.documents.push(document)
  }

  return sortFolder(root)
})

const isFolderExpanded = (folder: FolderTreeNode) =>
  normalizedFilter.value !== '' || (expandedFolders.value[folder.key] ?? folder.depth === 0)

const flattenTree = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) =>
    node.kind === 'folder' && isFolderExpanded(node)
      ? [node, ...flattenTree(node.children)]
      : [node],
  )

const visibleTreeNodes = computed(() => flattenTree(documentTree.value))

const currentContent = computed(() => {
  const document = currentDocument.value
  if (!document) return ''
  return document.content ?? loadedContentById.value[document.id] ?? ''
})

const selectDocument = (documentId: string) => {
  selectedDocumentId.value = documentId
  emit('select', documentId)
  void loadSelectedDocument()
}

const selectTreeNode = (node: TreeNode) => {
  if (node.kind === 'document') {
    selectDocument(node.document.id)
    return
  }
  expandedFolders.value = {
    ...expandedFolders.value,
    [node.key]: !isFolderExpanded(node),
  }
}

const expandSelectedDocumentFolders = () => {
  expandedFolders.value = {
    ...expandedFolders.value,
    ...Object.fromEntries([...selectedFolderKeys.value].map((key) => [key, true])),
  }
}

const scrollSelectedDocumentIntoView = async () => {
  if (!selectedDocumentId.value) return
  await nextTick()

  const scrollTarget = sidebarScrollContainer.value
  if (!scrollTarget) return
  const selectedItem = Array.from(
    scrollTarget.querySelectorAll<HTMLElement>('[data-document-id]'),
  ).find((item) => item.dataset.documentId === selectedDocumentId.value)
  if (!selectedItem) return

  const inset = 8
  const targetBounds = scrollTarget.getBoundingClientRect()
  const itemBounds = selectedItem.getBoundingClientRect()
  const delta =
    itemBounds.top < targetBounds.top + inset
      ? itemBounds.top - targetBounds.top - inset
      : itemBounds.bottom > targetBounds.bottom - inset
        ? itemBounds.bottom - targetBounds.bottom + inset
        : 0
  if (delta !== 0) scrollTarget.scrollTop = Math.max(0, scrollTarget.scrollTop + delta)
}

const ensureSelectedDocument = () => {
  if (props.initialDocumentId) {
    selectedDocumentId.value = props.initialDocumentId
    return
  }
  if (!orderedDocuments.value.some((document) => document.id === selectedDocumentId.value)) {
    selectedDocumentId.value = orderedDocuments.value[0]?.id || ''
  }
}

const loadSelectedDocument = async () => {
  const document = currentDocument.value
  if (!document || document.content !== undefined || loadedContentById.value[document.id]) return

  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch(document.url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Failed to load ${document.path}: ${response.status}`)
    const parsed = parseDocumentationMarkdown(await response.text(), document.path)
    loadedContentById.value = {
      ...loadedContentById.value,
      [document.id]: parsed.content,
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load documentation.'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.initialDocumentId, props.documents.map((document) => document.id).join('\n')],
  () => {
    ensureSelectedDocument()
    expandSelectedDocumentFolders()
    void loadSelectedDocument()
  },
  { immediate: true },
)

watch([selectedDocumentId, filterText], () => void scrollSelectedDocumentIntoView(), {
  flush: 'post',
})
</script>

<style scoped lang="sass">
.documentation-page
  min-height: 0

.documentation-page__sidebar
  width: 300px
  min-width: 240px
  max-width: 34vw

.documentation-page__sidebar-header
  padding: 16px

.documentation-page__content
  flex: 1
  min-width: 0
  background-color: var(--background-color, white)

.documentation-page__markdown
  position: relative
  max-width: 980px
  padding: 24px

.documentation-page__tree-icon
  min-width: 28px

@media (max-width: 720px)
  .documentation-page
    flex-direction: column

  .documentation-page__sidebar
    width: 100%
    max-width: none
    height: 240px
    border-right: 0
</style>
