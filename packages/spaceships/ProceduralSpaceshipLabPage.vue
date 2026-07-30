<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page class="spaceship-lab q-pa-xs">
        <div class="spaceship-lab__hero q-mb-xs">
          <div>
            <div class="text-h4 text-weight-bold">Procedural Spaceship Lab</div>
            <div class="text-subtitle1 spaceship-lab__subtitle">
              Modules, SVG skins, and generation tuning in one place.
            </div>
          </div>
        </div>

        <DockView v-model:node="dockLayout" class="spaceship-lab__dock" hide-tab-add>
          <template #Modules>
            <div class="q-pa-xs spaceship-lab__panel">
              <div class="spaceship-lab__module-list q-mb-xs">
                <q-btn
                  v-for="(module, index) in state.moduleCatalog"
                  :key="module.id || index"
                  dense
                  padding="xs"
                  :outline="state.selectedModuleIndex !== index"
                  :color="state.selectedModuleIndex === index ? 'primary' : 'grey-7'"
                  class="spaceship-lab__module-button"
                  @click="selectModule(index)"
                  @mouseenter="state.preview.focusedModuleId = module.id"
                  @mouseleave="state.preview.focusedModuleId = ''"
                >
                  <span class="spaceship-lab__module-mini-list">
                    <SanitizedMarkup
                      v-for="variant in moduleMiniIconSvgs(module)"
                      :key="`${module.id}-${variant.name}-icon`"
                      tag="span"
                      class="spaceship-lab__module-mini-icon"
                      :markup="variant.svg"
                      :sanitize="sanitizeSvgMarkup"
                    />
                  </span>
                  <q-tooltip>{{ module.id || `module-${index + 1}` }}</q-tooltip>
                </q-btn>
              </div>

              <template v-if="selectedModule">
                <q-expansion-item
                  dense
                  dense-toggle
                  switch-toggle-side
                  :icon="matTune"
                  label="Module properties"
                  header-class="q-pa-xs"
                  class="q-mb-xs"
                >
                  <div class="q-pt-xs">
                    <ObjectView
                      v-model="selectedModuleMetadata"
                      :schema="moduleDefinitionJsonSchema"
                      missing-mode="placeholders"
                      show-missing-indicator
                      show-missing-mode-select
                      allow-object-structure-editing
                    />
                  </div>
                </q-expansion-item>

                <div>
                  <div class="row q-gutter-xs q-mb-xs">
                    <q-btn
                      v-for="entry in MODULE_CELL_PALETTE"
                      :key="entry.label"
                      dense
                      :outline="state.activePaintCell !== entry.value"
                      :color="state.activePaintCell === entry.value ? 'primary' : 'grey-7'"
                      @click="state.activePaintCell = entry.value"
                    >
                      {{ entry.label }}
                    </q-btn>
                  </div>

                  <div class="row items-center q-col-gutter-xs q-mb-xs">
                    <div class="col">
                      <q-input
                        v-model.number="patternSize.width"
                        dense
                        outlined
                        type="number"
                        label="X"
                        min="1"
                      />
                    </div>
                    <div class="col-auto text-h6">×</div>
                    <div class="col">
                      <q-input
                        v-model.number="patternSize.height"
                        dense
                        outlined
                        type="number"
                        label="Y"
                        min="1"
                      />
                    </div>
                    <div class="col-12">
                      <div class="row q-gutter-xs q-mt-xs">
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Apply size"
                          @click="applyPatternSize"
                        />
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Trim Empty Border"
                          @click="trimSelectedPattern"
                        />
                        <q-btn
                          dense
                          flat
                          color="negative"
                          label="Delete Module"
                          @click="removeSelectedModule"
                        />
                      </div>
                    </div>
                  </div>

                  <div class="spaceship-lab__pattern-grid-2d">
                    <div
                      v-for="(row, y) in selectedModule.pattern"
                      :key="`row-${y}`"
                      class="spaceship-lab__pattern-row"
                    >
                      <button
                        v-for="(cell, x) in row"
                        :key="`${x}-${y}`"
                        type="button"
                        class="spaceship-lab__pattern-cell"
                        :class="cellClass(cell)"
                        @click="paintCell(x, y)"
                      >
                        {{ cellLabel(cell) }}
                      </button>
                    </div>
                  </div>

                  <div class="q-mt-xs" />
                  <q-file
                    :model-value="null"
                    dense
                    outlined
                    accept="image/svg+xml"
                    label="Upload SVG"
                    @update:model-value="uploadModuleSvg"
                  />
                  <div class="row q-col-gutter-xs q-mt-xs q-mb-xs">
                    <div class="col-12 col-sm-5">
                      <div class="row q-gutter-xs">
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Fit SVG to Grid"
                          @click="fitModuleSvgToGrid"
                        />
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Fit Boundary"
                          @click="fitModuleSvgToBoundary"
                        />
                      </div>
                    </div>
                    <div class="col-7 col-sm-3">
                      <q-select
                        v-model="state.svgEditor.variantName"
                        dense
                        outlined
                        emit-value
                        map-options
                        :options="svgEditorVariantOptions"
                        label="Variant"
                      />
                    </div>
                    <div class="col-12 col-sm-2">
                      <q-btn
                        dense
                        flat
                        color="primary"
                        label="Add Variant"
                        @click="addSvgVariant"
                      />
                    </div>
                    <div class="col-12 col-sm-2">
                      <q-btn
                        dense
                        flat
                        color="negative"
                        label="Remove Variant"
                        :disable="!selectedModule || moduleVariantNames(selectedModule).length <= 1"
                        @click="removeActiveSvgVariant"
                      />
                    </div>
                    <div class="col-7 col-sm-3">
                      <q-select
                        v-model="selectedModuleSvgVariantCategory"
                        dense
                        outlined
                        use-input
                        fill-input
                        hide-selected
                        input-debounce="0"
                        emit-value
                        map-options
                        :options="svgVariantCategoryOptions"
                        label="Variant Category"
                        @new-value="onNewSvgVariantCategory"
                      />
                    </div>
                    <div class="col-5 col-sm-2">
                      <q-input
                        v-model.number="state.svgEditor.rotation"
                        dense
                        outlined
                        type="number"
                        min="0"
                        max="3"
                        label="Rotate SVG"
                      />
                    </div>
                    <div class="col-12 col-sm-2 flex items-center">
                      <q-btn
                        dense
                        flat
                        color="primary"
                        label="Export SVG"
                        @click="exportSelectedModuleSvg"
                      />
                    </div>
                    <div class="col-6 col-sm-3">
                      <q-input
                        v-model.number="selectedModuleSvgScaleX"
                        dense
                        outlined
                        type="number"
                        step="0.05"
                        min="0.05"
                        label="Scale X"
                      />
                    </div>
                    <div class="col-6 col-sm-3">
                      <q-input
                        v-model.number="selectedModuleSvgScaleY"
                        dense
                        outlined
                        type="number"
                        step="0.05"
                        min="0.05"
                        label="Scale Y"
                      />
                    </div>
                    <div class="col-6 col-sm-3">
                      <q-input
                        v-model.number="selectedModuleSvgOffsetX"
                        dense
                        outlined
                        type="number"
                        step="0.1"
                        label="Offset X"
                      />
                    </div>
                    <div class="col-6 col-sm-3">
                      <q-input
                        v-model.number="selectedModuleSvgOffsetY"
                        dense
                        outlined
                        type="number"
                        step="0.1"
                        label="Offset Y"
                      />
                    </div>
                    <div class="col-12">
                      <div class="row q-gutter-xs">
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Center Horizontally"
                          @click="centerAlignModuleSvgX"
                        />
                        <q-btn
                          dense
                          flat
                          color="primary"
                          label="Center Vertically"
                          @click="centerAlignModuleSvgY"
                        />
                      </div>
                    </div>
                  </div>
                  <q-input
                    v-model="selectedModuleSvgMarkup"
                    type="textarea"
                    autogrow
                    outlined
                    dense
                    class="q-mt-xs"
                    label="SVG markup"
                  />
                  <div class="text-caption text-grey-7 q-mt-xs">
                    Materials: use tokens/classes like <code>material:c1</code>,
                    <code>material:c2</code>, <code>material:c3</code>, <code>material:c4</code>,
                    <code>material:window</code>, <code>material:thruster</code>,
                    <code>material:thrusterGlow</code>, <code>mat-window</code>,
                    <code>mat-thruster</code>.
                  </div>
                  <div
                    ref="moduleSvgPreviewHost"
                    class="spaceship-lab__module-svg-preview q-mt-xs"
                    @mousedown="beginModuleSvgDrag"
                  >
                    <SanitizedMarkup :markup="moduleSvgPreview" :sanitize="sanitizeSvgMarkup" />
                  </div>
                </div>
              </template>
            </div>
          </template>

          <template #Overview>
            <div class="q-pa-xs spaceship-lab__panel">
              <div class="spaceship-lab__overview-list">
                <button
                  v-for="(module, index) in state.moduleCatalog"
                  :key="`${module.id}-${index}-overview`"
                  type="button"
                  class="spaceship-lab__overview-item"
                  @click="openModuleFromOverview(index)"
                >
                  <div class="spaceship-lab__overview-pattern">
                    <div
                      v-for="(row, y) in module.pattern"
                      :key="`${module.id}-row-${y}`"
                      class="spaceship-lab__pattern-row"
                    >
                      <div
                        v-for="(cell, x) in row"
                        :key="`${module.id}-${x}-${y}`"
                        class="spaceship-lab__overview-cell"
                        :class="cellClass(cell)"
                      />
                    </div>
                  </div>
                  <div class="spaceship-lab__overview-svg-list">
                    <SanitizedMarkup
                      v-for="variant in moduleOverviewSvgs(module)"
                      :key="`${module.id}-${variant.name}-overview`"
                      class="spaceship-lab__overview-svg"
                      :markup="variant.svg"
                      :sanitize="sanitizeSvgMarkup"
                    />
                  </div>
                </button>
              </div>
            </div>
          </template>

          <template #Library>
            <div class="q-pa-xs spaceship-lab__panel">
              <ObjectView
                v-model="libraryMetadata"
                :schema="libraryDefinitionJsonSchema"
                copy-object-btn
                enable-expert-mode
                show-missing-indicator
                show-missing-mode-select
                missing-mode="placeholders"
                allow-object-structure-editing
              />
            </div>
          </template>

          <template #LivePreview>
            <div class="spaceship-live q-pa-xs">
              <div class="row items-center q-gutter-xs q-mb-sm">
                <q-input
                  v-model="state.preview.seedText"
                  class="col"
                  outlined
                  dense
                  placeholder="Seed"
                />
                <q-btn
                  dense
                  flat
                  color="primary"
                  label="Configure Library"
                  @click="focusLibraryTab"
                />
                <q-btn dense flat color="primary" label="Add Module" @click="addModule" />
                <q-btn dense flat color="primary" label="Copy PNG" @click="copyPrimaryPreviewPng" />
                <q-btn dense flat color="primary" label="Export" @click="exportLibraryJson" />
                <q-btn dense flat color="primary" label="Import" @click="importLibraryJson" />
                <q-btn dense flat color="primary" label="Reset" @click="resetCatalog" />
                <ToggleButton
                  v-model="state.preview.debugBounds"
                  dense
                  flat
                  color="primary"
                  label="Debug"
                />
                <ToggleButton
                  v-model="state.preview.debugGeneration"
                  dense
                  flat
                  color="primary"
                  label="Gen Debug"
                />
                <q-input
                  v-model.number="state.preview.proofCount"
                  dense
                  outlined
                  type="number"
                  min="1"
                  step="1"
                  style="width: 132px"
                  label="# Proof Seeds"
                />
                <q-input
                  v-model.number="state.preview.maxGlobalRewinds"
                  dense
                  outlined
                  type="number"
                  min="1"
                  step="1"
                  style="width: 148px"
                  label="Max Rewinds"
                />
                <q-btn
                  dense
                  flat
                  color="primary"
                  :loading="proofRun.running"
                  label="Proof Config"
                  @click="runProofBatch"
                />
                <ToggleButton v-model="cachingEnabled" dense flat color="primary" label="Caching" />
                <q-btn dense flat color="primary" label="Reset Cache" @click="resetPreviewCache" />
                <q-btn dense outline color="primary" label="Back" to="/diagnostics" />
              </div>

              <div class="spaceship-live__canvas">
                <div class="flex flex-center">
                  <div class="spaceship-live__ship-wrap">
                    <ProceduralSpaceship
                      :storage-client="props.storageClient"
                      :seed-text="state.preview.seedText"
                      :library="libraryMetadata"
                      :size="320"
                      :render-mode="state.preview.disableCache ? 'svg-only' : 'png-first'"
                      :disable-cache="state.preview.disableCache"
                      :debug-bounds="state.preview.debugBounds"
                      :max-global-rewinds="state.preview.maxGlobalRewinds"
                      :catalog-version="state.catalogVersion"
                    />
                    <svg
                      v-if="focusedPreviewRects.length"
                      class="spaceship-live__focus-overlay"
                      :viewBox="`${primaryPreviewCrop.x} ${primaryPreviewCrop.y} ${primaryPreviewCrop.w} ${primaryPreviewCrop.h}`"
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                    >
                      <rect
                        v-for="rect in focusedPreviewRects"
                        :key="rect.id"
                        :x="rect.x"
                        :y="rect.y"
                        :width="rect.w"
                        :height="rect.h"
                        fill="none"
                        stroke="#ffd166"
                        :stroke-width="state.preview.debugBounds ? 2.6 : 2"
                        :opacity="state.preview.debugBounds ? 0.95 : 0.78"
                      />
                    </svg>
                  </div>
                </div>
                <div class="spaceship-live__stats text-caption">
                  <div><strong>symmetry</strong> {{ primaryScene.summary.symmetryLabel }}</div>
                  <div><strong>modules</strong> {{ primaryScene.stats.moduleCount }}</div>
                  <div><strong>placed by category</strong></div>
                  <div
                    v-for="entry in primaryPlacedCategoryCounts"
                    :key="entry.category"
                    class="spaceship-live__stat-row"
                  >
                    <span>{{ entry.category }}</span>
                    <span>{{ entry.count }}</span>
                  </div>
                  <div v-if="!primaryPlacedCategoryCounts.length" class="spaceship-live__stat-row">
                    <span>none</span>
                    <span>0</span>
                  </div>
                  <div>
                    <strong>bounds</strong> {{ formatBounds(primaryScene.stats.occupiedBounds) }}
                  </div>
                  <template v-if="state.preview.debugGeneration">
                    <div><strong>generator debug</strong></div>
                    <div v-if="!primaryDebugUnresolvedCategories.length">
                      all requested categories placed
                    </div>
                    <div
                      v-for="entry in primaryDebugUnresolvedCategories"
                      :key="`debug-missing-${entry.stage}-${entry.category}`"
                      class="spaceship-live__stat-row"
                    >
                      <span>{{ entry.category }} (stage {{ entry.stage }})</span>
                      <span>{{ entry.placed }}/{{ entry.requested }}</span>
                    </div>
                    <div
                      v-for="report in primaryDebugStageReports"
                      :key="`debug-stop-${report.stage}`"
                    >
                      stage {{ report.stage }}: {{ formatStopReason(report.stopReason) }}
                      <span v-if="report.blockedCategories.length">
                        ({{ report.blockedCategories.join(', ') }})
                      </span>
                      <span>
                        - mode={{ report.selectionMode
                        }}{{ report.useVariantWeights ? '+variantWeights' : '' }}, search={{
                          report.searchNodes ?? 0
                        }}, backtracks={{ report.backtracks ?? 0 }}/{{
                          report.globalMaxRewinds ?? 0
                        }}, retries={{ Math.max(0, (report.stageRunCount ?? 1) - 1) }}, rewinds={{
                          report.crossStageRewinds ?? 0
                        }}{{ report.fellBackToGreedy ? ', greedy-fallback' : '' }},
                        stuckAtModules={{ report.stuckAtPlacementCount ?? 0 }}
                      </span>
                      <div>
                        duplicateInputs={{ report.duplicateInputStates ?? 0 }}, rewindTargetStage={{
                          report.lastRewindTargetStage ?? 'none'
                        }}, added={{ report.addedPlacementCount ?? 0 }}
                      </div>
                      <div v-if="(report.addedModules ?? []).length">
                        added modules:
                        {{
                          (report.addedModules ?? [])
                            .map(
                              (entry) =>
                                `${entry.moduleId}@(${entry.x},${entry.y}) [${entry.category}]`,
                            )
                            .join(', ')
                        }}
                      </div>
                      <div
                        v-for="diag in report.candidateDiagnostics ?? []"
                        :key="`diag-${report.stage}-${diag.category}`"
                      >
                        {{ diag.category }}: req={{ diag.requested }}, placed={{ diag.placed }},
                        tiles={{ diag.tileCount }}, candidates={{ diag.candidateCount }}, tried={{
                          diag.attemptedCandidates
                        }}, tested={{ diag.testedPositions ?? 0 }}
                        <span v-if="formatRejectionReasons(diag.rejectionReasons)">
                          , rejected={{ formatRejectionReasons(diag.rejectionReasons) }}
                        </span>
                      </div>
                    </div>
                  </template>
                  <div><strong>proof</strong> {{ proofStatusLine }}</div>
                </div>
              </div>
            </div>
          </template>

          <template #PreviewGallery>
            <div
              ref="galleryScrollHost"
              class="spaceship-gallery q-pa-xs"
              @scroll.passive="onGalleryScroll"
            >
              <div class="spaceship-lab__preview-grid">
                <div
                  v-for="entry in galleryEntries"
                  :key="entry.id"
                  class="spaceship-lab__preview-card"
                  @click="state.preview.seedText = entry.seedText"
                >
                  <ProceduralSpaceship
                    :storage-client="props.storageClient"
                    :seed-text="entry.seedText"
                    :library="libraryMetadata"
                    :size="118"
                    :render-mode="state.preview.disableCache ? 'svg-only' : 'png-first'"
                    :disable-cache="state.preview.disableCache"
                    :debug-bounds="false"
                    :max-global-rewinds="state.preview.maxGlobalRewinds"
                    :catalog-version="state.catalogVersion"
                  />
                </div>
              </div>
            </div>
          </template>
        </DockView>
        <input
          ref="libraryImportInput"
          type="file"
          accept="application/json,.json"
          class="spaceship-lab__hidden-input"
          @change="onImportLibraryFile"
        />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { z } from 'zod'
