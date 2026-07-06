<template>
  <FadeAwayScrollPage class="q-pa-xs">
    <div v-if="route.query.debug !== undefined">
      <div>Folder: {{ folder }}</div>
      <div>Path: {{ filePath }}</div>
    </div>
    <q-card flat class="q-pa-sm">
      <ty-markdown v-if="markdownContent" :src="markdownContent" no-line-numbers use-iframe />
    </q-card>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import TyMarkdown from '@taskyon/ui/components/tyMarkdown.vue'
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const props = defineProps<{
  folder: string
  filePath: string
}>()

const markdownContent = ref('')

const fetchMarkdown = async (folder: string, filePath: string) => {
  const fileURL = folder ? `/${folder}/${filePath}` : `/${filePath}`
  const response = await fetch(fileURL)

  // Check if the response is not OK or if the content type is HTML (indicating 404 page)
  const contentType = response.headers.get('Content-Type') || ''
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error(`Failed to load markdown file: ${fileURL}`)
  }

  const text = await response.text()
  return text
}

const loadMarkdown = async () => {
  const folder = props.folder
  const filePath = props.filePath
  console.log('download markdown file...', folder, filePath)
  try {
    const txt = await fetchMarkdown(folder, filePath)
    if (txt) {
      markdownContent.value = txt
    } else {
      if (process.env.PROD) {
        void router.replace('/404')
      }
    }
  } catch {
    void router.replace('/404')
  }
}

onMounted(() => {
  void loadMarkdown()
})

watch(
  () => route.fullPath,
  () => {
    void loadMarkdown()
  },
)
</script>
