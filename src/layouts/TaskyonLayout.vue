<template>
  <q-layout view="lHh LpR lfr">
    <TaskyonHeader v-model:drawer-open="drawerOpen" :min-mode="minMode" :btn-size="btnSize" />

    <div class="fade-top-overlay" />

    <q-drawer
      v-if="state"
      v-model="drawerOpen"
      :show-if-above="!minMode"
      persistent
      :width="250"
      :breakpoint="minMode ? 5000 : 800"
      class="print-hide"
    >
      <ChatSidebar />
    </q-drawer>

    <!-- Sidebar Right -->
    <!--
    <q-drawer
      show-if-above
      side="right"
      v-model="state.drawerRight"
      bordered
      :width="200"
      :breakpoint="500"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-sm">
          <div v-for="n in 50" :key="n">Drawer {{ n }} / 50</div>
        </div>
      </q-scroll-area>
    </q-drawer>-->

    <!-- Main Content Area -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { defineAsyncComponent } from 'vue'
import TaskyonHeader from '../components/taskyon/TaskyonHeader.vue'
import { useAppStateStore } from 'src/stores/appState'

const drawerOpen = ref(false)

const ChatSidebar = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "ChatSidebar" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'components/taskyon/ChatSidebar.vue'
    ),
)

const state = useAppStateStore()

const minMode = computed(() => {
  return state.minimalGui
})
const btnSize = computed(() => {
  return minMode.value ? 'xs' : 'md'
})
</script>