import ProceduralSpaceship from './ProceduralSpaceshipIdenticon.vue'
import type { DockNode } from '@taskyon/ui/components/dockLayout'
import DockView from '@taskyon/ui/components/DockView.vue'
import {
  COCKPIT,
  DEFAULT_LIBRARY_ALGORITHM,
  DEFAULT_MODULE_LIBRARY,
  IGNORE,
  MODULE_CELL_PALETTE,
  SPACESHIP_SEED_COMPONENTS,
  SPACE,
  STAY_AWAY,
  THRUSTER,
  WING,
  HULL,
  applyMaterialPaletteToMarkup,
  cloneModuleLibrary,
  createMaterialPalette,
  createModuleCatalogEntry,
  createSpaceshipScene,
  resizePattern,
  sanitizeModuleSvgMarkup,
} from './proceduralSpaceship'
import {
  IDENTICON_SIZE_MAX,
  IDENTICON_SIZE_MIN,
  gridSizeConfigSchema,
  spaceshipAlgorithmConfigSchema,
  spaceshipLibrarySchema,
  spaceshipModuleDefinitionSchema,
  stagesConfigSchema,
  type CellValue,
  type GridSizeConfig,
  type ModuleCategory,
  type SpaceshipLibraryFile,
  type SpaceshipModuleDefinition,
  type SpaceshipSvgVariantDefinition,
  type StagesConfig,
  type SvgTransformConfig,
} from './spaceshipSchemas'
import { clearSpaceshipImageCache, getSpaceshipImage } from './spaceshipIdenticonCache'
import { syncStateWithStorageClient } from '@taskyon/ui/modules/storageState'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import SanitizedMarkup from '@taskyon/ui/components/SanitizedMarkup.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import ToggleButton from '@taskyon/ui/components/ToggleButton.vue'
import { matTune } from '@quasar/extras/material-icons'
import { sanitizeSvgMarkup } from '@taskyon/common/modules/sanitizeMarkup'

type GalleryEntry = {
  id: string
  seedText: string
}

const props = defineProps<{ storageClient: TaskyonStorageClient }>()

const DEFAULT_SVG_VARIANT_NAME = 'primary'
const moduleDefinitionJsonSchema = z.toJSONSchema(spaceshipModuleDefinitionSchema, {
  unrepresentable: 'any',
})
const libraryDefinitionJsonSchema = z.toJSONSchema(spaceshipLibrarySchema, {
  unrepresentable: 'any',
})

