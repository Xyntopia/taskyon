<template>
  <q-list>
    <q-item v-for="file in fileMappings" :key="file?.uuid">
      <q-item-section side>
        <q-icon :name="mdiFileDocument" size="sm"></q-icon>
      </q-item-section>
      <q-item-section v-if="preview">
        <!--TODO: load image here from "previews" but lazily-->
        <q-img src="https://picsum.photos/500/300"> </q-img>
      </q-item-section>
      <q-item-section class="ellipsis">{{
        file?.name || file?.opfs
      }}</q-item-section>
      <q-tooltip v-if="expertMode" :delay="500">
        <p class="text-bold">uploaded file:</p>
        <p style="white-space: pre-wrap">
          {{ dump({ uuid: file?.uuid, name: file?.name }) }}
        </p></q-tooltip
      >
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import type { FileMappingDocType } from 'src/modules/taskyon/rxdb';
import { dump } from 'js-yaml';
import { mdiFileDocument } from '@quasar/extras/mdi-v6';
import { ref } from 'vue';

defineProps<{
  fileMappings: FileMappingDocType[];
  expertMode: boolean;
  preview: boolean;
  getFile?: (uuid: string) => Promise<File | undefined>;
}>();

const previews = ref<Record<string, File>>({});
</script>
