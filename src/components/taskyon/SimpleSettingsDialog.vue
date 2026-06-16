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
        v-if="entryNode"
        v-model="slimViewModel"
        view-mode="flat"
        :schema="slimView.jsonSchema as JSONSchema7"
        dense
        :icons="{
          ...(settingsIcons.appConfiguration as iconMap),
          ...(iconRegistry.entryNode as iconMap),
        }"
      />
      <div v-else class="text-negative">Error: No entry node found in toolchain config</div>
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
import { EntryNodeSettingsSchema } from '@taskyon/taskyon'
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
const entryNodePickKeys = [
  'use_baseprompt',
  'use_tool_chooser',
  'tool_chooser_min_tools',
  'use_multimodal',
  'reasoning_effort',
  'llmTools',
  'max_error_retries',
] as const
const slimChatKeys = computed(() => (em.value ? entryNodePickKeys : ['reasoning_effort']))

const entryNode = computed(() => state.toolchainConfig[state.llmSettings.entryFunction]!)
type EntryNodeWebSearchSettings = {
  enabled?: boolean
  max_results?: number
}

const getEntryNodeWebSearch = (): EntryNodeWebSearchSettings => {
  const webSearch = entryNode.value.websearch
  if (!webSearch || typeof webSearch !== 'object' || Array.isArray(webSearch)) {
    return {}
  }

  return {
    ...(typeof webSearch.enabled === 'boolean' ? { enabled: webSearch.enabled } : {}),
    ...(typeof webSearch.max_results === 'number' ? { max_results: webSearch.max_results } : {}),
  }
}

const entryNodeWebSearch = reactive({
  get max_results() {
    return getEntryNodeWebSearch().max_results ?? 5
  },
  set max_results(value: number) {
    const currentWebSearch = getEntryNodeWebSearch()
    entryNode.value.websearch = {
      ...currentWebSearch,
      max_results: value,
    }
  },
})

const slimView = computed(() =>
  buildSlimView(
    {
      obj: state.appConfiguration,
      schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
      pickKeys: ['expertMode'],
    },
    {
      obj: entryNode.value,
      schema: EntryNodeSettingsSchema,
      pickKeys: [...slimChatKeys.value],
    },
    ...(em.value
      ? [
          {
            obj: entryNodeWebSearch,
            schema:
              EntryNodeSettingsSchema.properties.websearch &&
              typeof EntryNodeSettingsSchema.properties.websearch === 'object' &&
              !Array.isArray(EntryNodeSettingsSchema.properties.websearch)
                ? EntryNodeSettingsSchema.properties.websearch
                : { type: 'object', properties: {} },
            pickKeys: ['max_results'],
          },
        ]
      : []),
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