const batchSize = 10
const initialGalleryBatchSize = 12
const maxGalleryEntries = 20
const galleryLoadOffsetPx = 160
const DEBUG_SPACESHIP_LAB = true
const DEFAULT_ALGORITHM = spaceshipAlgorithmConfigSchema.parse(DEFAULT_LIBRARY_ALGORITHM)
const defaultStagesJson = JSON.stringify(DEFAULT_ALGORITHM.stages, null, 2)
const defaultGridSizeJson = JSON.stringify(DEFAULT_ALGORITHM.gridSize, null, 2)
const state = reactive({
  moduleCatalog: [] as SpaceshipModuleDefinition[],
  selectedModuleIndex: 0,
  activePaintCell: HULL as CellValue,
  preview: {
    seedText: createSeedString(0),
    disableCache: true,
    debugBounds: false,
    debugGeneration: false,
    symmetry: DEFAULT_ALGORITHM.symmetry,
    focusedModuleId: '',
    gridSizeJson: defaultGridSizeJson,
    stagesJson: defaultStagesJson,
    identiconSize: DEFAULT_ALGORITHM.identiconSize,
    randomSvgColors: DEFAULT_ALGORITHM.randomSvgColors,
    showBackground: DEFAULT_ALGORITHM.showBackground,
    showStars: DEFAULT_ALGORITHM.showStars,
    proofCount: 1000,
    maxGlobalRewinds: 2,
  },
  svgEditor: {
    rotation: 0,
    variantName: DEFAULT_SVG_VARIANT_NAME,
  },
  catalogVersion: 0,
})

const proofRun = reactive({
  running: false,
  requested: 0,
  completed: 0,
  failed: 0,
  firstFailedSeed: '',
  durationMs: 0,
  totalRewinds: 0,
  maxRewindsPerShip: 0,
  timestamp: 0,
})

void syncStateWithStorageClient(
  props.storageClient,
  { namespace: 'spaceships/lab', id: 'procedural-spaceship-lab' },
  state,
)

if (!state.moduleCatalog.length)
  state.moduleCatalog.splice(0, 0, ...cloneModuleLibrary(DEFAULT_MODULE_LIBRARY))
sanitizeCatalogSvgMarkup(state.moduleCatalog)
const parsedStages = computed<StagesConfig>(() => {
  const parsed = JSON.parse(state.preview.stagesJson) as unknown
  return stagesConfigSchema.parse(parsed)
})
const parsedGridSize = computed<GridSizeConfig>(() => {
  const parsed = JSON.parse(state.preview.gridSizeJson) as unknown
  return gridSizeConfigSchema.parse(parsed)
})

const nextIndex = ref(0)
const dockLayout = ref<DockNode>({
  id: 'spaceship-lab-dock-root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'spaceship-catalog',
      type: 'leaf',
      size: 48,
      views: ['Modules', 'Overview', 'Library'],
      activeViewIndex: 0,
    },
    {
      id: 'spaceship-preview',
      type: 'container',
      size: 52,
      direction: 'column',
      children: [
        {
          id: 'spaceship-preview-main',
          type: 'leaf',
          size: 58,
          views: ['LivePreview'],
          showTabs: 'never',
          activeViewIndex: 0,
        },
        {
          id: 'spaceship-preview-gallery',
          type: 'leaf',
          size: 42,
          views: ['PreviewGallery'],
          showTabs: 'never',
          activeViewIndex: 0,
        },
      ],
    },
  ],
})

const libraryImportInput = ref<HTMLInputElement | null>(null)
const moduleSvgPreviewHost = ref<HTMLElement | null>(null)
const galleryScrollHost = ref<HTMLElement | null>(null)
const galleryEntries = ref<GalleryEntry[]>([])
const galleryLoadInProgress = ref(false)
const catalogFingerprint = ref('')
const selectedModule = computed(() => state.moduleCatalog[state.selectedModuleIndex] ?? null)
const patternSize = reactive({
  width: selectedModule.value?.pattern[0]?.length ?? 5,
  height: selectedModule.value?.pattern.length ?? 5,
})

function computeCatalogFingerprint() {
  try {
    return JSON.stringify(state.moduleCatalog)
  } catch {
    return `${state.moduleCatalog.length}`
  }
}

catalogFingerprint.value = computeCatalogFingerprint()

function normalizedVariantName(name: string | undefined) {
  const trimmed = name?.trim()
  return trimmed?.length ? trimmed : DEFAULT_SVG_VARIANT_NAME
}

function moduleVariantNames(module: SpaceshipModuleDefinition | null | undefined) {
  const names = Object.keys(module?.svgVariants ?? {})
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length ? names : [DEFAULT_SVG_VARIANT_NAME]
}

function ensureModuleVariant(
  module: SpaceshipModuleDefinition,
  variantName = normalizedVariantName(state.svgEditor.variantName),
): SpaceshipSvgVariantDefinition {
  const key = normalizedVariantName(variantName)
  module.svgVariants ??= {}
  module.svgVariants[key] ??= { category: 'hull' }
  const variant = module.svgVariants[key]
  if (!variant) throw new Error(`Failed to resolve SVG variant "${key}".`)
  return variant
}

watch(
  selectedModule,
  (module) => {
    labDebug('selectedModule watcher', {
      selectedModuleIndex: state.selectedModuleIndex,
      moduleId: module?.id ?? null,
    })
    patternSize.width = module?.pattern[0]?.length ?? 5
    patternSize.height = module?.pattern.length ?? 5
    state.preview.focusedModuleId = module?.id ?? ''
    const availableNames = moduleVariantNames(module)
    if (!availableNames.includes(state.svgEditor.variantName))
      state.svgEditor.variantName = availableNames[0] ?? DEFAULT_SVG_VARIANT_NAME
  },
  { immediate: true },
)

const selectedModuleMetadata = computed<Record<string, unknown> | undefined>({
  get: () => {
    if (!selectedModule.value) return undefined
    return selectedModule.value as unknown as Record<string, unknown>
  },
  set: (value) => {
    if (!value || !selectedModule.value) return
    const incomingId = typeof value.id === 'string' ? value.id : undefined
    // ObjectView can briefly emit stale payloads while selection is changing.
    // Ignore those so selecting a module never mutates catalog data or bumps catalogVersion.
    if (incomingId && incomingId !== selectedModule.value.id) {
      labDebug('selectedModuleMetadata setter ignored stale payload', {
        selectedModuleIndex: state.selectedModuleIndex,
        selectedModuleId: selectedModule.value.id,
        incomingId,
      })
      return
    }
    const currentModuleJson = JSON.stringify(selectedModule.value)
    const incomingModuleJson = JSON.stringify(value)
    if (currentModuleJson === incomingModuleJson) {
      labDebug('selectedModuleMetadata setter (no-op)')
      return
    }
    labDebug('selectedModuleMetadata setter (changed)', {
      selectedModuleIndex: state.selectedModuleIndex,
      moduleId: selectedModule.value.id,
    })
    Object.assign(selectedModule.value, value)
    touchCatalog('selectedModuleMetadata setter')
  },
})

const libraryMetadata = ref<SpaceshipLibraryFile>({
  version: 1,
  algorithm: structuredClone(DEFAULT_ALGORITHM),
  moduleCatalog: state.moduleCatalog,
})
const libraryMetadataSyncing = ref(false)

function labDebug(message: string, details?: Record<string, unknown>) {
  if (!DEBUG_SPACESHIP_LAB) return
  if (details) {
    console.log(`[SpaceshipLab] ${message}`, details)
    return
  }
  console.log(`[SpaceshipLab] ${message}`)
}

function libraryAlgorithmFromState() {
  return spaceshipAlgorithmConfigSchema.parse({
    symmetry: state.preview.symmetry,
    gridSize: parsedGridSize.value,
    stages: parsedStages.value,
    identiconSize: state.preview.identiconSize,
    randomSvgColors: state.preview.randomSvgColors,
    showBackground: state.preview.showBackground,
    showStars: state.preview.showStars,
  })
}

function syncLibraryMetadataFromState() {
  if (libraryMetadataSyncing.value) return
  const algorithm = libraryAlgorithmFromState()
  libraryMetadataSyncing.value = true
  libraryMetadata.value.version = 1
  libraryMetadata.value.algorithm = algorithm
  libraryMetadata.value.moduleCatalog = state.moduleCatalog
  libraryMetadataSyncing.value = false
}

watch(
  () => [
    state.preview.symmetry,
    state.preview.gridSizeJson,
    state.preview.stagesJson,
    state.preview.identiconSize,
    state.preview.randomSvgColors,
    state.preview.showBackground,
    state.preview.showStars,
  ],
  syncLibraryMetadataFromState,
  { immediate: true },
)

watch(
  () => libraryMetadata.value.algorithm,
  (algorithm) => {
    if (libraryMetadataSyncing.value) return
    libraryMetadataSyncing.value = true
    applyImportedAlgorithmSettings(algorithm as SpaceshipLibraryFile['algorithm'])
    libraryMetadataSyncing.value = false
  },
  { deep: true },
)

watch(
  () => libraryMetadata.value.moduleCatalog,
  (moduleCatalogValue) => {
    if (libraryMetadataSyncing.value) return
    if (!Array.isArray(moduleCatalogValue)) return
    const modules = moduleCatalogValue as SpaceshipModuleDefinition[]
    labDebug('libraryMetadata.moduleCatalog watcher fired', {
      sameReference: modules === state.moduleCatalog,
      selectedModuleIndex: state.selectedModuleIndex,
    })
    libraryMetadataSyncing.value = true
    if (modules !== state.moduleCatalog) {
      state.moduleCatalog.splice(0, state.moduleCatalog.length, ...cloneModuleLibrary(modules))
      resetPreviewGallery()
      sanitizeCatalogSvgMarkup(state.moduleCatalog)
      if (state.selectedModuleIndex >= state.moduleCatalog.length)
        state.selectedModuleIndex = Math.max(0, state.moduleCatalog.length - 1)
      libraryMetadata.value.moduleCatalog = state.moduleCatalog
      libraryMetadataSyncing.value = false
      touchCatalog('libraryMetadata.moduleCatalog watcher (replaced reference)')
      return
    }
    libraryMetadataSyncing.value = false
    const nextFingerprint = computeCatalogFingerprint()
    if (nextFingerprint === catalogFingerprint.value) {
      labDebug('libraryMetadata.moduleCatalog watcher skipped (no catalog diff)', {
        selectedModuleIndex: state.selectedModuleIndex,
      })
      return
    }
    touchCatalog('libraryMetadata.moduleCatalog watcher (same reference diff)')
  },
  { deep: true },
)

