<template>
  <q-card flat class="fit column">
    <div class="row items-center justify-around q-pa-sm q-gutter-sm">
      <q-input
        :model-value="filterText"
        dense
        outlined
        clearable
        label="Filter classes"
        class="col-12"
        @update:model-value="onFilterInput"
        @clear="clearFilter"
      />
      <q-btn
        flat
        dense
        size="sm"
        label="MSL"
        :disable="loading || mslBusy"
        :loading="mslBusy"
        @click="emit('load-cached-msl')"
      >
        <q-tooltip>Load standard Modelica Standard Library</q-tooltip>
      </q-btn>
      <q-btn-dropdown flat dense size="sm" :icon="mdiDotsVertical" dropdown-icon="">
        <q-tooltip>Library options</q-tooltip>
        <div class="q-pa-sm" style="min-width: 360px; max-width: 95vw">
          <ObjectView
            v-model="libraryMenuModel"
            :schema="libraryMenuSchema"
            class="fit"
            dense
            missing-mode="hide"
          />
        </div>
        <q-separator />
        <q-list dense style="min-width: 260px">
          <q-item v-close-popup clickable @click="openLibrariesDialog">
            <q-item-section avatar>
              <q-icon :name="mdiTableSearch" />
            </q-item-section>
            <q-item-section>Open Library Installer (Browse & Install)</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="triggerLibraryImport">
            <q-item-section avatar>
              <q-icon :name="mdiFolderOpenOutline" />
            </q-item-section>
            <q-item-section>Load library ZIP file</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="emit('download-msl')">
            <q-item-section avatar>
              <q-icon :name="mdiDownloadOutline" />
            </q-item-section>
            <q-item-section>Download MSL to cache</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="emit('clear-msl')">
            <q-item-section avatar>
              <q-icon :name="mdiDeleteOutline" />
            </q-item-section>
            <q-item-section>Clear loaded libraries</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
      <q-btn flat dense size="sm" :icon="mdiUnfoldMoreHorizontal" @click="expandRootNodes" />
      <q-btn flat dense size="sm" :icon="mdiUnfoldLessHorizontal" @click="collapseAllNodes" />
      <q-btn flat dense size="sm" :icon="matMyLocation" @click="revealCurrentClassOrPackage">
        <q-tooltip>Reveal current class/package in tree</q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        size="sm"
        :label="showRootMetadata ? 'Meta On' : 'Meta Off'"
        @click="showRootMetadata = !showRootMetadata"
      />
    </div>
    <input
      ref="libraryImportEl"
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      style="display: none"
      @change="onLibraryImportChange"
    />
    <q-separator />
    <div class="col" style="overflow: hidden">
      <q-virtual-scroll
        v-if="visibleRows.length > 0"
        :items="visibleRows"
        class="fit"
        :virtual-scroll-item-size="48"
      >
        <template #default="{ item }">
          <div
            v-if="showRootMetadata && item.depth === 0 && item.rootMetadata"
            class="library-root-meta text-caption text-grey-6"
            :style="{ paddingLeft: `${item.depth * 14 + 6}px` }"
          >
            {{ item.rootMetadata }}
          </div>
          <div
            class="library-tree-row row items-center no-wrap"
            :class="{ 'library-tree-row--branch': item.hasChildren && !hasFilter }"
            :style="{ paddingLeft: `${item.depth * 14 + 6}px` }"
            :data-qualified-name="item.qualifiedName"
            @click="onRowClick(item)"
            @dblclick="emit('openModel', item.qualifiedName)"
            @contextmenu.prevent="onRowContextMenu(item, $event)"
          >
            <div class="library-tree-row__icon">
              <q-icon
                v-if="item.hasChildren && !hasFilter"
                size="18px"
                :name="item.expanded ? mdiChevronDown : mdiChevronRight"
              />
            </div>
            <q-icon size="16px" class="q-mr-xs text-grey-6" :name="item.classIconName" />

            <div class="ellipsis">{{ item.label }}</div>
            <q-space />
            <q-chip v-if="item.classType" dense size="sm" color="grey-3" text-color="grey-8">
              {{ item.classType }} · {{ item.descendantCount }}
            </q-chip>
          </div>
        </template>
      </q-virtual-scroll>

      <div v-else class="q-pa-md text-grey-7">No classes loaded</div>
    </div>
    <q-dialog v-model="showLibrariesDialog">
      <q-card class="column library-installer-dialog">
        <q-card-section class="col" style="overflow: auto">
          <div class="row no-wrap items-center">
            <div class="col text-h6">Modelica Library Installer</div>
            <q-btn v-close-popup flat dense :icon="matClose" />
          </div>
          <q-table
            flat
            dense
            row-key="id"
            :rows="downloadableLibraries"
            :columns="downloadableLibraryColumns"
            table-style="table-layout: fixed; width: 100%;"
            :wrap-cells="true"
            :pagination="{ rowsPerPage: 25 }"
          >
            <template #body-cell-action="scope">
              <q-td :props="scope" class="table-cell-wrap">
                <div class="row no-wrap q-gutter-xs">
                  <q-btn
                    dense
                    size="sm"
                    color="primary"
                    label="Install"
                    :disable="!scope.row.installUrl"
                    @click="emit('load-library-preset', scope.row.installUrl)"
                  >
                    <q-tooltip>
                      {{
                        scope.row.mirrorUrl
                          ? 'Install from Taskyon mirror'
                          : 'Install from upstream'
                      }}
                    </q-tooltip>
                  </q-btn>
                  <q-btn
                    dense
                    size="sm"
                    flat
                    label="Original"
                    :disable="!scope.row.upstreamUrl"
                    @click="emit('load-library-preset', scope.row.upstreamUrl)"
                  >
                    <q-tooltip>Install from original source URL</q-tooltip>
                  </q-btn>
                </div>
              </q-td>
            </template>
            <template #body-cell-name="scope">
              <q-td :props="scope" class="table-cell-wrap">{{ String(scope.value || '') }}</q-td>
            </template>
            <template #body-cell-license="scope">
              <q-td :props="scope" class="table-cell-wrap">{{ String(scope.value || '') }}</q-td>
            </template>
            <template #body-cell-description="scope">
              <q-td :props="scope" class="table-cell-wrap">{{ String(scope.value || '') }}</q-td>
            </template>
            <template #body-cell-link="scope">
              <q-td :props="scope" class="table-cell-wrap">
                <a :href="String(scope.value || '')" target="_blank" rel="noopener noreferrer">
                  {{ String(scope.value || '') }}
                </a>
              </q-td>
            </template>
            <template #body-cell-mirrorUrl="scope">
              <q-td :props="scope" class="table-cell-wrap">
                <a
                  v-if="scope.value"
                  :href="String(scope.value || '')"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ String(scope.value || '') }}
                </a>
                <span v-else class="text-grey-6">Not mirrored</span>
              </q-td>
            </template>
            <template #body-cell-upstreamUrl="scope">
              <q-td :props="scope" class="table-cell-wrap">
                <a :href="String(scope.value || '')" target="_blank" rel="noopener noreferrer">
                  {{ String(scope.value || '') }}
                </a>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </q-dialog>
    <ResponsiveMenuDialog
      v-model="showRowContextMenu"
      :context-menu="true"
      :target="contextMenuTarget"
      auto-close
      data-cy="modelica-library-tree-context-menu"
    >
      <template #default="{ close }">
        <q-list dense style="min-width: 180px">
          <q-item clickable @click="onContextMenuOpen(close)">
            <q-item-section>Open</q-item-section>
          </q-item>
          <q-item clickable @click="onContextMenuCopyPath(close)">
            <q-item-section>Copy Path</q-item-section>
          </q-item>
        </q-list>
      </template>
    </ResponsiveMenuDialog>
  </q-card>
