<template>
  <div class="openapi-view column no-wrap">
    <header class="openapi-view__header row items-center q-gutter-sm">
      <div>
        <div class="text-h6">{{ document.info.title }}</div>
        <div class="text-caption text-grey-7">
          OpenAPI {{ document.openapi }} · {{ document.info.version }}
        </div>
      </div>
      <q-space />
      <q-btn flat round :icon="matDataObject" :disable="rawLoading" @click="toggleRaw">
        <q-tooltip>{{ showRaw ? 'Show structured API' : 'Show raw document' }}</q-tooltip>
      </q-btn>
    </header>

    <q-separator />

    <q-scroll-area v-if="showRaw" class="col">
      <div class="openapi-view__raw">
        <ObjectView
          v-model:view-mode="rawViewMode"
          :model-value="rawDocument"
          read-only
          copy-object-btn
          missing-mode="hide"
        />
      </div>
    </q-scroll-area>

    <template v-else>
      <q-tabs
        v-model="activeSection"
        dense
        align="left"
        narrow-indicator
        class="openapi-view__tabs"
      >
        <q-tab name="operations" :icon="matSyncAlt" label="Operations" />
        <q-tab name="streams" :icon="matStream" label="Streams" />
        <q-tab name="tools" :icon="matBuild" label="Tools" />
        <q-tab name="schemas" :icon="matAccountTree" label="Schemas" />
      </q-tabs>
      <q-separator />

      <q-splitter v-model="splitter" class="col" :limits="[20, 45]">
        <template #before>
          <q-scroll-area class="fit">
            <q-list dense padding>
              <q-item
                v-for="item in activeItems"
                :key="item.id"
                clickable
                :active="item.id === selectedId"
                active-class="text-secondary"
                @click="selectedId = item.id"
              >
                <q-item-section>
                  <q-item-label>{{ item.title }}</q-item-label>
                  <q-item-label v-if="item.caption" caption lines="2">
                    {{ item.caption }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-scroll-area>
        </template>

        <template #after>
          <q-scroll-area class="fit">
            <div v-if="selectedItem" class="openapi-view__detail">
              <div class="row items-center q-gutter-sm">
                <div class="text-subtitle1">{{ selectedItem.title }}</div>
                <q-badge v-if="selectedItem.method" color="primary">
                  {{ selectedItem.method }}
                </q-badge>
                <code v-if="selectedItem.path" class="text-caption">{{ selectedItem.path }}</code>
              </div>
              <div v-if="selectedItem.caption" class="text-body2 text-grey-7 q-mb-md">
                {{ selectedItem.caption }}
              </div>

              <section
                v-for="panel in selectedItem.panels"
                :key="panel.id"
                class="openapi-view__schema-panel"
              >
                <q-separator spaced />
                <div class="row items-center q-gutter-sm q-mb-sm">
                  <q-badge :color="panel.color">{{ panel.title }}</q-badge>
                  <q-badge v-if="panel.required" outline color="secondary">Required</q-badge>
                  <span v-if="panel.contentType" class="text-caption text-grey-7">
                    {{ panel.contentType }}
                  </span>
                </div>
                <div v-if="panel.description" class="text-body2 q-mb-sm">
                  {{ panel.description }}
                </div>
                <ObjectView
                  v-if="panel.schema"
                  :key="panel.id"
                  :model-value="objectViewValue(panel.schema)"
                  :schema="objectViewSchema(panel.schema)"
                  read-only
                  missing-mode="placeholders"
                  :show-missing-indicator="false"
                  :default-expanded-depth="2"
                  schema-documentation
                />
                <div v-else class="text-caption text-grey-7">No response body.</div>
              </section>
            </div>
            <q-banner v-else class="bg-grey-2 text-grey-8">No entries in this section.</q-banner>
          </q-scroll-area>
        </template>
      </q-splitter>
    </template>

    <q-inner-loading :showing="rawLoading" label="Preparing JSON…" />
  </div>
</template>

<script setup lang="ts">
import type { OpenApiJsonSchema, TaskyonOpenApiDocument } from '@taskyon/common/modules/openApi'
import {
  createOpenApiOperationDocumentation,
  resolveOpenApiReferences,
} from '@taskyon/common/modules/openApi'
import {
  matAccountTree,
  matBuild,
  matDataObject,
  matStream,
  matSyncAlt,
} from '@quasar/extras/material-icons'
import { computed, nextTick, ref } from 'vue'
import ObjectView from './varViews/ObjectView.vue'

const props = withDefaults(
  defineProps<{
    document: TaskyonOpenApiDocument
    initialAnchor?: string
  }>(),
  {
    initialAnchor: '',
  },
)

type ApiItem = {
  id: string
  title: string
  caption?: string
  method?: string
  path?: string
  panels: ApiPanel[]
}

type ApiPanel = {
  id: string
  title: string
  color: 'secondary' | 'positive' | 'negative' | 'warning' | 'grey-7'
  description?: string
  contentType?: string
  required?: boolean
  schema?: OpenApiJsonSchema
}

const displaySchema = (value: object): OpenApiJsonSchema => {
  const resolved = resolveOpenApiReferences(props.document, value)
  if (typeof resolved !== 'object' || resolved === null || Array.isArray(resolved)) {
    throw new Error('OpenAPI viewer schemas must resolve to objects.')
  }
  return resolved as OpenApiJsonSchema
}

const responseColor = (status: string): ApiPanel['color'] => {
  if (status.startsWith('2')) return 'positive'
  if (status.startsWith('4') || status.startsWith('5')) return 'negative'
  if (status.startsWith('3')) return 'warning'
  return 'grey-7'
}

const objectViewSchema = (schema: OpenApiJsonSchema): OpenApiJsonSchema =>
  schema.type === 'object'
    ? schema
    : {
        type: 'object',
        properties: { body: schema },
        required: ['body'],
      }

const objectViewValue = (schema: OpenApiJsonSchema): Record<string, unknown> => {
  const example = schema.examples?.[0] ?? schema.default
  if (schema.type === 'object') {
    return typeof example === 'object' && example !== null && !Array.isArray(example)
      ? (example as Record<string, unknown>)
      : {}
  }
  return example === undefined ? {} : { body: example }
}

const operationItems = computed<ApiItem[]>(() =>
  Object.entries(props.document.paths)
    .map(([path, item]) => {
      const operation = createOpenApiOperationDocumentation(props.document, path)
      if (!operation) throw new Error(`Missing OpenAPI operation for ${path}.`)
      return {
        id: `operation-${item.post.operationId.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
        title: operation.operationId,
        ...(operation.summary ? { caption: operation.summary } : {}),
        method: operation.method,
        path: operation.path,
        panels: [
          {
            id: `${operation.operationId}-request`,
            title: 'Request',
            color: 'secondary' as const,
            required: operation.request.required,
            contentType: operation.request.contentType,
            schema: operation.request.schema,
          },
          ...operation.responses.map((response) => ({
            id: `${operation.operationId}-response-${response.status}`,
            title: response.status,
            color: responseColor(response.status),
            description: response.description,
            ...(response.contentType ? { contentType: response.contentType } : {}),
            ...(response.schema ? { schema: response.schema } : {}),
          })),
        ],
      }
    })
    .sort((left, right) => left.title.localeCompare(right.title)),
)

const streamItems = computed<ApiItem[]>(() =>
  Object.entries(props.document['x-taskyon-streams'])
    .flatMap(([stream, messages]) =>
      Object.entries(messages).map(([message, value]) => ({
        id: `stream-${`${stream}.${message}`.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
        title: `${stream}.${message}`,
        panels: [
          {
            id: `${stream}.${message}-message`,
            title: 'Message',
            color: 'secondary' as const,
            schema: displaySchema(value),
          },
        ],
      })),
    )
    .sort((left, right) => left.title.localeCompare(right.title)),
)

const toolItems = computed<ApiItem[]>(() =>
  Object.entries(props.document['x-taskyon-tools'] ?? {})
    .map(([name, value]) => ({
      id: `tool-${name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
      title: name,
      caption: value.description,
      panels: [
        {
          id: `${name}-parameters`,
          title: 'Parameters',
          color: 'secondary' as const,
          schema: displaySchema(value.parameters),
        },
        {
          id: `${name}-result`,
          title: 'Result',
          color: 'positive' as const,
          schema: displaySchema(value.result),
        },
      ],
    }))
    .sort((left, right) => left.title.localeCompare(right.title)),
)

const schemaItems = computed<ApiItem[]>(() =>
  Object.entries(props.document.components.schemas)
    .map(([name, value]) => ({
      id: `schema-${name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
      title: name,
      ...(value.description ? { caption: value.description } : {}),
      panels: [
        {
          id: `${name}-schema`,
          title: 'Schema',
          color: 'secondary' as const,
          schema: displaySchema(value),
        },
      ],
    }))
    .sort((left, right) => left.title.localeCompare(right.title)),
)

const sectionItems = computed(() => ({
  operations: operationItems.value,
  streams: streamItems.value,
  tools: toolItems.value,
  schemas: schemaItems.value,
}))

const initialSection =
  (Object.entries(sectionItems.value).find(([, items]) =>
    items.some((item) => item.id === props.initialAnchor),
  )?.[0] as keyof typeof sectionItems.value | undefined) ?? 'operations'
const activeSection = ref<keyof typeof sectionItems.value>(initialSection)
const selectedId = ref(props.initialAnchor || sectionItems.value[initialSection][0]?.id || '')
const splitter = ref(28)
const showRaw = ref(false)
const rawLoading = ref(false)
const rawViewMode = ref<'tree' | 'flat' | 'json' | 'yaml'>('json')
const rawDocument = computed(() => Object.fromEntries(Object.entries(props.document)))

const waitForPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const minimumRawLoadingTime = () => new Promise<void>((resolve) => setTimeout(resolve, 120))

const toggleRaw = async () => {
  if (showRaw.value) {
    showRaw.value = false
    return
  }

  rawLoading.value = true
  const minimumLoading = minimumRawLoadingTime()
  await nextTick()
  await waitForPaint()
  showRaw.value = true
  await nextTick()
  await waitForPaint()
  await minimumLoading
  rawLoading.value = false
}

const activeItems = computed(() => sectionItems.value[activeSection.value])
const selectedItem = computed(
  () => activeItems.value.find((item) => item.id === selectedId.value) ?? activeItems.value[0],
)
</script>

<style scoped lang="sass">
.openapi-view
  height: 100%
  min-height: 0

.openapi-view__header
  min-height: 68px
  padding: 12px 16px

.openapi-view__tabs
  min-height: 40px

.openapi-view__detail,
.openapi-view__raw
  max-width: 980px
  padding: 20px

@media (max-width: 720px)
  .openapi-view__tabs :deep(.q-tab__label)
    display: none

  .openapi-view :deep(.q-splitter)
    display: flex
    flex-direction: column

  .openapi-view :deep(.q-splitter__before),
  .openapi-view :deep(.q-splitter__after)
    width: 100% !important
    height: 45%

  .openapi-view :deep(.q-splitter__separator)
    display: none
</style>
