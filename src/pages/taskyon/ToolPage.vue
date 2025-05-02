<template>
  <q-layout view="hHh lpR lFr">
    <TaskyonHeader :min-mode="false" btn-size="md" v-model:drawer-open="drawerOpen" />
    <q-drawer v-model="drawerOpen" show-if-above persistent behaviour="desktop" :width="250">
      tst
      <ObjectTreeView :model-value="functionArgs" />
    </q-drawer>
    <q-page-container>
      <q-page padding> Tool Page {{ name }} </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TaskyonHeader from '../../components/taskyon/TaskyonHeader.vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'

defineProps<{
  name: string
}>()

const functionArgs = ref<Record<string, unknown>>({})

const drawerOpen = ref(false)
</script>