function normalizedScale(value: unknown, fallback = 1) {
  if (!Number.isFinite(Number(value))) return Math.max(0.05, fallback)
  return Math.max(0.05, Number(value))
}

function normalizedOffset(value: unknown, fallback = 0) {
  if (!Number.isFinite(Number(value))) return fallback
  return Number(value)
}

function getModuleVariant(
  module: SpaceshipModuleDefinition,
  variantName = normalizedVariantName(state.svgEditor.variantName),
) {
  return module.svgVariants?.[normalizedVariantName(variantName)]
}

function getModuleVariantTransform(module: SpaceshipModuleDefinition, variantName: string) {
  const fromVariant = getModuleVariant(module, variantName)?.transform
  return {
    scaleX: normalizedScale(fromVariant?.scaleX, 1),
    scaleY: normalizedScale(fromVariant?.scaleY, 1),
    offsetX: normalizedOffset(fromVariant?.offsetX, 0),
    offsetY: normalizedOffset(fromVariant?.offsetY, 0),
  }
}

function setModuleVariantTransform(
  module: SpaceshipModuleDefinition,
  variantName: string,
  patch: Partial<Required<SvgTransformConfig>>,
) {
  const variant = ensureModuleVariant(module, variantName)
  const current = getModuleVariantTransform(module, variantName)
  const next = {
    scaleX: patch.scaleX != null ? normalizedScale(patch.scaleX, current.scaleX) : current.scaleX,
    scaleY: patch.scaleY != null ? normalizedScale(patch.scaleY, current.scaleY) : current.scaleY,
    offsetX:
      patch.offsetX != null ? normalizedOffset(patch.offsetX, current.offsetX) : current.offsetX,
    offsetY:
      patch.offsetY != null ? normalizedOffset(patch.offsetY, current.offsetY) : current.offsetY,
  }
  variant.transform = next
}

function activeSvgVariantName() {
  return normalizedVariantName(state.svgEditor.variantName)
}

function addSvgVariant() {
  if (!selectedModule.value) return
  const current = getModuleVariant(selectedModule.value, activeSvgVariantName())
  const suggested = `variant_${moduleVariantNames(selectedModule.value).length + 1}`
  const requested = window.prompt('New SVG variant name', suggested)
  if (requested == null) return
  const nextName = normalizedVariantName(requested)
  if (selectedModule.value.svgVariants?.[nextName]) {
    window.alert(`Variant "${nextName}" already exists.`)
    return
  }
  const clonedTransform = current?.transform
    ? {
        ...(current.transform.offsetX != null ? { offsetX: current.transform.offsetX } : {}),
        ...(current.transform.offsetY != null ? { offsetY: current.transform.offsetY } : {}),
        ...(current.transform.scaleX != null ? { scaleX: current.transform.scaleX } : {}),
        ...(current.transform.scaleY != null ? { scaleY: current.transform.scaleY } : {}),
      }
    : undefined
  selectedModule.value.svgVariants ??= {}
  selectedModule.value.svgVariants[nextName] = {
    category: current?.category ?? 'hull',
    ...(current?.svgMarkup ? { svgMarkup: current.svgMarkup } : {}),
    ...(clonedTransform ? { transform: clonedTransform } : {}),
    ...(current?.description ? { description: current.description } : {}),
  }
  state.svgEditor.variantName = nextName
  touchCatalog('addSvgVariant')
}

function removeActiveSvgVariant() {
  if (!selectedModule.value) return
  const names = moduleVariantNames(selectedModule.value)
  if (names.length <= 1) {
    window.alert('Each module needs at least one SVG variant.')
    return
  }
  const activeName = activeSvgVariantName()
  const ok = window.confirm(`Delete SVG variant "${activeName}"?`)
  if (!ok) return
  delete selectedModule.value.svgVariants?.[activeName]
  const remaining = moduleVariantNames(selectedModule.value)
  state.svgEditor.variantName = remaining[0] ?? DEFAULT_SVG_VARIANT_NAME
  touchCatalog('removeActiveSvgVariant')
}

const selectedModuleSvgScaleX = computed({
  get: () => {
    if (!selectedModule.value) return 1
    return getModuleVariantTransform(selectedModule.value, activeSvgVariantName()).scaleX
  },
  set: (value: number) => {
    if (!selectedModule.value) return
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), { scaleX: value })
    touchCatalog()
  },
})
const selectedModuleSvgScaleY = computed({
  get: () => {
    if (!selectedModule.value) return 1
    return getModuleVariantTransform(selectedModule.value, activeSvgVariantName()).scaleY
  },
  set: (value: number) => {
    if (!selectedModule.value) return
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), { scaleY: value })
    touchCatalog()
  },
})
const selectedModuleSvgOffsetX = computed({
  get: () => {
    if (!selectedModule.value) return 0
    return getModuleVariantTransform(selectedModule.value, activeSvgVariantName()).offsetX
  },
  set: (value: number) => {
    if (!selectedModule.value) return
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), { offsetX: value })
    touchCatalog()
  },
})
const selectedModuleSvgOffsetY = computed({
  get: () => {
    if (!selectedModule.value) return 0
    return getModuleVariantTransform(selectedModule.value, activeSvgVariantName()).offsetY
  },
  set: (value: number) => {
    if (!selectedModule.value) return
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), { offsetY: value })
    touchCatalog()
  },
})
const svgEditorVariantOptions = computed(() => {
  if (!selectedModule.value)
    return [{ label: DEFAULT_SVG_VARIANT_NAME, value: DEFAULT_SVG_VARIANT_NAME }]
  const names = moduleVariantNames(selectedModule.value)
  return names.map((name) => ({ label: name, value: name }))
})
const svgVariantCategoryOptions = computed<Array<{ label: string; value: ModuleCategory }>>(() => {
  const categories = new Set<string>()
  for (const module of state.moduleCatalog) {
    for (const variant of Object.values(module.svgVariants ?? {})) {
      const category = variant?.category
      if (typeof category !== 'string') continue
      const normalized = category.trim()
      if (!normalized) continue
      categories.add(normalized)
    }
  }
  if (!categories.size) categories.add('hull')
  return Array.from(categories)
    .sort((a, b) => a.localeCompare(b))
    .map((category) => ({ label: category, value: category }))
})
const selectedModuleSvgVariantCategory = computed<ModuleCategory>({
  get: () => {
    if (!selectedModule.value) return 'hull'
    return getModuleVariant(selectedModule.value, activeSvgVariantName())?.category ?? 'hull'
  },
  set: (value) => {
    if (!selectedModule.value) return
    ensureModuleVariant(selectedModule.value, activeSvgVariantName()).category = value
    touchCatalog('set active variant category')
  },
})

function onNewSvgVariantCategory(
  value: string,
  done: (value?: string, mode?: 'add' | 'add-unique' | 'toggle') => void,
) {
  const normalized = value.trim()
  if (!normalized) {
    done()
    return
  }
  selectedModuleSvgVariantCategory.value = normalized
  done(normalized, 'add-unique')
}

const selectedModuleSvgMarkupActive = computed({
  get: () => {
    if (!selectedModule.value) return ''
    return getModuleVariant(selectedModule.value, activeSvgVariantName())?.svgMarkup ?? ''
  },
  set: (value: string) => {
    if (!selectedModule.value) return
    const sanitized = sanitizeModuleSvgMarkup(value) ?? ''
    ensureModuleVariant(selectedModule.value, activeSvgVariantName()).svgMarkup = sanitized
    touchCatalog()
  },
})
const selectedModuleSvgMarkup = computed({
  get: () => selectedModuleSvgMarkupActive.value,
  set: (value: string) => {
    selectedModuleSvgMarkupActive.value = value
  },
})
const selectedModuleForSvgEditor = computed<SpaceshipModuleDefinition | null>(() => {
  if (!selectedModule.value) return null
  const activeVariantName = activeSvgVariantName()
  const variant = getModuleVariant(selectedModule.value, activeVariantName) ?? { category: 'hull' }
  return {
    ...selectedModule.value,
    svgVariants: {
      [activeVariantName]: {
        ...variant,
        svgMarkup: selectedModuleSvgMarkupActive.value,
        transform: getModuleVariantTransform(selectedModule.value, activeVariantName),
      },
    },
  }
})
const moduleSvgPreview = computed(() =>
  selectedModuleForSvgEditor.value
    ? modulePreviewSvg(selectedModuleForSvgEditor.value, state.svgEditor.rotation, true, true)
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" text-anchor="middle" fill="#999">no svg</text></svg>',
)
const PREVIEW_CELL_SIZE = 18
const dragState = {
  dragging: false,
  startSvgX: 0,
  startSvgY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
  host: null as HTMLElement | null,
  latestClientX: 0,
  latestClientY: 0,
  rafId: 0,
}
const primaryScene = computed(() =>
  createSpaceshipScene(state.preview.seedText, {
    moduleLibrary: state.moduleCatalog,
    symmetry: state.preview.symmetry,
    gridSize: parsedGridSize.value,
    stages: parsedStages.value,
    maxGlobalRewinds: state.preview.maxGlobalRewinds,
    debugGeneration: state.preview.debugGeneration,
  }),
)
const primaryPreviewCrop = computed(() => {
  const gridWidth = primaryScene.value.gridSize.width * PREVIEW_CELL_SIZE
  const gridHeight = primaryScene.value.gridSize.height * PREVIEW_CELL_SIZE
  const bounds = primaryScene.value.stats.occupiedBounds
  if (!bounds) return { x: 0, y: 0, w: gridWidth, h: gridHeight }
  return {
    x: Math.max(0, (bounds.minX - 1) * PREVIEW_CELL_SIZE),
    y: Math.max(0, (bounds.minY - 1) * PREVIEW_CELL_SIZE),
    w: Math.min(gridWidth, (bounds.maxX - bounds.minX + 3) * PREVIEW_CELL_SIZE),
    h: Math.min(gridHeight, (bounds.maxY - bounds.minY + 3) * PREVIEW_CELL_SIZE),
  }
})
const focusedPreviewRects = computed(() => {
  const focusedId = state.preview.focusedModuleId
  if (!focusedId) return []
  return primaryScene.value.placements
    .filter((placement) => placement.tile.id === focusedId)
    .map((placement, index) => ({
      id: `${placement.tile.id}-${placement.x}-${placement.y}-${index}`,
      x: placement.x * PREVIEW_CELL_SIZE,
      y: placement.y * PREVIEW_CELL_SIZE,
      w: (placement.tile.pattern[0]?.length ?? 0) * PREVIEW_CELL_SIZE,
      h: placement.tile.pattern.length * PREVIEW_CELL_SIZE,
    }))
})
const primaryPlacedCategoryCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const placement of primaryScene.value.placements) {
    const category = `${placement.tile.category}`.trim() || 'uncategorized'
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
})
const primaryDebugStageReports = computed(() => primaryScene.value.debug?.stageReports ?? [])
const primaryDebugUnresolvedCategories = computed(
  () => primaryScene.value.debug?.unresolvedCategories ?? [],
)
const proofStatusLine = computed(() => {
  if (proofRun.running)
    return `running ${proofRun.completed}/${proofRun.requested} (rewinds ${proofRun.totalRewinds})`
  if (!proofRun.timestamp) return 'not run'
  const avgMs = proofRun.completed > 0 ? proofRun.durationMs / proofRun.completed : 0
  const avgRewinds = proofRun.completed > 0 ? proofRun.totalRewinds / proofRun.completed : 0
  return `ships=${proofRun.completed}/${proofRun.requested}, unresolved=${proofRun.failed}, avg=${avgMs.toFixed(2)} ms/ship, avgRewinds=${avgRewinds.toFixed(2)}, maxRewinds=${proofRun.maxRewindsPerShip}`
})
const cachingEnabled = computed({
  get: () => !state.preview.disableCache,
  set: (value: boolean) => {
    state.preview.disableCache = !value
  },
})

