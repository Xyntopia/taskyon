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
      <ObjectView
        v-model="slimViewModel"
        :schema="slimView.jsonSchema as JSONSchema7"
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
import ResponsiveMenuDialogBtn from '@taskyon/shared/components/ResponsiveMenuDialogBtn.vue'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import { chatCompletionToolParameters, llmSettings } from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import type { iconMap } from 'src/modules/icons'
import { iconRegistry, settingsIcons } from 'src/modules/icons'
import { appConfiguration } from 'src/modules/taskyon/types'
import { buildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { computed, reactive } from 'vue'
import z from 'zod'

const state = useAppStateStore()

const em = computed(() => state.appConfiguration.expertMode)
const llmPickKeys = ['enableToolChooser'] as const
const chatCompletionPickKeys = [
  'use_baseprompt',
  'use_multimodal',
  'reasoning_effort',
  'max_results',
  'llmTools',
] as const
const slimChatKeys = computed(() => (em.value ? chatCompletionPickKeys : ['reasoning_effort']))

const writableLlmSettings = reactive({
  enableToolChooser: computed({
    get: () => state.llmSettings.enableToolChooser,
    set: (value) => state.setLLMSettings('enableToolChooser', value),
  }),
})

const slimView = computed(() =>
  buildSlimView(
    {
      obj: state.appConfiguration,
      schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
      pickKeys: ['expertMode'],
    },
    {
      obj: writableLlmSettings,
      schema: z.toJSONSchema(llmSettings, { unrepresentable: 'any' }),
      pickKeys: [...llmPickKeys],
    },
    {
      obj: state.toolchainConfig.chatCompletion!,
      schema: chatCompletionToolParameters,
      pickKeys: [...slimChatKeys.value],
    },
    {
      obj: state.appConfiguration,
      schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
      pickKeys: ['primaryColor', 'secondaryColor'],
    },
  ),
)

const slimViewModel = computed({
  get: () => {
    const view = slimView.value.reactiveView as Record<string, unknown>
    return Object.keys(view).reduce(
      (acc, key) => {
        acc[key] = view[key]
        return acc
      },
      {} as Record<string, unknown>,
    )
  },
  set: (nextValue) => {
    if (!nextValue) return
    Object.assign(slimView.value.reactiveView, nextValue)
  },
})
</script>
