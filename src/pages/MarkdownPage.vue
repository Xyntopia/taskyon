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
import { fetchMarkdown } from '@taskyon/taskyon'
import TyMarkdown from 'components/tyMarkdown.vue'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const props = defineProps<{
  folder: string
  filePath: string
}>()

const markdownContent = ref('')

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