</template>

<script setup lang="ts">
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiDownloadOutline,
  mdiFolderOpenOutline,
  mdiTableSearch,
  mdiUnfoldLessHorizontal,
  mdiUnfoldMoreHorizontal,
} from '@quasar/extras/mdi-v6'
import type { JSONSchema7 } from 'json-schema'
import { Notify, type QTableColumn } from 'quasar'
import {
  buildFilteredRows,
  buildVisibleRows,
  collapseAll,
  createTreeIndex,
  expandRoots,
  toggleExpandedId,
} from '../../../modules/tree/flatTree'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ObjectView from '../../../components/varViews/ObjectView.vue'
import ResponsiveMenuDialog from '../../../components/ResponsiveMenuDialog.vue'
import {
  detectedModelicaLibraryPresets,
  downloadableModelicaLibraries,
  refreshModelicaLibraryManifestFromMirror,
} from '../../modelicaLibraryCatalog'
import type { ModelicaLibraryTreeNode } from './types'
import {
  matAccountTree,
  matArchitecture,
  matCallSplit,
  matDataObject,
  matFunctions,
  matInventory2,
  matSettingsEthernet,
  matWidgets,
  matClose,
  matMyLocation,
} from '@quasar/extras/material-icons'
import { copyToClipboard } from '../../../modules/utils'

