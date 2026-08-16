<template>
  <section class="dag-node-viewer column no-wrap">
    <header class="dag-node-viewer__header row items-center no-wrap">
      <div class="dag-node-viewer__heading row items-center no-wrap">
        <div class="ellipsis">
          <div class="dag-node-viewer__title ellipsis">{{ label }}</div>
          <div v-if="path" class="dag-node-viewer__path ellipsis">{{ path }}</div>
        </div>
        <q-btn
          v-if="allowRename"
          flat
          round
          dense
          size="sm"
          :icon="matEdit"
          aria-label="Rename node"
          @click="emit('rename')"
        >
          <q-tooltip>Rename node</q-tooltip>
        </q-btn>
      </div>
      <q-space />
      <q-chip v-if="activeOutput" dense square color="positive" text-color="white">
        Study output
      </q-chip>
      <q-chip v-if="localName" dense square outline color="secondary">
        {{ localName }}
      </q-chip>
      <q-chip v-if="hash" dense square outline :title="hash">
        {{ compactHash }}
      </q-chip>
      <q-btn
        v-if="allowSave"
        flat
        round
        dense
        :icon="matSave"
        :disable="!canSaveActiveView"
        aria-label="Save node"
        @click="emit('save', activeView)"
      >
        <q-tooltip>Save node</q-tooltip>
      </q-btn>
      <q-btn
        v-if="allowCreateNode"
        flat
        round
        dense
        :icon="matAdd"
        aria-label="Create node"
        @click="emit('createNode')"
      >
        <q-tooltip>Create node</q-tooltip>
      </q-btn>
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
            <q-item-label header class="row items-center no-wrap">
              <span>Inputs</span>
              <q-space />
              <q-btn
                v-if="allowEditRelationships"
                flat
                round
                dense
                :icon="matLink"
                aria-label="Connect existing input node"
                @click="emit('addInput')"
              >
                <q-tooltip>Connect existing upstream node</q-tooltip>
              </q-btn>
              <q-btn
                v-if="allowEditRelationships"
                flat
                dense
                no-caps
                :icon="matAdd"
                label="New"
                aria-label="Create upstream input node"
                @click="emit('createInput')"
              >
                <q-tooltip>Create and connect upstream node</q-tooltip>
              </q-btn>
            </q-item-label>
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
            <q-item-label header class="row items-center no-wrap">
              <span>Outputs</span>
              <q-space />
              <q-btn
                v-if="allowEditRelationships"
                flat
                round
                dense
                :icon="matLink"
                aria-label="Connect existing output node"
                @click="emit('addOutput')"
              >
                <q-tooltip>Connect existing downstream node</q-tooltip>
              </q-btn>
              <q-btn
                v-if="allowEditRelationships"
                flat
                dense
                no-caps
                :icon="matAdd"
                label="New"
                aria-label="Create downstream output node"
                @click="emit('createOutput')"
              >
                <q-tooltip>Create and connect downstream node</q-tooltip>
              </q-btn>
            </q-item-label>
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
          <q-tab name="source" :icon="matCode" label="Run function" />
          <q-tab v-if="showRawSource" name="raw" :icon="matDescription" label="Raw TS" />
          <q-tab v-if="showModules" name="modules" :icon="matExtension" label="Modules" />
          <q-tab
            v-if="showDependencies"
            name="dependencies"
            :icon="matInventory2"
            label="Dependencies"
          />
          <q-tab v-if="showCompiled" name="compiled" :icon="matBuild" label="Compiled" />
          <q-tab name="inputs" :icon="matInput" label="Inputs" />
          <q-tab name="output" :icon="matOutput" label="Output" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="activeView" animated class="col">
          <q-tab-panel name="source" class="q-pa-none">
            <div v-if="sourceNotice" class="dag-node-viewer__source-notice q-pa-md">
              <q-icon :name="matInfo" size="sm" />
              <div>
                <strong>{{ sourceNotice.title }}</strong>
                <div class="text-caption">{{ sourceNotice.message }}</div>
              </div>
            </div>
            <CodeEditor
              v-else
              v-model="source"
              language="typescript"
              :read-only="readOnly"
              class="fit"
            />
          </q-tab-panel>
          <q-tab-panel v-if="showRawSource" name="raw" class="q-pa-none">
            <CodeEditor
              v-model="rawSource"
              language="typescript"
              :read-only="readOnly"
              class="fit"
            />
          </q-tab-panel>
          <q-tab-panel v-if="showModules" name="modules" class="q-pa-none">
            <div v-if="modulesLoading" class="dag-node-viewer__empty row items-center q-gutter-sm">
              <q-spinner size="sm" />
              <span>Loading locked modules…</span>
            </div>
            <div v-else-if="modules.length > 0" class="dag-node-viewer__modules">
              <q-scroll-area class="dag-node-viewer__module-list">
                <q-list dense separator>
                  <q-item
                    v-for="module in modules"
                    :key="module.id"
                    clickable
                    :active="module.id === selectedModuleId"
                    @click="selectModule(module)"
                  >
                    <q-item-section>
                      <q-item-label lines="1">{{ moduleLabel(module) }}</q-item-label>
                      <q-item-label caption lines="2">
                        {{ module.references.map(({ specifier }) => specifier).join(', ') }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section v-if="!module.editable" side>
                      <q-chip dense square>Package</q-chip>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-scroll-area>
              <div class="dag-node-viewer__module-source column no-wrap">
                <div v-if="selectedModule" class="dag-node-viewer__module-heading ellipsis">
                  {{ selectedModule.mediaType }} · {{ compactModuleHash }}
                </div>
                <CodeEditor
                  v-if="selectedModule"
                  v-model="moduleSource"
                  language="typescript"
                  :read-only="readOnly || !selectedModule.editable"
                  class="col"
                />
              </div>
            </div>
            <div v-else class="dag-node-viewer__empty">This node has no locked module imports.</div>
          </q-tab-panel>
          <q-tab-panel v-if="showDependencies" name="dependencies" class="q-pa-none">
            <q-scroll-area class="fit">
              <q-list v-if="dependencies.length > 0" dense separator>
                <q-item v-for="dependency in dependencies" :key="dependency.name">
                  <q-item-section>
                    <q-item-label>{{ dependency.name }}</q-item-label>
                    <q-item-label caption>Required range: {{ dependency.range }}</q-item-label>
                  </q-item-section>
                  <q-item-section v-if="allowUpdateDependencies" side>
                    <q-btn
                      flat
                      round
                      dense
                      :icon="matEdit"
                      :aria-label="`Update ${dependency.name} requirement`"
                      @click="emit('updateDependency', dependency.name, dependency.range)"
                    >
                      <q-tooltip>Update package requirement</q-tooltip>
                    </q-btn>
                  </q-item-section>
                </q-item>
              </q-list>
              <div v-else class="dag-node-viewer__empty">
                This node has no third-party package requirements.
              </div>
            </q-scroll-area>
          </q-tab-panel>
          <q-tab-panel v-if="showCompiled" name="compiled" class="q-pa-none">
            <div v-if="compiledLoading" class="dag-node-viewer__empty row items-center q-gutter-sm">
              <q-spinner size="sm" />
              <span>Loading compiled artifact…</span>
            </div>
            <div v-else-if="compiledArtifact" class="dag-node-viewer__compiled column no-wrap">
              <div class="dag-node-viewer__artifact-heading row items-center q-gutter-md">
                <span>{{ compiledArtifact.compilerAbi }}</span>
                <span>{{ compiledArtifact.outputBytes }} bytes</span>
                <span>{{ compiledArtifact.packages.length }} packages</span>
              </div>
              <CodeEditor
                :model-value="compiledArtifact.code"
                language="javascript"
                read-only
                class="col"
              />
            </div>
            <div v-else class="dag-node-viewer__empty">
              <p v-if="compiledSourceDirty">
                Save the edited source before compiling its immutable artifact.
              </p>
              <p v-else>No cached artifact exists for this node source.</p>
              <q-btn
                outline
                no-caps
                :icon="matBuild"
                label="Compile artifact"
                :disable="compiledSourceDirty"
                @click="emit('compileArtifact')"
              />
            </div>
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
import type { StoredDagPackageName } from '@taskyon/comp-dag/dagModule'
import type { RouteLocationRaw } from 'vue-router'

export type DagNodeNavigationItem = {
  id: string
  label: string
  caption?: string | undefined
}

export type DagNodeModuleItem = {
  id: string
  mediaType: 'application/javascript' | 'text/typescript'
  source: string
  editable: boolean
  references: Array<{ referrer: string; specifier: string }>
}

export type DagNodeDependencyItem = {
  name: StoredDagPackageName
  range: string
}

export type DagNodeCompiledArtifactView = {
  compilerAbi: string
  outputBytes: number
  packages: ReadonlyArray<{ name: string; version: string; integrity: string }>
  code: string
}

export type DagNodeView =
  | 'source'
  | 'raw'
  | 'modules'
  | 'dependencies'
  | 'compiled'
  | 'inputs'
  | 'output'
</script>

<script setup lang="ts">
import {
  matAdd,
  matBuild,
  matCode,
  matDescription,
  matEdit,
  matInfo,
  matInput,
  matInventory2,
  matExtension,
  matLink,
  matOpenInNew,
  matOutput,
  matSave,
} from '@quasar/extras/material-icons'
import type { DagJsonSchema } from '@taskyon/comp-dag/dagSchema'
import type { JSONSchema7 } from 'json-schema'
import { computed } from 'vue'
import CodeEditor from './CodeEditor.vue'
import ObjectView from './varViews/ObjectView.vue'

const source = defineModel<string>({ required: true })
const rawSource = defineModel<string>('rawSource', { default: '' })
const selectedModuleId = defineModel<string>('selectedModuleId', { default: '' })
const moduleSource = defineModel<string>('moduleSource', { default: '' })
const activeView = defineModel<DagNodeView>('view', {
  default: 'source',
})
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
    activeOutput?: boolean
    allowCreateNode?: boolean
    allowRename?: boolean
    allowEditRelationships?: boolean
    allowSave?: boolean
    showRawSource?: boolean
    showModules?: boolean
    showDependencies?: boolean
    showCompiled?: boolean
    allowUpdateDependencies?: boolean
    modules?: DagNodeModuleItem[]
    modulesLoading?: boolean
    dependencies?: DagNodeDependencyItem[]
    compiledArtifact?: DagNodeCompiledArtifactView | null
    compiledLoading?: boolean
    compiledSourceDirty?: boolean
    sourceNotice?: { title: string; message: string } | undefined
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
    activeOutput: false,
    allowCreateNode: false,
    allowRename: false,
    allowEditRelationships: false,
    allowSave: false,
    showRawSource: false,
    showModules: false,
    showDependencies: false,
    showCompiled: false,
    allowUpdateDependencies: false,
    modules: () => [],
    modulesLoading: false,
    dependencies: () => [],
    compiledArtifact: null,
    compiledLoading: false,
    compiledSourceDirty: false,
    sourceNotice: undefined,
  },
)
const emit = defineEmits<{
  selectNode: [id: string]
  createNode: []
  rename: []
  addInput: []
  createInput: []
  addOutput: []
  createOutput: []
  save: [view: DagNodeView]
  compileArtifact: []
  updateDependency: [name: StoredDagPackageName, range: string]
}>()

