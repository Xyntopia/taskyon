<template>
  <FadeAwayScrollPage class="q-pa-xs">
    <div v-if="route.query.debug !== undefined">
      <div>Folder: {{ folder }}</div>
      <div>Path: {{ filePath }}</div>
    </div>
    <q-card flat class="q-pa-sm">
      <ty-markdown v-if="markdownContent" :src="markdownContent" no-line-numbers />
    </q-card>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import TyMarkdown from 'components/tyMarkdown.vue'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'
import { fetchMarkdown } from 'src/modules/taskyon/taskUtils'
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

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
