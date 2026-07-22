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
      <div class="text-caption q-mb-sm">
        Toolchain profile: {{ state.selectedToolchainProfile ?? 'Base' }}
      </div>
      <ObjectView
        v-if="effectiveEntryNode"
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
import { buildSlimSchema } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed } from 'vue'
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

const effectiveEntryNode = computed(
  () => state.effectiveToolchainConfig[state.llmSettings.entryFunction],
)
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
const getEntryNodeWebSearchMaxResults = () => {
  const webSearch = effectiveEntryNode.value?.websearch
  if (!webSearch || typeof webSearch !== 'object' || Array.isArray(webSearch)) {
    return 5
  }
  return typeof webSearch.max_results === 'number' ? webSearch.max_results : 5
}

const slimView = computed(() =>
  buildSlimSchema(
    {
      schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
      pickKeys: ['expertMode'],
    },
    {
      schema: entryNodeSchema.value,
      pickKeys: [...slimChatKeys.value],
    },
    ...(em.value
      ? [
          {
            schema: entryNodeWebSearchSchema.value,
            pickKeys: ['max_results'],
          },
        ]
      : []),
    {
      schema: z.toJSONSchema(appConfiguration, { unrepresentable: 'any' }),
      pickKeys: ['primaryColor', 'secondaryColor'],
    },
  ),
)

const slimViewModel = computed({
  get: () => ({
    expertMode: state.appConfiguration.expertMode,
    ...Object.fromEntries(slimChatKeys.value.map((key) => [key, effectiveEntryNode.value?.[key]])),
    ...(em.value ? { max_results: getEntryNodeWebSearchMaxResults() } : {}),
    primaryColor: state.appConfiguration.primaryColor,
    secondaryColor: state.appConfiguration.secondaryColor,
  }),
  set: (nextValue) => {
    if (!nextValue) return
    const currentValue = slimViewModel.value
    if (!Object.is(currentValue.expertMode, nextValue.expertMode)) {
      state.appConfiguration.expertMode = appConfiguration.shape.expertMode.parse(
        nextValue.expertMode,
      )
    }
    if (!Object.is(currentValue.primaryColor, nextValue.primaryColor)) {
      state.appConfiguration.primaryColor = appConfiguration.shape.primaryColor.parse(
        nextValue.primaryColor,
      )
    }
    if (!Object.is(currentValue.secondaryColor, nextValue.secondaryColor)) {
      state.appConfiguration.secondaryColor = appConfiguration.shape.secondaryColor.parse(
        nextValue.secondaryColor,
      )
    }

    const entryFunction = state.llmSettings.entryFunction
    for (const key of slimChatKeys.value) {
      if (!Object.is(currentValue[key], nextValue[key])) {
        state.setActiveToolchainValue([entryFunction, key], nextValue[key])
      }
    }
    if (em.value && !Object.is(currentValue.max_results, nextValue.max_results)) {
      state.setActiveToolchainValue(
        [entryFunction, 'websearch', 'max_results'],
        nextValue.max_results,
      )
    }
  },
})
</script>
