<template>
  <ResponsiveMenuDialogBtn
    dense
    flat
    :icon="matMoreHoriz"
    maximized
    auto-close
    data-cy-menu="ai-settings"
    aria-label="quick ai settings"
  >
    <template #btnContent><q-tooltip> More AI Settings</q-tooltip></template>
    <div class="q-pa-sm" @click.stop>
      <ObjectTreeView v-model="slimSettings.reactiveView" :schema="slimSettings.jsonSchema" dense />
    </div>
    <q-card-actions class="float-right">
      <q-btn v-if="em" flat to="/settings/agent%20config" label="Full list of settings" />
      <q-btn v-close-popup flat label="Ok" />
    </q-card-actions>
  </ResponsiveMenuDialogBtn>
</template>

<script setup lang="ts">
import { matMoreHoriz } from '@quasar/extras/material-icons'
import { appConfiguration } from 'src/modules/taskyon/types'
import { buildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { computed } from 'vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'
import ObjectTreeView from '../ObjectTreeView.vue'
import { llmSettings } from '@taskyon/taskyon'

const state = useAppStateStore()

const em = computed(() => state.appConfiguration.expertMode)

const slimSettings = computed(() =>
  buildSlimView(
    {
      obj: state.appConfiguration,
      schema: appConfiguration,
      pickKeys: ['expertMode'],
    },
    {
      obj: state.llmSettings,
      schema: llmSettings,
      pickKeys: [
        ...(em.value
          ? [
              'allowWebSearch',
              'enableToolChooser',
              'enableOpenAiTools',
              'tryUsingVisionModels',
              'useBasePrompt',
            ]
          : ['allowWebSearch']),
      ],
    },
    {
      obj: state.appConfiguration,
      schema: appConfiguration,
      pickKeys: ['primaryColor', 'secondaryColor'],
    },
  ),
)
</script>
