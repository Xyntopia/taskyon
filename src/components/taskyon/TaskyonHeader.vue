<template>
  <q-header class="column">
    <component
      :is="!minMode ? QToolbar : 'div'"
      :class="minMode ? 'q-gutter-xs row q-px-sm' : 'q-gutter-xs'"
    >
      <q-btn
        v-if="drawerOpen !== undefined"
        flat
        round
        dense
        :size="btnSize"
        :icon="matMenu"
        aria-label="Open Sidebar"
        @click="drawerOpen = !drawerOpen"
      />
      <div v-if="state" :class="['q-ml-lg', minMode ? '' : 'button-group']">
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
          v-if="!minMode"
          flat
          dense
          :icon="mdiForum"
          to="/"
          :size="btnSize"
          aria-label="go to chat"
          ><q-tooltip>Go to Chat</q-tooltip>
        </q-btn>
        <q-btn
          flat
          dense
          :icon="mdiForumPlus"
          :size="btnSize"
          to="/"
          aria-label="start new chat"
          @click="state.llmSettings.selectedTaskId = undefined"
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
          :task-id="state.llmSettings.selectedTaskId"
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
      <q-separator v-if="!minMode" class="desktop-only" vertical></q-separator>
      <q-btn v-if="!minMode" round flat dense icon="svguse:/taskyon_mono_opt.svg#taskyon">
        <q-menu>
          <q-list dense>
            <q-item :size="btnSize" to="/settings">
              <q-item-section avatar>
                <q-icon :name="matSettings" />
              </q-item-section>
              <q-item-section>Open settings</q-item-section>
            </q-item>
            <q-item
              v-ripple
              clickable
              href="https://github.com/xyntopia/taskyon"
              target="_blank"
              exact
            >
              <q-item-section avatar>
                <q-icon :name="mdiGithub" />
              </q-item-section>
              <q-item-section>Visit our Taskyon repository</q-item-section>
            </q-item>
            <q-separator />
            <q-item v-ripple clickable to="/docs/index" exact active-class="text-secondary">
              <q-item-section avatar>
                <q-icon :name="matHelpOutline" />
              </q-item-section>
              <q-item-section> Documentation </q-item-section>
            </q-item>
            <q-item
              v-ripple
              clickable
              exact
              active-class="text-secondary"
              @click="showAboutDialog = true"
            >
              <q-item-section avatar>
                <q-icon :name="mdiInformationVariant" />
              </q-item-section>
              <q-item-section> About </q-item-section>
              <q-dialog v-model="showAboutDialog" auto-close>
                <q-card>
                  <q-card-section class="text-h5">About Taskyon</q-card-section>
                  <q-card-section>
                    Taskyon is a local-first AI platform for personalized task management and
                    seamless web integration. It ensures data security with local processing while
                    offering powerful tools like task trees, function execution, and sandboxing.
                    Learn more at taskyon.space.
                  </q-card-section>
                  <q-card-actions>
                    <q-btn flat color="secondary" to="/diagnostics">
                      <div class="q-pr-md">Open Diagnostics</div>
                      <q-icon :name="mdiWrench"></q-icon>
                      <q-icon :name="mdiHospital" size="md"></q-icon>
                    </q-btn>
                    <q-btn flat label="Reset Settings" to="/settings/profile" />
                  </q-card-actions>
                  <q-card-section class="text-info" style="font-size: 0.75em">
                    <div v-for="[name, value] of Object.entries(environmentInfo)" :key="name">
                      {{ name }}: {{ value }}
                    </div>
                  </q-card-section>
                </q-card>
              </q-dialog>
            </q-item>
            <q-separator />
            <q-item v-ripple clickable to="/pricing" exact active-class="text-secondary">
              <q-item-section> AI chat price list </q-item-section>
            </q-item>
            <q-separator />
            <q-item>
              <q-item-section>
                <DarkModeButton
                  v-if="state"
                  dense
                  flat
                  label="Change Theme"
                  :size="btnSize"
                  @theme-changed="(newMode) => (state!.darkTheme = newMode)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
      <q-btn
        v-else
        flat
        dense
        size="xs"
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
import DarkModeButton from 'components/DarkModeButton.vue'
import { defineAsyncComponent } from 'vue'
import { matHelpOutline, matMenu, matSearch, matSettings } from '@quasar/extras/material-icons'
import {
  mdiForum,
  mdiForumPlus,
  mdiGithub,
  mdiHospital,
  mdiInformationVariant,
  mdiWrench,
} from '@quasar/extras/mdi-v6'
import { useAppStateStore } from 'src/stores/appState'
import { ref } from 'vue'
import { QToolbar } from 'quasar'
import { getEnvironmentInfo } from 'src/modules/utils'

const state = useAppStateStore()
const showAboutDialog = ref(false)

defineProps<{
  minMode?: boolean
  btnSize: 'xs' | 'md'
}>()
const drawerOpen = defineModel<boolean | undefined>('drawerOpen', {
  required: false,
})

const ShareDialogBtn = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "ShareDialogButton" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      '../taskyon/TaskChainPublishDialog.vue'
    ),
)

const environmentInfo = getEnvironmentInfo()

console.log(environmentInfo)
</script>