const props = defineProps<{
  loading: boolean
  mslLoading: boolean
  mslDownloading: boolean
  activeLibraryLoads: string[]
  mslCachedZipPath: string
  libraryMenuOptions: Record<string, unknown>
  libraryMenuSchema: JSONSchema7
  nodes: ModelicaLibraryTreeNode[]
  currentQualifiedName?: string
  rootLibraryMetadata?: Record<string, string>
  showRootMetadata?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'openModel', qualifiedName: string): void
  (e: 'import-library-file', ev: Event): void
  (e: 'load-cached-msl'): void
  (e: 'download-msl'): void
  (e: 'clear-msl'): void
  (e: 'load-library-preset', url: string): void
  (e: 'update:show-root-metadata', value: boolean): void
  (e: 'update:library-menu-options', value: Record<string, unknown>): void
}>()

const filterText = ref('')
const expandedIds = ref<string[]>([])
const libraryImportEl = ref<HTMLInputElement | null>(null)
const showLibrariesDialog = ref(false)
const showRowContextMenu = ref(false)
const contextMenuTarget = ref<string | boolean | Element | undefined>(undefined)
const contextMenuItem = ref<{
  qualifiedName: string
  hasChildren: boolean
} | null>(null)

const treeIndex = computed(() => createTreeIndex(props.nodes))
const hasFilter = computed(() => filterText.value.trim().length > 0)
const mslDownloading = computed(() => props.mslDownloading)
const activeLibraryLoads = computed(() => props.activeLibraryLoads)
const mslBusy = computed(() => mslDownloading.value || activeLibraryLoads.value.length > 0)
const detectedLibraryPresets = computed(() => detectedModelicaLibraryPresets.value)
const downloadableLibraries = computed(() => downloadableModelicaLibraries.value)
const downloadableLibraryColumns: QTableColumn[] = [
  { name: 'action', label: '', field: 'action', sortable: false, align: 'left' },
  { name: 'name', label: 'Name', field: 'name', sortable: true, align: 'left' },
  { name: 'license', label: 'License', field: 'license', sortable: true, align: 'left' },
  { name: 'mirrorUrl', label: 'Mirror', field: 'mirrorUrl', sortable: false, align: 'left' },
  {
    name: 'upstreamUrl',
    label: 'Original',
    field: 'upstreamUrl',
    sortable: false,
    align: 'left',
  },
  {
    name: 'description',
    label: 'Description',
    field: 'description',
    sortable: false,
    align: 'left',
  },
  { name: 'link', label: 'Link', field: 'link', sortable: false, align: 'left' },
]
const libraryMenuModel = computed({
  get: () => props.libraryMenuOptions,
  set: (value: Record<string, unknown>) => emit('update:library-menu-options', value),
})
const showRootMetadata = computed({
  get: () => Boolean(props.showRootMetadata),
  set: (value: boolean) => emit('update:show-root-metadata', Boolean(value)),
})

