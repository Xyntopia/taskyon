<template>
  <div class="documentation-page fit row no-wrap">
    <aside class="documentation-page__sidebar column">
      <div class="documentation-page__sidebar-header">
        <div class="text-subtitle1">{{ title }}</div>
        <q-input
          v-model="filterText"
          dense
          outlined
          clearable
          placeholder="Filter docs"
          class="q-mt-sm"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </div>

      <q-scroll-area class="col">
        <q-list dense padding>
          <q-item
            v-for="document in filteredDocuments"
            :key="document.id"
            clickable
            :active="document.id === selectedDocumentId"
            active-class="documentation-page__item--active"
            @click="selectDocument(document.id)"
          >
            <q-item-section>
              <q-item-label>{{ document.title }}</q-item-label>
              <q-item-label caption lines="1">{{ document.path }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-scroll-area>
    </aside>

    <main class="documentation-page__content column">
      <div v-if="currentDocument" class="documentation-page__content-header">
        <div class="text-h6">{{ currentDocument.title }}</div>
        <div class="text-caption text-grey-7">{{ currentDocument.path }}</div>
      </div>

      <q-separator />

      <q-scroll-area class="col">
        <div class="documentation-page__markdown">
          <q-inner-loading :showing="loading">
            <q-spinner />
          </q-inner-loading>

          <q-banner v-if="loadError" class="bg-negative text-white q-mb-md">
            {{ loadError }}
          </q-banner>
          <ty-markdown v-else-if="currentContent" :src="currentContent" no-line-numbers />
          <q-banner v-else class="bg-grey-2 text-grey-8">Select a document.</q-banner>
        </div>
      </q-scroll-area>
    </main>
  </div>
</template>

<script setup lang="ts">
import TyMarkdown from '../components/tyMarkdown.vue'
import type { DocumentationPageDocument } from '../modules/documentation'
import { computed, ref, watch } from 'vue'

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

const filterText = ref('')
const selectedDocumentId = ref('')
const loadedContentById = ref<Record<string, string>>({})
const loading = ref(false)
const loadError = ref('')

const sortedDocuments = computed(() =>
  [...props.documents].sort((left, right) => left.path.localeCompare(right.path)),
)

const filteredDocuments = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  if (!query) return sortedDocuments.value
  return sortedDocuments.value.filter((document) =>
    `${document.title} ${document.path}`.toLowerCase().includes(query),
  )
})

const currentDocument = computed(
  () =>
    sortedDocuments.value.find((document) => document.id === selectedDocumentId.value) ??
    sortedDocuments.value[0],
)

const currentContent = computed(() => {
  const document = currentDocument.value
  if (!document) return ''
  return document.content ?? loadedContentById.value[document.id] ?? ''
})

const selectDocument = (documentId: string) => {
  selectedDocumentId.value = documentId
  void loadSelectedDocument()
}

const ensureSelectedDocument = () => {
  const preferredId = props.initialDocumentId || sortedDocuments.value[0]?.id || ''
  const stillExists = sortedDocuments.value.some(
    (document) => document.id === selectedDocumentId.value,
  )
  if (!stillExists) selectedDocumentId.value = preferredId
}

const loadSelectedDocument = async () => {
  const document = currentDocument.value
  if (!document || document.content !== undefined || loadedContentById.value[document.id]) return

  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch(document.url, { cache: 'no-cache' })
    if (!response.ok) {
      throw new Error(`Failed to load ${document.path}: ${response.status}`)
    }
    loadedContentById.value = {
      ...loadedContentById.value,
      [document.id]: await response.text(),
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
    void loadSelectedDocument()
  },
  { immediate: true },
)
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

.documentation-page__content-header
  padding: 16px 24px

.documentation-page__markdown
  position: relative
  max-width: 980px
  padding: 24px

@media (max-width: 720px)
  .documentation-page
    flex-direction: column

  .documentation-page__sidebar
    width: 100%
    max-width: none
    height: 240px
    border-right: 0
</style>
