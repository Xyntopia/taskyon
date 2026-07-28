<template>
  <q-page class="documentation-route-page column relative-position">
    <SplitTaskyonView
      :configuration="taskyonConfiguration"
      name="taskyon-docs"
      profile-name="taskyon-docs"
      persist
      class="col column"
    >
      <DocumentationBasePage
        :bases="documentationBases"
        :base-id="baseId"
        :requested-document-path="requestedDocumentPath"
        :prepare-base="prepareDocumentationBase"
        title="Taskyon Documentation"
        class="col"
        @select="selectDocument"
        @canonicalize="canonicalizeDocument"
        @select-base="selectBase"
        @registered="(url) => router.push(url)"
      />
    </SplitTaskyonView>
  </q-page>
</template>

<script setup lang="ts">
import SplitTaskyonView from '@taskyon/ui/components/SplitTaskyonView.vue'
import DocumentationBasePage from '@taskyon/ui/pages/DocumentationBasePage.vue'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import { documentationBaseUrl, documentationDocumentUrl } from '@taskyon/ui/modules/documentation'
import type { DocumentationBaseStore } from '@taskyon/common/modules/documentationBases'
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { useTaskyonStore } from 'src/stores/taskyonState'

const route = useRoute()
const router = useRouter()
const taskyon = useTaskyonStore()
const documentationBases = shallowRef<DocumentationBaseStore>()
const taskyonConfiguration: partialTyConfiguration = {
  appConfiguration: {
    showLogo: false,
    chatSuggestions: [],
    welcomeMsg: 'Ask me anything about Taskyon.',
  },
}

const baseId = computed(() => String(route.params.baseId || 'taskyon'))
const requestedDocumentPath = computed(() => {
  const filePath = route.params.filePath
  return Array.isArray(filePath) ? filePath.join('/') : filePath || ''
})

const documentRoute = (documentId: string) => documentationDocumentUrl(baseId.value, documentId)

const selectDocument = (documentId: string) => void router.push(documentRoute(documentId))
const canonicalizeDocument = (documentId: string) => void router.replace(documentRoute(documentId))
const selectBase = (id: string) => void router.push(documentationBaseUrl(id))
const prepareDocumentationBase = async (id: string) => {
  if (id === 'taskyon') await taskyon.taskyon
}

onMounted(async () => {
  await taskyon.documentationReady
  documentationBases.value = taskyon.documentationBases
})
</script>

<style scoped lang="sass">
.documentation-route-page
  height: 0
  overflow: hidden
</style>