onMounted(() => {
  console.info(
    '[modelica-library-tree] mounted, detected preset count:',
    detectedLibraryPresets.value.length,
  )
  console.info(
    '[modelica-library-tree] detected presets:',
    detectedLibraryPresets.value.map((preset) => ({ id: preset.id, url: preset.url })),
  )
})

watch(
  detectedLibraryPresets,
  (next) => {
    console.info('[modelica-library-tree] detected presets updated:', next.length)
  },
  { immediate: false },
)

const visibleRows = computed(() => {
  const descendantCount = (node: ModelicaLibraryTreeNode): number =>
    1 + (node.children ?? []).reduce((sum, child) => sum + descendantCount(child), 0)
  const iconForClassType = (classType: string | undefined): string => {
    const normalized = String(classType || '').toLowerCase()
    if (normalized === 'model') return matWidgets
    if (normalized === 'block') return matCallSplit
    if (normalized === 'package') return matInventory2
    if (normalized === 'function') return matFunctions
    if (normalized === 'record') return matDataObject
    if (normalized === 'connector') return matSettingsEthernet
    if (normalized === 'type') return matArchitecture
    if (normalized === 'class') return matAccountTree
    return matInventory2
  }
  const toRow = (
    node: ModelicaLibraryTreeNode,
    id: string,
    depth: number,
    expanded: boolean,
    hasChildren: boolean,
  ) => ({
    id,
    label: node.label,
    qualifiedName: node.qualifiedName,
    classType: node.classType,
    classIconName: iconForClassType(node.classType),
    descendantCount: descendantCount(node),
    depth,
    hasChildren,
    expanded,
    rootMetadata:
      depth === 0 ? String(props.rootLibraryMetadata?.[node.qualifiedName] || '').trim() : '',
  })

  if (hasFilter.value) {
    const matches = (node: ModelicaLibraryTreeNode, queryLower: string): boolean =>
      node.label.toLowerCase().includes(queryLower) ||
      node.qualifiedName.toLowerCase().includes(queryLower) ||
      String(node.classType || '')
        .toLowerCase()
        .includes(queryLower)

    return buildFilteredRows(treeIndex.value, filterText.value, matches, toRow)
  }

  return buildVisibleRows(treeIndex.value, expandedIds.value, toRow)
})

function toggleNode(id: string) {
  expandedIds.value = toggleExpandedId(expandedIds.value, id)
}

function collapseAllNodes() {
  expandedIds.value = collapseAll()
}

function expandRootNodes() {
  expandedIds.value = expandRoots(treeIndex.value)
}

function triggerLibraryImport() {
  libraryImportEl.value?.click()
}

async function openLibrariesDialog() {
  showLibrariesDialog.value = true
  try {
    await refreshModelicaLibraryManifestFromMirror()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    Notify.create({
      type: 'warning',
      message: `Using bundled Modelica library manifest: ${message}`,
    })
  }
}

function onFilterInput(value: string | number | null) {
  filterText.value = value == null ? '' : String(value)
}

function clearFilter() {
  filterText.value = ''
}

function onLibraryImportChange(ev: Event) {
  emit('import-library-file', ev)
}

function onRowClick(item: { id: string; hasChildren: boolean }) {
  if (!item.hasChildren || hasFilter.value) return
  toggleNode(item.id)
}

function onRowContextMenu(
  item: { qualifiedName: string; hasChildren: boolean },
  event: MouseEvent,
) {
  contextMenuItem.value = item
  contextMenuTarget.value = (event.currentTarget as Element | null) ?? undefined
  showRowContextMenu.value = true
}