const compactHash = computed(() =>
  props.hash.length > 21 ? `${props.hash.slice(0, 13)}…${props.hash.slice(-5)}` : props.hash,
)
const hasNavigation = computed(
  () => props.showNavigation || props.upstreamNodes.length > 0 || props.downstreamNodes.length > 0,
)
const selectedModule = computed(() => props.modules.find(({ id }) => id === selectedModuleId.value))
const compactModuleHash = computed(() => {
  const id = selectedModule.value?.id ?? ''
  return id.length > 21 ? `${id.slice(0, 13)}…${id.slice(-5)}` : id
})
const canSaveActiveView = computed(
  () =>
    activeView.value !== 'inputs' &&
    activeView.value !== 'output' &&
    activeView.value !== 'dependencies' &&
    activeView.value !== 'compiled' &&
    (activeView.value !== 'modules' || selectedModule.value?.editable === true),
)
const moduleLabel = (module: DagNodeModuleItem) =>
  module.references.find(({ referrer }) => referrer === '$node')?.specifier ??
  module.references[0]?.specifier ??
  module.id
const selectModule = (module: DagNodeModuleItem) => {
  selectedModuleId.value = module.id
  moduleSource.value = module.source
}
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

.dag-node-viewer__heading {
  min-width: 0;
  gap: 0.15rem;
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

.dag-node-viewer__modules {
  display: grid;
  grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.dag-node-viewer__module-list {
  min-height: 0;
  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.dag-node-viewer__module-source {
  min-width: 0;
  min-height: 0;
}

.dag-node-viewer__module-heading {
  flex: 0 0 auto;
  padding: 0.45rem 0.65rem;
  font-family: monospace;
  font-size: 0.68rem;
}

.dag-node-viewer__source-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}

.dag-node-viewer__compiled {
  height: 100%;
  min-height: 0;
}

.dag-node-viewer__artifact-heading {
  flex: 0 0 auto;
  padding: 0.45rem 0.65rem;
  font-family: monospace;
  font-size: 0.68rem;
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

  .dag-node-viewer__modules {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(6rem, 25%) minmax(0, 1fr);
  }

  .dag-node-viewer__module-list {
    border-right: 0;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
}
</style>