function focusLibraryTab() {
  const catalogLeaf = dockLayout.value.children?.find((child) => child.id === 'spaceship-catalog')
  if (catalogLeaf?.type !== 'leaf') return
  const libraryIndex = catalogLeaf.views?.findIndex((view) => view === 'Library') ?? -1
  if (libraryIndex >= 0) catalogLeaf.activeViewIndex = libraryIndex
}

function svgCellColor(value: CellValue) {
  if (value === IGNORE) return '#5b5b5b'
  if (value === SPACE) return '#161a26'
  if (value === HULL) return '#d8dfef'
  if (value === THRUSTER) return '#6d788f'
  if (value === COCKPIT) return '#83d8ff'
  if (value === WING) return '#8da2ff'
  return '#888'
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function parseSvgMarkup(markup: string | undefined, fallbackWidth: number, fallbackHeight: number) {
  const trimmed = markup?.trim()
  if (!trimmed) {
    return {
      content: `<rect x="1.5" y="1.5" width="${Math.max(4, fallbackWidth - 3)}" height="${Math.max(4, fallbackHeight - 3)}" rx="8" fill="#e9edf5" stroke="#23346f" stroke-width="2.4"/>`,
      minX: 0,
      minY: 0,
      width: fallbackWidth,
      height: fallbackHeight,
    }
  }
  const svgMatch = trimmed.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i)
  const attrs = svgMatch?.[1] ?? ''
  const content = (svgMatch?.[2] ?? trimmed).trim()
  const viewBox = attrs.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim()
  const viewBoxParts = (viewBox ?? '')
    .split(/[\s,]+/)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
  const width = Number(attrs.match(/width\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/px$/i, ''))
  const height = Number(attrs.match(/height\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/px$/i, ''))
  const hasViewBox = viewBoxParts.length >= 4
  const minX = hasViewBox ? viewBoxParts[0]! : 0
  const minY = hasViewBox ? viewBoxParts[1]! : 0
  const vbWidth = hasViewBox ? Math.abs(viewBoxParts[2]!) : Number.NaN
  const vbHeight = hasViewBox ? Math.abs(viewBoxParts[3]!) : Number.NaN
  return {
    content,
    minX,
    minY,
    width: Number.isFinite(vbWidth) ? vbWidth : Number.isFinite(width) ? width : fallbackWidth,
    height: Number.isFinite(vbHeight)
      ? vbHeight
      : Number.isFinite(height)
        ? height
        : fallbackHeight,
  }
}

function applyPreviewMaterialTokens(markup: string) {
  const palette = createMaterialPalette(state.preview.seedText, state.preview.randomSvgColors)
  return applyMaterialPaletteToMarkup(markup, palette)
}

function getModuleVariantMarkup(module: SpaceshipModuleDefinition, variantName: string) {
  return sanitizeModuleSvgMarkup(getModuleVariant(module, variantName)?.svgMarkup) ?? ''
}

function buildModulePreviewSvg(
  module: SpaceshipModuleDefinition,
  svgRotation = 0,
  scaleToGrid = true,
  showGrid = true,
  showBackdrop = true,
  variantName = DEFAULT_SVG_VARIANT_NAME,
) {
  const gridWidth = module.pattern[0]?.length ?? 1
  const gridHeight = module.pattern.length ?? 1
  const cellSize = PREVIEW_CELL_SIZE
  const rawWidth = gridWidth * cellSize
  const rawHeight = gridHeight * cellSize
  const parsed = parseSvgMarkup(getModuleVariantMarkup(module, variantName), rawWidth, rawHeight)
  const materializedContent = applyPreviewMaterialTokens(parsed.content)
  const normalizedSvgRotation = ((svgRotation % 4) + 4) % 4
  const rotationAngle = normalizedSvgRotation * 90
  const gridRects = showGrid
    ? module.pattern
        .flatMap((row, y) =>
          row.map((cell, x) => {
            const px = x * cellSize
            const py = y * cellSize
            return `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="${svgCellColor(cell)}" fill-opacity="0.92" stroke="rgba(255,255,255,0.2)" stroke-width="1"/><text x="${px + cellSize / 2}" y="${py + cellSize / 2 + 4}" text-anchor="middle" font-size="8" font-family="monospace" fill="rgba(0,0,0,0.55)">${escapeXml(cellLabel(cell))}</text>`
          }),
        )
        .join('')
    : ''
  const ringInset = cellSize * 0.5
  const targetWidth = Math.max(1, rawWidth - ringInset * 2)
  const targetHeight = Math.max(1, rawHeight - ringInset * 2)
  const variantTransform = getModuleVariantTransform(module, variantName)
  const moduleScaleX = variantTransform.scaleX
  const moduleScaleY = variantTransform.scaleY
  const moduleOffsetX = variantTransform.offsetX
  const moduleOffsetY = variantTransform.offsetY
  const baseScaleX = scaleToGrid ? targetWidth / Math.max(1, parsed.width) : 1
  const baseScaleY = scaleToGrid ? targetHeight / Math.max(1, parsed.height) : 1
  const scaleX = baseScaleX * moduleScaleX
  const scaleY = baseScaleY * moduleScaleY
  const baseTranslateX = scaleToGrid ? ringInset - parsed.minX * scaleX : -parsed.minX * scaleX
  const baseTranslateY = scaleToGrid ? ringInset - parsed.minY * scaleY : -parsed.minY * scaleY
  const translateX = baseTranslateX + moduleOffsetX * cellSize
  const translateY = baseTranslateY + moduleOffsetY * cellSize
  const baseContent = scaleToGrid
    ? `<g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">${materializedContent}</g>`
    : `<g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">${materializedContent}</g>`
  const overlayContent =
    rotationAngle !== 0
      ? `<g transform="rotate(${rotationAngle} ${rawWidth / 2} ${rawHeight / 2})">${baseContent}</g>`
      : baseContent
  const backdrop = showBackdrop
    ? `<rect x="0" y="0" width="${rawWidth}" height="${rawHeight}" rx="8" fill="rgba(255,255,255,0.02)"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rawWidth} ${rawHeight}" preserveAspectRatio="xMidYMid meet">${backdrop}${gridRects}<g opacity="0.95" class="module-preview-content">${overlayContent}</g></svg>`
}

function beginModuleSvgDrag(event: MouseEvent) {
  if (!selectedModule.value) return
  if (event.button !== 0) return
  const host = event.currentTarget as HTMLElement | null
  if (!host) return
  const startPoint = clientToSvgUnits(host, event.clientX, event.clientY)
  if (!startPoint) return
  event.preventDefault()
  dragState.dragging = true
  dragState.host = host
  dragState.startSvgX = startPoint.x
  dragState.startSvgY = startPoint.y
  const transform = getModuleVariantTransform(selectedModule.value, activeSvgVariantName())
  dragState.startOffsetX = transform.offsetX
  dragState.startOffsetY = transform.offsetY
  dragState.latestClientX = event.clientX
  dragState.latestClientY = event.clientY
  window.addEventListener('mousemove', onModuleSvgDrag)
  window.addEventListener('mouseup', stopModuleSvgDrag)
}

function onModuleSvgDrag(event: MouseEvent) {
  if (!dragState.dragging) return
  dragState.latestClientX = event.clientX
  dragState.latestClientY = event.clientY
  if (dragState.rafId !== 0) return
  dragState.rafId = window.requestAnimationFrame(() => {
    dragState.rafId = 0
    if (!dragState.dragging || !selectedModule.value) return
    const point = clientToSvgUnits(dragState.host, dragState.latestClientX, dragState.latestClientY)
    if (!point) return
    const dx = point.x - dragState.startSvgX
    const dy = point.y - dragState.startSvgY
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), {
      offsetX: dragState.startOffsetX + dx / PREVIEW_CELL_SIZE,
      offsetY: dragState.startOffsetY + dy / PREVIEW_CELL_SIZE,
    })
  })
}

function stopModuleSvgDrag() {
  if (dragState.rafId !== 0) {
    window.cancelAnimationFrame(dragState.rafId)
    dragState.rafId = 0
  }
  dragState.dragging = false
  dragState.host = null
  window.removeEventListener('mousemove', onModuleSvgDrag)
  window.removeEventListener('mouseup', stopModuleSvgDrag)
  touchCatalog()
}

function clientToSvgUnits(host: HTMLElement | null, clientX: number, clientY: number) {
  if (!host) return null
  const svg = host.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const localPoint = point.matrixTransform(ctm.inverse())
  return { x: localPoint.x, y: localPoint.y }
}

onBeforeUnmount(() => {
  stopModuleSvgDrag()
})

