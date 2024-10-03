<template>
  <q-page class="q-pa-xs">
    <div v-if="$route.query.debug !== undefined">
      <div>Folder: {{ folder }}</div>
      <div>Path: {{ filePath }}</div>
    </div>
    <q-card class="q-pa-sm">
      <ty-markdown
        v-if="markdownContent"
        :src="markdownContent"
        no-line-numbers
      />
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import TyMarkdown from 'components/tyMarkdown.vue';
import { ref, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();
const props = defineProps<{
  folder: string;
  filePath: string;
}>();

const markdownContent = ref('');

const fetchMarkdown = async (folder: string, filePath: string) => {
  try {
    const fileURL = folder ? `/${folder}/${filePath}` : `/${filePath}`;
    const response = await fetch(fileURL);
    if (!response.ok) {
      throw new Error(`Failed to load ${fileURL}`);
    }
    const text = await response.text();
    markdownContent.value = text;
  } catch (error) {
    console.error(error);
    if (process.env.PROD) {
      void router.replace('/404');
    }
  }
};

const loadMarkdown = () => {
  const folder = props.folder;
  const filePath = props.filePath;
  console.log('download markdown file...', folder, filePath);
  void fetchMarkdown(folder, filePath);
};

onMounted(() => {
  loadMarkdown();
});

watch(
  () => route.fullPath,
  () => {
    loadMarkdown();
  },
);
</script>
