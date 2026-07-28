<template>
  <section class="documentation-base-page col column relative-position">
    <q-banner v-if="loadError" class="bg-negative text-white q-ma-md">
      {{ loadError }}
    </q-banner>
    <DocumentationPage
      :documents="documents"
      :initial-document-id="initialDocumentId"
      :title="title"
      class="col"
      @select="emit('select', $event)"
    >
      <template v-if="showBaseControls" #sidebar-header>
        <div class="row items-center no-wrap q-gutter-xs q-mb-sm">
          <q-select
            :model-value="baseId"
            :options="baseOptions"
            emit-value
            map-options
            dense
            outlined
            options-dense
            class="col"
            aria-label="Documentation base"
            @update:model-value="emit('select-base', String($event))"
          />
          <q-btn flat round dense :icon="matUploadFile" @click="manifestPicker?.click()">
            <q-tooltip>Import documentation manifest</q-tooltip>
          </q-btn>
          <q-btn flat round dense :icon="matDownload" @click="downloadManifest">
            <q-tooltip>Download documentation manifest</q-tooltip>
          </q-btn>
          <input
            ref="manifestPicker"
            type="file"
            accept="application/json,.json"
            hidden
            @change="importManifest"
          />
        </div>
      </template>
    </DocumentationPage>
    <q-inner-loading
      :showing="buildingDocumentation"
      :label="loadingLabel"
      label-class="text-body1 text-secondary"
      color="secondary"
      size="44px"
    />
  </section>
</template>

<script setup lang="ts">
import { matDownload, matUploadFile } from '@quasar/extras/material-icons'
import type { DocumentationBaseStore } from '@taskyon/common/modules/documentationBases'
import { parseDocumentationManifest } from '@taskyon/common/modules/resourceFiles'
import { resolveDocumentationDocumentId } from '@taskyon/ui/modules/documentation'
import { computed, ref, watch } from 'vue'
import DocumentationPage from './DocumentationPage.vue'

const props = withDefaults(
  defineProps<{
    bases: DocumentationBaseStore | undefined
    baseId: string
    requestedDocumentPath?: string
    title?: string
    loadingLabel?: string
    showBaseControls?: boolean
    prepareBase?: ((baseId: string) => Promise<void>) | null
  }>(),
  {
    requestedDocumentPath: '',
    title: 'Documentation',
    loadingLabel: 'Building documentation...',
    showBaseControls: true,
    prepareBase: null,
  },
)

const emit = defineEmits<{
  select: [documentId: string]
  canonicalize: [documentId: string]
  'select-base': [baseId: string]
  registered: [url: string]
}>()

const documents = ref<Awaited<ReturnType<DocumentationBaseStore['load']>>>([])
const baseIds = ref<string[]>([])
const manifestPicker = ref<HTMLInputElement>()
const buildingDocumentation = ref(true)
const loadError = ref('')

const baseOptions = computed(() => baseIds.value.map((id) => ({ label: id, value: id })))
const initialDocumentId = computed(() => {
  if (props.requestedDocumentPath) {
    return (
      resolveDocumentationDocumentId(documents.value, props.requestedDocumentPath) ??
      props.requestedDocumentPath
    )
  }
  return documents.value[0]?.id ?? ''
})

const loadBase = async () => {
  if (!props.bases) {
    documents.value = []
    buildingDocumentation.value = true
    return
  }

  buildingDocumentation.value = true
  loadError.value = ''
  try {
    await props.prepareBase?.(props.baseId)
    documents.value = await props.bases.load(props.baseId)
    baseIds.value = (await props.bases.list()).map((base) => base.id)
    const canonicalDocumentId = props.requestedDocumentPath
      ? resolveDocumentationDocumentId(documents.value, props.requestedDocumentPath)
      : documents.value[0]?.id
    if (canonicalDocumentId && canonicalDocumentId !== props.requestedDocumentPath) {
      emit('canonicalize', canonicalDocumentId)
    }
  } catch (error) {
    documents.value = []
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    buildingDocumentation.value = false
  }
}

const importManifest = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.bases) return
  const registered = await props.bases.register(
    parseDocumentationManifest(JSON.parse(await file.text())),
  )
  emit('registered', registered.url)
}

const downloadManifest = async () => {
  if (!props.bases) return
  const base = await props.bases.get(props.baseId)
  if (!base) return
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(base.manifest, null, 2)}\n`], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${base.id}.documentation.json`
  link.click()
  URL.revokeObjectURL(url)
}

watch([() => props.bases, () => props.baseId], () => void loadBase(), { immediate: true })
</script>

<style scoped lang="sass">
.documentation-base-page
  height: 100%
  min-height: 0
  overflow: hidden
</style>