function centerAlignModuleSvgX() {
  if (!selectedModule.value) return
  const measured = getRenderedModuleContentBBox()
  if (measured) {
    const gridWidth = selectedModule.value.pattern[0]?.length ?? 1
    const rawWidth = gridWidth * PREVIEW_CELL_SIZE
    const targetCenterX = rawWidth / 2
    const measuredCenterX = measured.x + measured.width / 2
    const transform = getModuleVariantTransform(selectedModule.value, activeSvgVariantName())
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), {
      offsetX: transform.offsetX + (targetCenterX - measuredCenterX) / PREVIEW_CELL_SIZE,
    })
    touchCatalog()
    return
  }
  if (!selectedModuleForSvgEditor.value) return
  const transform = computePreviewTransform(selectedModuleForSvgEditor.value)
  setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), {
    offsetX: transform.offsetCellsXForCenter,
  })
  touchCatalog()
}

function centerAlignModuleSvgY() {
  if (!selectedModule.value) return
  const measured = getRenderedModuleContentBBox()
  if (measured) {
    const gridHeight = selectedModule.value.pattern.length ?? 1
    const rawHeight = gridHeight * PREVIEW_CELL_SIZE
    const targetCenterY = rawHeight / 2
    const measuredCenterY = measured.y + measured.height / 2
    const transform = getModuleVariantTransform(selectedModule.value, activeSvgVariantName())
    setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), {
      offsetY: transform.offsetY + (targetCenterY - measuredCenterY) / PREVIEW_CELL_SIZE,
    })
    touchCatalog()
    return
  }
  if (!selectedModuleForSvgEditor.value) return
  const transform = computePreviewTransform(selectedModuleForSvgEditor.value)
  setModuleVariantTransform(selectedModule.value, activeSvgVariantName(), {
    offsetY: transform.offsetCellsYForCenter,
  })
  touchCatalog()
}

async function fitModuleSvgToGrid() {
  if (!selectedModule.value) return
  if (!selectedModuleForSvgEditor.value) return
  await nextTick()
  const module = selectedModule.value
  const measured = getRenderedModuleContentBBox()
  if (!measured || measured.width <= 0 || measured.height <= 0) {
    setModuleVariantTransform(module, activeSvgVariantName(), {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    })
    return
  }
  const gridWidth = module.pattern[0]?.length ?? 1
  const gridHeight = module.pattern.length ?? 1
  const targetWidth = Math.max(1, (gridWidth - 1) * PREVIEW_CELL_SIZE)
  const targetHeight = Math.max(1, (gridHeight - 1) * PREVIEW_CELL_SIZE)
  const transform = getModuleVariantTransform(module, activeSvgVariantName())
  setModuleVariantTransform(module, activeSvgVariantName(), {
    scaleX: Math.max(0.05, transform.scaleX * (targetWidth / measured.width)),
    scaleY: Math.max(0.05, transform.scaleY * (targetHeight / measured.height)),
  })
  await nextTick()
  centerAlignModuleSvgX()
  centerAlignModuleSvgY()
  touchCatalog()
}

async function fitModuleSvgToBoundary() {
  if (!selectedModule.value) return
  if (!selectedModuleForSvgEditor.value) return
  await nextTick()
  const module = selectedModule.value
  const measured = getRenderedModuleContentBBox()
  if (!measured || measured.width <= 0 || measured.height <= 0) {
    setModuleVariantTransform(module, activeSvgVariantName(), {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    })
    touchCatalog()
    return
  }
  const gridWidth = module.pattern[0]?.length ?? 1
  const gridHeight = module.pattern.length ?? 1
  const targetWidth = Math.max(1, gridWidth * PREVIEW_CELL_SIZE)
  const targetHeight = Math.max(1, gridHeight * PREVIEW_CELL_SIZE)
  const transform = getModuleVariantTransform(module, activeSvgVariantName())
  setModuleVariantTransform(module, activeSvgVariantName(), {
    scaleX: Math.max(0.05, transform.scaleX * (targetWidth / measured.width)),
    scaleY: Math.max(0.05, transform.scaleY * (targetHeight / measured.height)),
  })
  await nextTick()
  const scaled = getRenderedModuleContentBBox()
  if (scaled) {
    const nextTransform = getModuleVariantTransform(module, activeSvgVariantName())
    setModuleVariantTransform(module, activeSvgVariantName(), {
      offsetX: nextTransform.offsetX - scaled.x / PREVIEW_CELL_SIZE,
      offsetY: nextTransform.offsetY - scaled.y / PREVIEW_CELL_SIZE,
    })
  }
  touchCatalog()
}

function getRenderedModuleContentBBox() {
  const host = moduleSvgPreviewHost.value
  if (!host) return null
  const svg = host.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) return null
  const content = svg.querySelector('.module-preview-content')
  if (!(content instanceof SVGGElement)) return null
  const bbox = content.getBBox()
  if (
    !Number.isFinite(bbox.x) ||
    !Number.isFinite(bbox.y) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height)
  )
    return null
  return {
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
  }
}

function computePreviewTransform(module: SpaceshipModuleDefinition) {
  const gridWidth = module.pattern[0]?.length ?? 1
  const gridHeight = module.pattern.length ?? 1
  const rawWidth = gridWidth * PREVIEW_CELL_SIZE
  const rawHeight = gridHeight * PREVIEW_CELL_SIZE
  const variantName = activeSvgVariantName()
  const parsed = parseSvgMarkup(getModuleVariantMarkup(module, variantName), rawWidth, rawHeight)
  const transform = getModuleVariantTransform(module, variantName)
  const moduleScaleX = transform.scaleX
  const moduleScaleY = transform.scaleY
  const ringInset = PREVIEW_CELL_SIZE * 0.5
  const targetWidth = Math.max(1, rawWidth - ringInset * 2)
  const targetHeight = Math.max(1, rawHeight - ringInset * 2)
  const baseScaleX = targetWidth / Math.max(1, parsed.width)
  const baseScaleY = targetHeight / Math.max(1, parsed.height)
  const scaleX = baseScaleX * moduleScaleX
  const scaleY = baseScaleY * moduleScaleY
  const baseTranslateX = ringInset - parsed.minX * scaleX
  const baseTranslateY = ringInset - parsed.minY * scaleY
  const contentWidth = parsed.width * scaleX
  const contentHeight = parsed.height * scaleY
  const targetX = (rawWidth - contentWidth) / 2
  const targetY = (rawHeight - contentHeight) / 2
  return {
    offsetCellsXForCenter: (targetX - baseTranslateX) / PREVIEW_CELL_SIZE,
    offsetCellsYForCenter: (targetY - baseTranslateY) / PREVIEW_CELL_SIZE,
  }
}

function modulePreviewSvg(
  module: SpaceshipModuleDefinition,
  svgRotation = 0,
  scaleToGrid = true,
  showGrid = true,
) {
  return buildModulePreviewSvg(
    module,
    svgRotation,
    scaleToGrid,
    showGrid,
    true,
    activeSvgVariantName(),
  )
}

function moduleSvgVariants(module: SpaceshipModuleDefinition) {
  return moduleVariantNames(module).map((name) => ({
    name,
    markup: getModuleVariantMarkup(module, name),
  }))
}

function moduleMiniIconSvgs(module: SpaceshipModuleDefinition) {
  return moduleSvgVariants(module).map((variant) => ({
    name: variant.name,
    svg: buildModulePreviewSvg(module, 0, true, false, false, variant.name),
  }))
}

function moduleOverviewSvgs(module: SpaceshipModuleDefinition) {
  return moduleSvgVariants(module).map((variant) => ({
    name: variant.name,
    svg: buildModulePreviewSvg(module, state.svgEditor.rotation, true, true, true, variant.name),
  }))
}

resetPreviewGallery()

function touchCatalog(reason = 'unspecified') {
  const nextFingerprint = computeCatalogFingerprint()
  if (nextFingerprint === catalogFingerprint.value) {
    labDebug('touchCatalog skipped (no-op)', {
      reason,
      selectedModuleIndex: state.selectedModuleIndex,
    })
    return
  }
  catalogFingerprint.value = nextFingerprint
  const caller = new Error().stack?.split('\n')[2]?.trim() ?? 'unknown'
  labDebug('touchCatalog', {
    reason,
    caller,
    nextCatalogVersion: state.catalogVersion + 1,
    selectedModuleIndex: state.selectedModuleIndex,
  })
  state.catalogVersion += 1
}

function appendBatch(size = batchSize) {
  const beforeCount = galleryEntries.value.length
  const beforeStartId = galleryEntries.value[0]?.id ?? null
  const appendStartIndex = nextIndex.value
  const nextEntries = Array.from({ length: size }, (_, offset) => {
    const index = nextIndex.value + offset
    const seedText = createSeedString(index)
    return {
      id: `spaceship-${index}`,
      seedText,
    }
  })
  galleryEntries.value.push(...nextEntries)
  nextIndex.value += size
  const overflow = Math.max(0, galleryEntries.value.length - maxGalleryEntries)
  if (overflow > 0) galleryEntries.value.splice(0, overflow)
  labDebug('gallery appendBatch', {
    appendStartIndex,
    appended: size,
    trimmedHead: overflow,
    beforeCount,
    afterCount: galleryEntries.value.length,
    beforeStartId,
    afterStartId: galleryEntries.value[0]?.id ?? null,
    afterEndId: galleryEntries.value[galleryEntries.value.length - 1]?.id ?? null,
  })
}

function resetPreviewGallery() {
  galleryEntries.value.splice(0)
  nextIndex.value = 0
  appendBatch(initialGalleryBatchSize)
  void nextTick(() => {
    if (galleryScrollHost.value) galleryScrollHost.value.scrollTop = 0
  })
  labDebug('gallery reset', {
    initialBatchSize: initialGalleryBatchSize,
    maxGalleryEntries,
  })
}

function onGalleryScroll() {
  const host = galleryScrollHost.value
  if (!host || galleryLoadInProgress.value) return
  const remaining = host.scrollHeight - (host.scrollTop + host.clientHeight)
  if (remaining > galleryLoadOffsetPx) return
  galleryLoadInProgress.value = true
  const t0 = performance.now()
  appendBatch()
  const dtMs = Math.round((performance.now() - t0) * 100) / 100
  labDebug('gallery scroll-triggered load', {
    remainingPx: Math.round(remaining),
    dtMs,
    renderedEntries: galleryEntries.value.length,
  })
  galleryLoadInProgress.value = false
}

function normalizeProofCount(value: number) {
  const normalized = Math.floor(Number(value))
  if (!Number.isFinite(normalized) || normalized <= 0) return 1
  return Math.min(normalized, 100000)
}

