<template>
  <q-header class="column">
    <component
      :is="!miniToolbar ? QToolbar : 'div'"
      :class="miniToolbar ? 'q-gutter-xs row q-px-sm' : 'q-gutter-xs'"
    >
      <q-btn
        v-if="drawerOpen !== undefined"
        flat
        round
        dense
        :size="btnSize"
        :icon="matMenu"
        aria-label="Open Sidebar"
        class="q-mr-lg"
        @click="drawerOpen = !drawerOpen"
      />
      <slot name="left"></slot>
      <div v-if="state && !noChatButtons" :class="[noChatButtonBorder ? '' : 'button-group']">
        <q-btn
          v-if="!minMode"
          flat
          dense
          :size="btnSize"
          :icon="matSearch"
          to="/taskmanager"
          aria-label="go to taskmanager"
        >
          <q-tooltip>Search Conversations</q-tooltip>
        </q-btn>
        <q-btn
          v-if="backToChat"
          flat
          dense
          :icon="mdiForum"
          to="/"
          :size="btnSize"
          aria-label="go to chat"
          ><q-tooltip>Go to Chat</q-tooltip>
        </q-btn>
        <q-btn
          v-if="newChat"
          flat
          dense
          :icon="mdiForumPlus"
          :size="btnSize"
          to="/"
          aria-label="start new chat"
          @click="
            () => {
              state.llmSettings.selectedTaskId = undefined
              state.createTaskType.type = 'message'
            }
          "
          ><q-tooltip>Create New Chat</q-tooltip>
        </q-btn>
      </div>
      <q-space class="col" />
      <div v-if="!minMode && state.llmSettings.selectedTaskId">
        <share-dialog-btn
          flat
          round
          dense
          buttons
          download
          share
          :size="btnSize"
          :task-or-id="state.llmSettings.selectedTaskId"
        />
      </div>
      <!--
      <q-btn
        v-if="state && state.getErrors().length > 0"
        flat
        dense
        round
        :size="btnSize"
        color="warning"
        :icon="matWarning"
        to="/diagnostics"
      >
        <q-tooltip>There was problem with taskyon!, click here to find out more..</q-tooltip>
      </q-btn>-->
      <q-btn
        v-if="!minMode"
        flat
        class="gt-xs"
        dense
        round
        :size="btnSize"
        :icon="matHelpOutline"
        to="/docs/index"
      >
        <q-tooltip> Open Taskyon Documentation </q-tooltip>
      </q-btn>
      <q-separator
        v-if="!minMode && (!hideMenu || !hideRightSide)"
        class="desktop-only"
        vertical
      ></q-separator>
      <TaskyonMenu v-if="!hideMenu" :btn-size="btnSize" />
      <q-btn
        v-else-if="!hideRightSide"
        flat
        dense
        :size="btnSize"
        icon-right="svguse:/taskyon_mono_opt.svg#taskyon"
        no-caps
        href="https://taskyon.space"
        target="_blank"
        exact
      >
        <q-tooltip :delay="500">Powered by taskyon.space</q-tooltip>
      </q-btn>
    </component>
  </q-header>
</template>

<script setup lang="ts">
import { matHelpOutline, matMenu, matSearch } from '@quasar/extras/material-icons'
import { mdiForum, mdiForumPlus } from '@quasar/extras/mdi-v6'
import { QToolbar } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { defineAsyncComponent } from 'vue'
import TaskyonMenu from './TaskyonMenu.vue'

const state = useAppStateStore()

const { btnSize = 'md' } = defineProps<{
  minMode?: boolean
  btnSize?: 'xs' | 'md' | 'sm' | 'lg' | 'xl'
  noChatButtons?: boolean
  miniToolbar?: boolean
  noChatButtonBorder?: boolean
  hideRightSide?: boolean
  hideMenu?: boolean
  backToChat?: boolean
  newChat?: boolean
}>()

const drawerOpen = defineModel<boolean | undefined>('drawerOpen', {
  required: false,
  default: undefined,
})

const ShareDialogBtn = defineAsyncComponent(() => import('../taskyon/TaskChainPublishDialog.vue'))
</script>
