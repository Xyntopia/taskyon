<template>
  <q-list>
    <q-item v-for="file in props.fileMappings" :key="file.uuid">
      <!-- Image preview, loaded asynchronously -->
      <q-item-section v-if="props.preview">
        <q-img
          v-if="previews[file.uuid]"
          :src="previews[file.uuid]"
          style="width: 100px; height: 100px"
        />
        <!-- Show a skeleton loader while the image is being fetched -->
        <q-skeleton v-else width="100px" height="100px" />
      </q-item-section>

      <q-item-section class="ellipsis">
        {{ file.name || file.opfs }}
      </q-item-section>

      <q-tooltip v-if="props.expertMode" :delay="500">
        <p class="text-bold">uploaded file:</p>
        <p style="white-space: pre-wrap">
          {{ dump({ uuid: file.uuid, name: file.name }) }}
        </p>
      </q-tooltip>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FileMappingDocType } from 'src/modules/taskyon/rxdb';
import { dump } from 'js-yaml';
import { watch } from 'vue';

// Store the props in a variable for easy access
const props = defineProps<{
  fileMappings: FileMappingDocType[];
  expertMode: boolean;
  preview: boolean;
  getFile: (uuid: string) => Promise<File | undefined>;
}>();

const previews = ref<Record<string, string>>({}); // Store object URLs as strings

const loadAllPreviews = async () => {
  console.log('load file...');
  const previewPromises = props.fileMappings.map(async (file) => {
    if (file?.uuid) {
      const previewFile = await props.getFile(file.uuid);
      if (previewFile) {
        // Convert file to an object URL and store it
        previews.value[file.uuid] = URL.createObjectURL(previewFile);
      }
    }
  });
  await Promise.all(previewPromises); // Wait for all previews to load
};

watch(
  () => props.fileMappings,
  () => {
    loadAllPreviews();
  },
  {
    immediate: true,
  },
);
</script>