function normalizeMaxGlobalRewinds(value: number) {
  const normalized = Math.floor(Number(value))
  if (!Number.isFinite(normalized) || normalized <= 0) return 1
  return Math.min(normalized, 10000)
}

function sceneHasUnresolvedRequirements(scene: ReturnType<typeof createSpaceshipScene>) {
  const unresolved = scene.debug?.unresolvedCategories ?? []
  if (unresolved.length > 0) return true
  return (scene.debug?.stageReports ?? []).some(
    (report) => report.stopReason !== 'requirements-satisfied',
  )
}

function totalRewindsForScene(scene: ReturnType<typeof createSpaceshipScene>) {
  return (scene.debug?.stageReports ?? []).reduce(
    (sum, report) => sum + (report.backtracks ?? 0) + (report.crossStageRewinds ?? 0),
    0,
  )
}

async function runProofBatch() {
  if (proofRun.running) return
  const requested = normalizeProofCount(state.preview.proofCount)
  const normalizedMaxGlobalRewinds = normalizeMaxGlobalRewinds(state.preview.maxGlobalRewinds)
  state.preview.proofCount = requested
  state.preview.maxGlobalRewinds = normalizedMaxGlobalRewinds
  proofRun.running = true
  proofRun.requested = requested
  proofRun.completed = 0
  proofRun.failed = 0
  proofRun.firstFailedSeed = ''
  proofRun.durationMs = 0
  proofRun.totalRewinds = 0
  proofRun.maxRewindsPerShip = 0
  proofRun.timestamp = Date.now()
  const startedAt = performance.now()

  try {
    for (let index = 0; index < requested; index += 1) {
      const seedText = createSeedString(index)
      const scene = createSpaceshipScene(seedText, {
        moduleLibrary: state.moduleCatalog,
        symmetry: state.preview.symmetry,
        gridSize: parsedGridSize.value,
        stages: parsedStages.value,
        maxGlobalRewinds: normalizedMaxGlobalRewinds,
        debugGeneration: true,
      })
      const rewinds = totalRewindsForScene(scene)
      proofRun.totalRewinds += rewinds
      proofRun.maxRewindsPerShip = Math.max(proofRun.maxRewindsPerShip, rewinds)
      if (sceneHasUnresolvedRequirements(scene)) {
        proofRun.failed += 1
        if (!proofRun.firstFailedSeed) proofRun.firstFailedSeed = seedText
      }
      proofRun.completed = index + 1
      if ((index + 1) % 25 === 0) await nextTick()
    }
  } finally {
    proofRun.durationMs = performance.now() - startedAt
    proofRun.running = false
    proofRun.timestamp = Date.now()
  }
}

async function copyPrimaryPreviewPng() {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    window.alert('Clipboard image copy is not available in this browser context.')
    return
  }
  try {
    const result = await getSpaceshipImage(props.storageClient, state.preview.seedText, {
      size: 320,
      renderMode: 'png-first',
      disableCache: state.preview.disableCache,
      debugBounds: state.preview.debugBounds,
      symmetry: state.preview.symmetry,
      moduleLibrary: state.moduleCatalog,
      showBackground: state.preview.showBackground,
      backgroundFill: 'rgba(6, 14, 24, 0.92)',
      showStars: state.preview.showStars,
      randomSvgColors: state.preview.randomSvgColors,
      gridSize: parsedGridSize.value,
      stages: parsedStages.value,
      maxGlobalRewinds: state.preview.maxGlobalRewinds,
    })
    if (result.kind !== 'png') {
      window.alert('PNG conversion failed; unable to copy this icon as PNG.')
      return
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })])
    labDebug('copyPrimaryPreviewPng success', {
      size: 320,
      seed: state.preview.seedText,
      cacheHit: result.cacheHit,
    })
  } catch (error) {
    console.error('Failed to copy preview PNG to clipboard', error)
    window.alert('Failed to copy PNG to clipboard.')
  }
}

async function resetPreviewCache() {
  try {
    await clearSpaceshipImageCache(props.storageClient)
    resetPreviewGallery()
    touchCatalog('resetPreviewCache')
    window.alert('Spaceship preview cache cleared.')
  } catch (error) {
    console.error('Failed to clear preview cache', error)
    window.alert('Failed to clear spaceship preview cache.')
  }
}

function addModule() {
  state.moduleCatalog.push(createModuleCatalogEntry(state.moduleCatalog.length + 1))
  selectModule(state.moduleCatalog.length - 1)
  touchCatalog()
}

function removeSelectedModule() {
  if (!state.moduleCatalog.length) return
  console.log('remove module!', state.selectedModuleIndex)
  state.moduleCatalog.splice(state.selectedModuleIndex, 1)
  state.selectedModuleIndex = Math.max(
    0,
    Math.min(state.selectedModuleIndex, state.moduleCatalog.length - 1),
  )
  touchCatalog()
}

function resetCatalog() {
  state.moduleCatalog.splice(
    0,
    state.moduleCatalog.length,
    ...cloneModuleLibrary(DEFAULT_MODULE_LIBRARY),
  )
  resetPreviewGallery()
  selectModule(0)
  applyImportedAlgorithmSettings(DEFAULT_ALGORITHM)
  touchCatalog()
}

function applyPatternSize() {
  if (!selectedModule.value) return
  selectedModule.value.pattern = resizePattern(
    selectedModule.value.pattern,
    Math.max(1, Math.round(patternSize.width)),
    Math.max(1, Math.round(patternSize.height)),
    SPACE,
  )
  touchCatalog()
}

function paintCell(x: number, y: number) {
  if (!selectedModule.value) return
  selectedModule.value.pattern[y]![x] = state.activePaintCell
  touchCatalog()
}

function trimSelectedPattern() {
  if (!selectedModule.value) return
  selectedModule.value.pattern = trimPattern(selectedModule.value.pattern)
  patternSize.width = selectedModule.value.pattern[0]?.length ?? 1
  patternSize.height = selectedModule.value.pattern.length
  touchCatalog()
}

function trimPattern(pattern: CellValue[][]) {
  const occupied = pattern.flatMap((row, y) =>
    row
      .map((value, x) => ({ x, y, value }))
      .filter((cell) => cell.value !== SPACE && cell.value !== IGNORE),
  )
  if (!occupied.length) return [[SPACE]]
  const minX = Math.min(...occupied.map((cell) => cell.x))
  const minY = Math.min(...occupied.map((cell) => cell.y))
  const maxX = Math.max(...occupied.map((cell) => cell.x))
  const maxY = Math.max(...occupied.map((cell) => cell.y))
  return pattern.slice(minY, maxY + 1).map((row) => row.slice(minX, maxX + 1))
}

async function uploadModuleSvg(file: File | File[] | null) {
  const picked = Array.isArray(file) ? file[0] : file
  if (!picked || !selectedModule.value) return
  const sanitizedMarkup = sanitizeModuleSvgMarkup(await picked.text())
  selectedModuleSvgMarkupActive.value = typeof sanitizedMarkup === 'string' ? sanitizedMarkup : ''
}

function exportSelectedModuleSvg() {
  if (!selectedModuleForSvgEditor.value) return
  const svg = buildModuleExportSvg(
    selectedModuleForSvgEditor.value,
    state.svgEditor.rotation,
    activeSvgVariantName(),
  )
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${selectedModuleForSvgEditor.value.id || 'module'}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildModuleExportSvg(
  module: SpaceshipModuleDefinition,
  svgRotation = 0,
  variantName = DEFAULT_SVG_VARIANT_NAME,
) {
  const gridWidth = module.pattern[0]?.length ?? 1
  const gridHeight = module.pattern.length ?? 1
  const cellSize = PREVIEW_CELL_SIZE
  const rawWidth = gridWidth * cellSize
  const rawHeight = gridHeight * cellSize
  const parsed = parseSvgMarkup(getModuleVariantMarkup(module, variantName), rawWidth, rawHeight)
  const materializedContent = applyPreviewMaterialTokens(parsed.content)
  const normalizedSvgRotation = ((svgRotation % 4) + 4) % 4
  const ringInset = cellSize * 0.5
  const targetWidth = Math.max(1, rawWidth - ringInset * 2)
  const targetHeight = Math.max(1, rawHeight - ringInset * 2)
  const variantTransform = getModuleVariantTransform(module, variantName)
  const moduleScaleX = variantTransform.scaleX
  const moduleScaleY = variantTransform.scaleY
  const moduleOffsetX = variantTransform.offsetX
  const moduleOffsetY = variantTransform.offsetY
  const baseScaleX = targetWidth / Math.max(1, parsed.width)
  const baseScaleY = targetHeight / Math.max(1, parsed.height)
  const scaleX = baseScaleX * moduleScaleX
  const scaleY = baseScaleY * moduleScaleY
  const translateX = ringInset - parsed.minX * scaleX + moduleOffsetX * cellSize
  const translateY = ringInset - parsed.minY * scaleY + moduleOffsetY * cellSize

  const baseContent = `<g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">${materializedContent}</g>`
  const overlayContent = applyRotationToContent(
    baseContent,
    normalizedSvgRotation,
    rawWidth,
    rawHeight,
  )

  const contentBox = {
    minX: translateX,
    minY: translateY,
    maxX: translateX + parsed.width * scaleX,
    maxY: translateY + parsed.height * scaleY,
  }
  const rotatedBox = rotateBoundingBox(contentBox, normalizedSvgRotation, rawWidth, rawHeight)
  const viewBoxX = Number.isFinite(rotatedBox.minX) ? rotatedBox.minX : 0
  const viewBoxY = Number.isFinite(rotatedBox.minY) ? rotatedBox.minY : 0
  const viewBoxW = Math.max(1, rotatedBox.maxX - rotatedBox.minX)
  const viewBoxH = Math.max(1, rotatedBox.maxY - rotatedBox.minY)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" preserveAspectRatio="xMidYMid meet">${overlayContent}</svg>`
}

function applyRotationToContent(
  content: string,
  normalizedSvgRotation: number,
  rawWidth: number,
  rawHeight: number,
) {
  if (normalizedSvgRotation === 0) return content
  const angle = normalizedSvgRotation * 90
  const centerX = rawWidth / 2
  const centerY = rawHeight / 2
  return `<g transform="rotate(${angle} ${centerX} ${centerY})">${content}</g>`
}

function rotatePointAroundCenter(
  x: number,
  y: number,
  normalizedSvgRotation: number,
  rawWidth: number,
  rawHeight: number,
) {
  if (normalizedSvgRotation === 0) return { x, y }
  const radians = (normalizedSvgRotation * Math.PI) / 2
  const cx = rawWidth / 2
  const cy = rawHeight / 2
  const dx = x - cx
  const dy = y - cy
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }
}

function rotateBoundingBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  normalizedSvgRotation: number,
  rawWidth: number,
  rawHeight: number,
) {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
  ].map((point) =>
    rotatePointAroundCenter(point.x, point.y, normalizedSvgRotation, rawWidth, rawHeight),
  )
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function exportLibraryJson() {
  const payload: SpaceshipLibraryFile = {
    version: 1,
    moduleCatalog: state.moduleCatalog,
    algorithm: {
      symmetry: state.preview.symmetry,
      gridSize: parsedGridSize.value,
      stages: parsedStages.value,
      identiconSize: state.preview.identiconSize,
      randomSvgColors: state.preview.randomSvgColors,
      showBackground: state.preview.showBackground,
      showStars: state.preview.showStars,
    },
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'procedural-spaceship-library.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function importLibraryJson() {
  libraryImportInput.value?.click()
}

async function onImportLibraryFile(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return
  try {
    const parsed = spaceshipLibrarySchema.parse(JSON.parse(await file.text()))
    const modules = parsed.moduleCatalog
    if (!modules.length) throw new Error('JSON does not contain a non-empty moduleCatalog array.')
    state.moduleCatalog.splice(0, state.moduleCatalog.length, ...cloneModuleLibrary(modules))
    resetPreviewGallery()
    sanitizeCatalogSvgMarkup(state.moduleCatalog)
    selectModule(0)
    applyImportedAlgorithmSettings(parsed.algorithm)
    touchCatalog()
  } catch (error) {
    console.error('Failed to import module library JSON', error)
  } finally {
    if (input) input.value = ''
  }
}

function sanitizeCatalogSvgMarkup(catalog: SpaceshipModuleDefinition[]) {
  for (const module of catalog) {
    const sanitizedVariants: Record<string, SpaceshipSvgVariantDefinition> = {}
    for (const [name, variant] of Object.entries(module.svgVariants ?? {})) {
      const key = name.trim()
      if (!key || !variant || typeof variant !== 'object') continue
      const next: SpaceshipSvgVariantDefinition = {
        category: variant.category ?? 'hull',
      }
      if (variant.weight != null && Number.isFinite(Number(variant.weight)))
        next.weight = Math.max(0, Number(variant.weight))
      const sanitizedMarkup = sanitizeModuleSvgMarkup(variant.svgMarkup)
      if (typeof sanitizedMarkup === 'string') next.svgMarkup = sanitizedMarkup
      if (variant.description) next.description = variant.description
      if (variant.transform) {
        const transform: SvgTransformConfig = {}
        if (variant.transform.offsetX != null)
          transform.offsetX = normalizedOffset(variant.transform.offsetX, 0)
        if (variant.transform.offsetY != null)
          transform.offsetY = normalizedOffset(variant.transform.offsetY, 0)
        if (variant.transform.scaleX != null)
          transform.scaleX = normalizedScale(variant.transform.scaleX, 1)
        if (variant.transform.scaleY != null)
          transform.scaleY = normalizedScale(variant.transform.scaleY, 1)
        if (Object.keys(transform).length > 0) next.transform = transform
      }
      sanitizedVariants[key] = next
    }
    module.svgVariants =
      Object.keys(sanitizedVariants).length > 0
        ? sanitizedVariants
        : { [DEFAULT_SVG_VARIANT_NAME]: { category: 'hull' } }
  }
}

function applyImportedAlgorithmSettings(algorithm: SpaceshipLibraryFile['algorithm']) {
  const parsed = spaceshipAlgorithmConfigSchema.parse(algorithm)
  state.preview.symmetry = parsed.symmetry
  state.preview.randomSvgColors = parsed.randomSvgColors
  state.preview.identiconSize = Math.max(
    IDENTICON_SIZE_MIN,
    Math.min(IDENTICON_SIZE_MAX, Math.round(parsed.identiconSize)),
  )
  state.preview.showBackground = parsed.showBackground
  state.preview.showStars = parsed.showStars
  state.preview.stagesJson = JSON.stringify(parsed.stages, null, 2)
  state.preview.gridSizeJson = JSON.stringify(parsed.gridSize, null, 2)
}

function openModuleFromOverview(index: number) {
  selectModule(index)
  const catalogLeaf = dockLayout.value.children?.find((child) => child.id === 'spaceship-catalog')
  if (catalogLeaf?.type === 'leaf') catalogLeaf.activeViewIndex = 0
}

function selectModule(index: number) {
  labDebug('selectModule', {
    previousIndex: state.selectedModuleIndex,
    nextIndex: index,
  })
  state.selectedModuleIndex = index
}

function createSeedString(index: number) {
  const { palettes, frames, crews, missions } = SPACESHIP_SEED_COMPONENTS
  const suffix = seededToken(index)
  return [
    `ship-${index.toString().padStart(4, '0')}`,
    palettes[pickFrom(index, 11, palettes.length)],
    frames[pickFrom(index, 23, frames.length)],
    crews[pickFrom(index, 37, crews.length)],
    missions[pickFrom(index, 53, missions.length)],
    suffix,
  ].join('-')
}

function pickFrom(index: number, salt: number, length: number) {
  return hashNumber(index + salt) % length
}
function seededToken(index: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let value = hashNumber(index + 97)
  let token = ''
  for (let step = 0; step < 5; step += 1) {
    token += alphabet[value % alphabet.length]
    value = Math.floor(value / alphabet.length)
  }
  return token
}
function hashNumber(value: number) {
  let hash = value ^ 0x9e3779b9
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad)
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97)
  return (hash ^ (hash >>> 15)) >>> 0
}

function cellClass(value: CellValue) {
  return {
    'cell-ignore': value === IGNORE,
    'cell-space': value === SPACE,
    'cell-hull': value === HULL,
    'cell-thruster': value === THRUSTER,
    'cell-cockpit': value === COCKPIT,
    'cell-wing': value === WING,
    'cell-stay-away': value === STAY_AWAY,
  }
}
function cellLabel(value: CellValue) {
  return (
    MODULE_CELL_PALETTE.find((entry) => entry.value === value)
      ?.label.slice(0, 1)
      .toUpperCase() ?? '?'
  )
}
function formatBounds(bounds: ReturnType<typeof createSpaceshipScene>['stats']['occupiedBounds']) {
  if (!bounds) return 'none'
  return `${bounds.minX},${bounds.minY} → ${bounds.maxX},${bounds.maxY}`
}

function formatStopReason(
  stopReason: NonNullable<
    ReturnType<typeof createSpaceshipScene>['debug']
  >['stageReports'][number]['stopReason'],
) {
  if (stopReason === 'requirements-satisfied') return 'requirements satisfied'
  if (stopReason === 'no-tiles-for-deficit-categories') return 'no modules available'
  if (stopReason === 'no-candidates-for-deficit-categories') return 'no valid placements'
  if (stopReason === 'attempt-limit-reached') return 'attempt limit reached'
  return stopReason
}

function formatRejectionReasons(
  reasons:
    | Partial<
        Record<
          | 'outside-bounds'
          | 'blocking-cell'
          | 'cell-type-mismatch'
          | 'overlap-cell-disallowed'
          | 'existing-overlap-disallowed'
          | 'overlap-square'
          | 'no-new-cells'
          | 'no-support'
          | 'existing-overlap-allow-ignore-rule'
          | 'existing-overlap-no-ignore-rule',
          number
        >
      >
    | undefined,
) {
  if (!reasons) return ''
  const entries = Object.entries(reasons)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
  if (!entries.length) return ''
  return entries.map(([reason, count]) => `${reason}:${count}`).join(', ')
}
</script>

<style scoped>
.spaceship-lab__hero {
  display: block;
}

.spaceship-lab__subtitle {
  max-width: 52rem;
}

.spaceship-live,
.spaceship-gallery {
  height: 100%;
  overflow: auto;
}

.spaceship-live__canvas {
  position: relative;
  min-height: 320px;
}

.spaceship-live__ship-wrap {
  position: relative;
  width: 320px;
  height: 320px;
}

.spaceship-live__focus-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.spaceship-live__stats {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.spaceship-live__stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.spaceship-lab__dock {
  height: calc(100vh - 170px);
  min-height: 680px;
}

.spaceship-lab__panel {
  height: 100%;
  overflow: auto;
}

.spaceship-lab__module-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.spaceship-lab__module-button {
  text-transform: none;
  min-width: 52px;
  max-width: 156px;
}

.spaceship-lab__module-mini-list {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: center;
}

.spaceship-lab__module-mini-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 24px;
}

.spaceship-lab__module-mini-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.spaceship-lab__pattern-grid-2d {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}

.spaceship-lab__pattern-row {
  display: flex;
  gap: 6px;
}

.spaceship-lab__pattern-cell {
  height: 38px;
  min-width: 38px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: white;
  font-size: 12px;
  cursor: pointer;
}

.spaceship-lab__module-svg-preview {
  min-height: 220px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
  cursor: grab;
  user-select: none;
}

.spaceship-lab__module-svg-preview:active {
  cursor: grabbing;
}

.spaceship-lab__overview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spaceship-lab__overview-item {
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr);
  gap: 14px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  text-align: left;
}

.spaceship-lab__overview-pattern {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
}

.spaceship-lab__overview-cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

.spaceship-lab__overview-svg {
  min-height: 88px;
}

.spaceship-lab__overview-svg-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.spaceship-lab__overview-svg :deep(svg) {
  width: 170px;
  height: 88px;
  display: block;
}

.spaceship-lab__module-svg-preview :deep(svg) {
  width: 100%;
  height: 220px;
  display: block;
}

.spaceship-lab__preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}

.spaceship-lab__preview-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 132px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.cell-ignore {
  background: #5b5b5b;
}

.cell-space {
  background: #161a26;
}

.cell-hull {
  background: #d8dfef;
  color: #162140;
}

.cell-thruster {
  background: #6d788f;
}

.cell-cockpit {
  background: #83d8ff;
  color: #0c2740;
}

.cell-wing {
  background: #8da2ff;
  color: #102057;
}

.spaceship-lab__hidden-input {
  display: none;
}

@media (max-width: 1023px) {
  .spaceship-lab__dock {
    height: auto;
    min-height: 0;
  }

  .spaceship-lab__panel {
    max-height: none;
  }
}
</style>