function onContextMenuOpen(close: () => void) {
  const item = contextMenuItem.value
  if (item?.qualifiedName) emit('openModel', item.qualifiedName)
  close()
}

function onContextMenuCopyPath(close: () => void) {
  const item = contextMenuItem.value
  if (item?.qualifiedName) void copyToClipboard(item.qualifiedName)
  close()
}

const findClosestVisiblePathTarget = (qualifiedName: string): string | null => {
  const normalized = String(qualifiedName || '').trim()
  if (!normalized) return null
  const ids = Object.keys(treeIndex.value.nodeById)
  if (ids.includes(normalized)) return normalized
  const byLower = new Map(ids.map((id) => [id.toLowerCase(), id] as const))
  const exactLower = byLower.get(normalized.toLowerCase())
  if (exactLower) return exactLower
  const parts = normalized
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  for (let i = parts.length; i >= 1; i -= 1) {
    const candidate = parts.slice(0, i).join('.')
    if (treeIndex.value.nodeById[candidate]) return candidate
    const candidateLower = byLower.get(candidate.toLowerCase())
    if (candidateLower) return candidateLower
  }
  const targetLower = normalized.toLowerCase()
  const suffixHit = ids.find((id) => {
    const idLower = id.toLowerCase()
    return idLower === targetLower || idLower.endsWith(`.${targetLower}`)
  })
  if (suffixHit) return suffixHit
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const tail = parts.slice(i).join('.').toLowerCase()
    const tailHit = ids.find((id) => {
      const idLower = id.toLowerCase()
      return idLower === tail || idLower.endsWith(`.${tail}`)
    })
    if (tailHit) return tailHit
  }
  return null
}

const collectAncestorIds = (id: string): string[] => {
  const ancestors: string[] = []
  let cursor = treeIndex.value.parentById[id] ?? null
  while (cursor) {
    ancestors.push(cursor)
    cursor = treeIndex.value.parentById[cursor] ?? null
  }
  return ancestors
}

async function revealCurrentClassOrPackage() {
  const targetId = findClosestVisiblePathTarget(props.currentQualifiedName || '')
  if (!targetId) {
    Notify.create({
      type: 'info',
      message: `Could not find current class/package in loaded libraries: ${String(props.currentQualifiedName || '(empty)')}`,
    })
    return
  }
  filterText.value = ''
  const ancestorIds = collectAncestorIds(targetId)
  expandedIds.value = Array.from(new Set([...expandedIds.value, ...ancestorIds]))
  await nextTick()
  const escaped = CSS.escape(targetId)
  let row = document.querySelector<HTMLElement>(`[data-qualified-name="${escaped}"]`)
  if (!row) row = document.querySelector<HTMLElement>(`[data-qualified-name="${targetId}"]`)
  if (!row) {
    Notify.create({
      type: 'info',
      message: `Found ${targetId}, but its row is not currently visible.`,
    })
    return
  }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
</script>

<style scoped>
.library-tree-row {
  position: relative;
  min-height: 28px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  cursor: default;
  border-radius: 4px;
  transition:
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.library-root-meta {
  padding-top: 4px;
  padding-bottom: 2px;
  opacity: 0.85;
}

.library-tree-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background-color 120ms ease;
}

.library-tree-row:hover {
  background-color: rgba(255, 255, 255, 0.09);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.library-tree-row:hover::before {
  background: rgba(255, 255, 255, 0.22);
}

.library-tree-row--branch {
  cursor: pointer;
}

.library-tree-row__icon {
  width: 20px;
  min-width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.library-installer-dialog {
  width: min(1200px, 100vw);
  max-width: 100vw;
  max-height: 95vh;
}

.table-cell-wrap {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  vertical-align: top;
}

:deep(.q-table__middle) {
  overflow-x: hidden;
}

:deep(.q-table) {
  width: 100%;
}
</style>
