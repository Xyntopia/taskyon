<template>
  <q-page class="column relative-position">
    <SplitTaskyonView
      :configuration="taskyonConfiguration"
      name="taskyon-docs"
      profile-name="taskyon-docs"
      persist
      class="col column"
    >
      <DocumentationPage
        :documents="documents"
        :initial-document-id="initialDocumentId"
        title="Taskyon Documentation"
        class="col"
        @select="selectDocument"
      >
        <template #sidebar-header>
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
              @update:model-value="selectBase"
            />
            <q-btn flat round dense :icon="matUploadFile" @click="openManifestPicker">
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
    </SplitTaskyonView>
    <q-inner-loading
      :showing="buildingDocumentation"
      label="Building documentation..."
      label-class="text-body1 text-secondary"
      color="secondary"
      size="44px"
    />
  </q-page>
</template>

<script setup lang="ts">
import SplitTaskyonView from '@taskyon/ui/components/SplitTaskyonView.vue'
import DocumentationPage from '@taskyon/ui/pages/DocumentationPage.vue'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import { matDownload, matUploadFile } from '@quasar/extras/material-icons'
import { parseDocumentationManifest } from '@taskyon/common/modules/resourceFiles'
import {
  documentationBaseUrl,
  documentationDocumentUrl,
  resolveDocumentationDocumentId,
  type LoadedDocumentationDocument,
} from '@taskyon/ui/modules/documentation'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { useTaskyonStore } from 'src/stores/taskyonState'

const route = useRoute()
const router = useRouter()
const taskyon = useTaskyonStore()
const documents = ref<LoadedDocumentationDocument[]>([])
const baseIds = ref<string[]>([])
const manifestPicker = ref<HTMLInputElement>()
const buildingDocumentation = ref(true)
const taskyonConfiguration: partialTyConfiguration = {
  appConfiguration: {
    showLogo: false,
    chatSuggestions: [],
    welcomeMsg: 'Ask me anything about Taskyon.',
  },
}

const baseId = computed(() => String(route.params.baseId || 'taskyon'))
const baseOptions = computed(() => baseIds.value.map((id) => ({ label: id, value: id })))
const requestedDocumentPath = computed(() => {
  const filePath = route.params.filePath
  return Array.isArray(filePath) ? filePath.join('/') : filePath || ''
})

const initialDocumentId = computed((): string => {
  if (requestedDocumentPath.value) {
    return (
      resolveDocumentationDocumentId(documents.value, requestedDocumentPath.value) ??
      requestedDocumentPath.value
    )
  }
  return documents.value[0]?.id ?? ''
})

const documentRoute = (documentId: string) => documentationDocumentUrl(baseId.value, documentId)

const selectDocument = (documentId: string) => void router.push(documentRoute(documentId))

const loadBase = async () => {
  buildingDocumentation.value = true
  try {
    await taskyon.documentationReady
    if (baseId.value === 'taskyon') {
      await taskyon.taskyon
    }
    documents.value = await taskyon.documentationBases.load(baseId.value)
    baseIds.value = (await taskyon.documentationBases.list()).map((base) => base.id)
    const canonicalDocumentId = requestedDocumentPath.value
      ? resolveDocumentationDocumentId(documents.value, requestedDocumentPath.value)
      : documents.value[0]?.id
    if (canonicalDocumentId && canonicalDocumentId !== requestedDocumentPath.value) {
      await router.replace(documentRoute(canonicalDocumentId))
    }
  } finally {
    buildingDocumentation.value = false
  }
}

const selectBase = (id: string) => void router.push(documentationBaseUrl(id))
const openManifestPicker = () => manifestPicker.value?.click()

const importManifest = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const registered = await taskyon.documentationBases.register(
    parseDocumentationManifest(JSON.parse(await file.text())),
  )
  await router.push(registered.url)
}

const downloadManifest = async () => {
  const base = await taskyon.documentationBases.get(baseId.value)
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

watch(baseId, () => void loadBase())
onMounted(loadBase)
</script>
