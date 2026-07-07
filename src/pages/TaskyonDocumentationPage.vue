<template>
  <q-page class="column">
    <SplitTaskyonView name="taskyon-docs" profile-name="taskyon-docs" persist class="col column">
      <DocumentationPage
        :documents="documents"
        :initial-document-id="initialDocumentId"
        title="Taskyon Documentation"
        class="col"
      />
    </SplitTaskyonView>
  </q-page>
</template>

<script setup lang="ts">
import {
  buildDocumentationDocumentsFromGlob,
  documentationPathFromGlob,
} from '@taskyon/ui/modules/documentation'
import SplitTaskyonView from '@taskyon/ui/components/SplitTaskyonView.vue'
import DocumentationPage from '@taskyon/ui/pages/DocumentationPage.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const taskyonDocumentationUrls = import.meta.glob<string>('../../public/docs/**/*.md', {
  eager: true,
  query: '?url',
  import: 'default',
})

const documents = buildDocumentationDocumentsFromGlob(taskyonDocumentationUrls, {
  rootMarker: '../../public/docs/',
  metadata: {
    source: 'taskyon-public-docs',
  },
})

const route = useRoute()

const initialDocumentId = computed((): string => {
  const filePath = route.params.filePath
  if (Array.isArray(filePath) && filePath.length > 0) return `${filePath.join('/')}.md`
  if (typeof filePath === 'string' && filePath.length > 0) return `${filePath}.md`
  const indexPath = Object.keys(taskyonDocumentationUrls).find((path) => path.endsWith('/index.md'))
  return indexPath
    ? documentationPathFromGlob(indexPath, '../../public/docs/')
    : documents[0]?.id || ''
})
</script>
