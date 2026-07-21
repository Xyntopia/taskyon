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
import ResponsiveMenuDialogBtn from '@taskyon/ui/components/ResponsiveMenuDialogBtn.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import type { JSONSchema7 } from 'json-schema'
import type { iconMap } from 'src/modules/icons'
import { iconRegistry, settingsIcons } from 'src/modules/icons'
import { appConfiguration } from 'src/modules/taskyon/types'
import { buildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, reactive } from 'vue'
import z from 'zod'

const state = useAppStateStore()
const tystate = useTaskyonStore()

const em = computed(() => state.appConfiguration.expertMode)
const entryNodePickKeys = [
  'use_baseprompt',
  'use_tool_chooser',
  'tool_chooser_min_tools',
  'use_multimodal',
  'reasoning_effort',
  'providerToolCalling',
  'max_error_retries',
] as const
const slimChatKeys = computed(() => (em.value ? entryNodePickKeys : ['reasoning_effort']))

const entryNode = computed(() => state.toolchainProfiles.base[state.llmSettings.entryFunction]!)
type ToolSettingsObjectSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}
const emptyToolSettingsSchema = (): ToolSettingsObjectSchema => ({
  type: 'object',
  properties: {},
})
const entryNodeSchema = computed((): ToolSettingsObjectSchema => {
  const parameters = tystate.allTools[state.llmSettings.entryFunction]?.parameters
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return emptyToolSettingsSchema()
  }
  const properties = parameters.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return emptyToolSettingsSchema()
  }
  return {
    type: 'object',
    properties: properties as Record<string, unknown>,
    ...(Array.isArray(parameters.required) ? { required: parameters.required } : {}),
  }
})
const entryNodeWebSearchSchema = computed(() => {
  const webSearch = entryNodeSchema.value.properties.websearch
  return webSearch && typeof webSearch === 'object' && !Array.isArray(webSearch)
    ? ({
        type: 'object',
        properties:
          'properties' in webSearch &&
          webSearch.properties &&
          typeof webSearch.properties === 'object' &&
          !Array.isArray(webSearch.properties)
            ? (webSearch.properties as Record<string, unknown>)
            : {},
        ...('required' in webSearch && Array.isArray(webSearch.required)
          ? { required: webSearch.required }
          : {}),
      } satisfies ToolSettingsObjectSchema)
    : emptyToolSettingsSchema()
})
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
      schema: entryNodeSchema.value,
      pickKeys: [...slimChatKeys.value],
    },
    ...(em.value
      ? [
          {
            obj: entryNodeWebSearch,
            schema: entryNodeWebSearchSchema.value,
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
