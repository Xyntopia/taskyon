<template>
  <q-page padding>
    <ty-markdown v-if="markdownContent" :src="markdownContent" />
  </q-page>
</template>

<script setup lang="ts">
import TyMarkdown from 'src/components/tyMarkdown.vue';
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
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

onMounted(() => {
  const folder = props.folder;
  const filePath = props.filePath;
  console.log('download markdown file...');
  void fetchMarkdown(folder, filePath);
});
</script>
