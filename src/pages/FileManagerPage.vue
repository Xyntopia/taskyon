<template>
  <q-layout>
    <q-page-container>
      <q-page padding>
        <div class="text-secondary" style="width: 200px; height: 100px">
          <FileDropzone class="fit" enable-paste @add-files="addFiles" />
        </div>
        {{ files.map((f) => f.name) }}
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import FileDropzone from 'src/components/FileDropzone.vue'
import { ref } from 'vue'

const files = ref<File[]>([])

function addFiles(fs: File[]) {
  console.log('added another file!')
  files.value.push(...fs)
}
</script>
