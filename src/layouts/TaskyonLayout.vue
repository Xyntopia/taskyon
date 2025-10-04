<template>
  <q-layout view="lHh LpR lfr">
    <TaskyonHeader
      v-if="guiM === 'iframe'"
      v-model:drawer-open="drawerOpen"
      btn-size="xs"
      new-chat
      mini-toolbar
      min-mode
      hide-menu
      no-chat-button-border
    />
    <TaskyonHeader
      v-else-if="guiM === 'minChat'"
      v-model:drawer-open="drawerOpen"
      new-chat
      mini-toolbar
      back-to-chat
      hide-menu
      hide-right-side
      no-chat-button-border
    />
    <TaskyonHeader v-else v-model:drawer-open="drawerOpen" new-chat back-to-chat />

    <q-drawer
      v-if="state"
      v-model="drawerOpen"
      :show-if-above="guiM !== 'iframe'"
      persistent
      :width="250"
      :breakpoint="guiM !== 'iframe' ? 5000 : 800"
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

const guiM = computed(() => state.minimalGui)
</script>
