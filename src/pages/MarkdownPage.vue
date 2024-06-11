<template>
  <q-page padding>
    <div>
      <div>Folder: {{ folder }}</div>
      <div>Path: {{ filePath }}</div>
    </div>
    <ty-markdown
      v-if="markdownContent"
      :src="markdownContent"
      no-line-numbers
    />
  </q-page>
</template>

<script setup lang="ts">
import TyMarkdown from 'src/components/tyMarkdown.vue';
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
    const response = await fetch(`${folder}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}`);
    }
    const text = await response.text();
    markdownContent.value = text;
  } catch (error) {
    console.error(error);
    void router.replace({ name: '404' });
  }
};

const loadMarkdown = () => {
  const folder = props.folder;
  const filePath = props.filePath;
  console.log('download markdown file...');
  void fetchMarkdown(folder, filePath);
};

onMounted(() => {
  loadMarkdown();
});

watch(
  () => route.fullPath,
  () => {
    loadMarkdown();
  }
);
</script>
