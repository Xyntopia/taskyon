<template>
  <section class="dag-node-viewer column no-wrap">
    <header class="dag-node-viewer__header row items-center no-wrap">
      <div class="ellipsis">
        <div class="dag-node-viewer__title ellipsis">{{ label }}</div>
        <div v-if="path" class="dag-node-viewer__path ellipsis">{{ path }}</div>
      </div>
      <q-space />
      <q-chip v-if="localName" dense square outline color="secondary">
        {{ localName }}
      </q-chip>
      <q-chip v-if="hash" dense square outline :title="hash">
        {{ compactHash }}
      </q-chip>
      <q-btn
        v-if="standaloneTo"
        flat
        round
        dense
        :icon="matOpenInNew"
        :to="standaloneTo"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open node in standalone viewer"
      >
        <q-tooltip>Open standalone</q-tooltip>
      </q-btn>
    </header>
    <div class="dag-node-viewer__body col">
      <nav v-if="hasNavigation" class="dag-node-viewer__navigation">
        <q-scroll-area class="fit">
          <q-list dense padding>
            <q-item-label header>Upstream</q-item-label>
            <q-item
              v-for="item in upstreamNodes"
              :key="item.id"
              clickable
              @click="selectNode(item)"
            >
              <q-item-section>
                <q-item-label lines="1">{{ item.label }}</q-item-label>
                <q-item-label caption lines="1">{{ item.caption }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="upstreamNodes.length === 0" dense>
              <q-item-section>
                <q-item-label caption>None</q-item-label>
              </q-item-section>
            </q-item>

            <q-separator spaced />
            <q-item-label header>Downstream</q-item-label>
            <q-item
              v-for="item in downstreamNodes"
              :key="item.id"
              clickable
              @click="selectNode(item)"
            >
              <q-item-section>
                <q-item-label lines="1">{{ item.label }}</q-item-label>
                <q-item-label caption lines="1">{{ item.caption }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="downstreamNodes.length === 0" dense>
              <q-item-section>
                <q-item-label caption>None</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-scroll-area>
      </nav>

      <div class="dag-node-viewer__content column no-wrap">
        <q-tabs v-model="activeView" dense align="left" narrow-indicator>
          <q-tab name="source" :icon="matCode" label="Source" />
          <q-tab name="inputs" :icon="matInput" label="Inputs" />
          <q-tab name="output" :icon="matOutput" label="Output" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="activeView" animated class="col">
          <q-tab-panel name="source" class="q-pa-none">
            <CodeEditor v-model="source" language="typescript" :read-only="readOnly" class="fit" />
          </q-tab-panel>
          <q-tab-panel name="inputs" class="q-pa-none">
            <q-scroll-area class="fit">
              <ObjectView
                v-if="documentationInputSchema"
                :model-value="documentationValue"
                :schema="documentationInputSchema"
                read-only
                missing-mode="placeholders"
                :show-missing-indicator="false"
                :default-expanded-depth="2"
                schema-documentation
                class="dag-node-viewer__schema"
              />
              <div v-else class="dag-node-viewer__empty">Input schema unavailable.</div>
            </q-scroll-area>
          </q-tab-panel>
          <q-tab-panel name="output" class="q-pa-none">
            <q-scroll-area class="fit">
              <ObjectView
                v-if="documentationOutputSchema"
                :model-value="documentationValue"
                :schema="documentationOutputSchema"
                read-only
                missing-mode="placeholders"
                :show-missing-indicator="false"
                :default-expanded-depth="2"
                schema-documentation
                class="dag-node-viewer__schema"
              />
              <div v-else class="dag-node-viewer__empty">Output schema unavailable.</div>
            </q-scroll-area>
          </q-tab-panel>
        </q-tab-panels>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import type { RouteLocationRaw } from 'vue-router'

export type DagNodeNavigationItem = {
  id: string
  label: string
  caption?: string | undefined
}
</script>

<script setup lang="ts">
import { matCode, matInput, matOpenInNew, matOutput } from '@quasar/extras/material-icons'
import type { DagJsonSchema } from '@taskyon/comp-dag/dagSchema'
import type { JSONSchema7 } from 'json-schema'
import { computed } from 'vue'
import CodeEditor from './CodeEditor.vue'
import ObjectView from './varViews/ObjectView.vue'

const source = defineModel<string>({ required: true })
const activeView = defineModel<'source' | 'inputs' | 'output'>('view', { default: 'source' })
const props = withDefaults(
  defineProps<{
    label: string
    path?: string | undefined
    localName?: string | undefined
    hash?: string | undefined
    readOnly?: boolean
    standaloneTo?: RouteLocationRaw | undefined
    showNavigation?: boolean
    inputSchema?: DagJsonSchema | undefined
    outputSchema?: DagJsonSchema | undefined
    upstreamNodes?: DagNodeNavigationItem[]
    downstreamNodes?: DagNodeNavigationItem[]
  }>(),
  {
    path: '',
    localName: '',
    hash: '',
    readOnly: true,
    standaloneTo: undefined,
    showNavigation: false,
    inputSchema: undefined,
    outputSchema: undefined,
    upstreamNodes: () => [],
    downstreamNodes: () => [],
  },
)
const emit = defineEmits<{ selectNode: [id: string] }>()

const compactHash = computed(() =>
  props.hash.length > 21 ? `${props.hash.slice(0, 13)}…${props.hash.slice(-5)}` : props.hash,
)
const hasNavigation = computed(
  () => props.showNavigation || props.upstreamNodes.length > 0 || props.downstreamNodes.length > 0,
)
const documentationValue: Record<string, unknown> = {}
const objectViewSchema = (schema: DagJsonSchema | undefined): JSONSchema7 | undefined => {
  if (schema === undefined) return undefined
  if (typeof schema === 'boolean') return schema ? {} : { not: {} }
  const compatibleSchema = { ...schema }
  delete compatibleSchema.$schema
  return compatibleSchema as JSONSchema7
}
const documentationInputSchema = computed(() => objectViewSchema(props.inputSchema))
const documentationOutputSchema = computed(() => objectViewSchema(props.outputSchema))
const selectNode = (item: DagNodeNavigationItem) => {
  emit('selectNode', item.id)
}
</script>

<style scoped>
.dag-node-viewer {
  min-width: 0;
  min-height: 0;
}

.dag-node-viewer__header {
  flex: 0 0 auto;
  min-height: 2.8rem;
  gap: 0.3rem;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.dag-node-viewer__title {
  font-size: 0.76rem;
  font-weight: 600;
}

.dag-node-viewer__path {
  color: var(--q-grey-6);
  font-family: monospace;
  font-size: 0.66rem;
}

.dag-node-viewer__body {
  display: grid;
  grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.dag-node-viewer__navigation {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.dag-node-viewer__content {
  min-width: 0;
  min-height: 0;
}

.dag-node-viewer__content :deep(.q-tab-panel),
.dag-node-viewer__content :deep(.q-panel),
.dag-node-viewer__content :deep(.q-tab-panels) {
  min-height: 0;
}

.dag-node-viewer__content :deep(.cm-editor),
.dag-node-viewer__content :deep(.cm-scroller) {
  height: 100%;
}

.dag-node-viewer__schema {
  padding: 0.65rem;
}

.dag-node-viewer__empty {
  padding: 1rem;
  color: var(--q-grey-6);
  font-size: 0.75rem;
}

@media (max-width: 700px) {
  .dag-node-viewer__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(7rem, 25%) minmax(0, 1fr);
  }

  .dag-node-viewer__navigation {
    border-right: 0;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
}
</style>
