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
      <ObjectTreeView
        v-model="reactiveView"
        :schema="jsonSchema as JSONSchema7"
        dense
        :icons="{
          ...(settingsIcons.llmSettings as iconMap),
          ...(settingsIcons.appConfiguration as iconMap),
          ...(iconRegistry.chatCompletion as iconMap),
        }"
      />
    </div>
    <q-card-actions class="float-right">
      <q-btn v-if="em" flat to="/settings/agent%20config" label="Full list of settings" />
      <q-btn v-close-popup flat label="Ok" />
    </q-card-actions>
  </ResponsiveMenuDialogBtn>
</template>

<script setup lang="ts">
import { matMoreHoriz } from '@quasar/extras/material-icons'
import { chatCompletionToolParameters, llmSettings } from '@taskyon/taskyon'
import type { iconMap } from 'src/modules/icons'
import { iconRegistry, settingsIcons } from 'src/modules/icons'
import { appConfiguration } from 'src/modules/taskyon/types'
import { buildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { computed } from 'vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'
import ObjectTreeView from '../varViews/ObjectTreeView.vue'
import type { JSONSchema7 } from 'json-schema'
import z from 'zod'

const state = useAppStateStore()

const em = computed(() => state.appConfiguration.expertMode)
const sources = [
  {
    obj: state.appConfiguration,
    schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
    pickKeys: ['expertMode'],
  },
  {
    obj: state.llmSettings,
    schema: z.toJSONSchema(llmSettings, { unrepresentable: 'any' }),
    pickKeys: [
      ...(em.value
        ? ['enableToolChooser', 'tryUsingVisionModels', 'useBasePrompt']
        : ['enableToolChooser']),
    ],
  },
  {
    obj: state.toolchainConfig.chatCompletion!,
    schema: chatCompletionToolParameters,
    pickKeys: ['reasoning_effort', 'max_results'],
  },
  {
    obj: state.appConfiguration,
    schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
    pickKeys: ['primaryColor', 'secondaryColor'],
  },
]

const { jsonSchema, reactiveView } = buildSlimView(...sources)
</script>
