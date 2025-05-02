<template>
  <q-layout view="lHh LpR lfr">
    <TaskyonHeader :min-mode="false" btn-size="md" :drawer-open="undefined" />

    <q-page-container>
      <q-page padding> Tool Page {{ name }} </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import TaskyonHeader from '../../components/taskyon/TaskyonHeader.vue'

defineProps<{
  name: string
}>()
</script>
