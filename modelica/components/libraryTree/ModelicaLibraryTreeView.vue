<template>
  <q-card flat class="fit column">
    <div class="row items-center q-pa-sm q-gutter-sm">
      <q-input v-model="filterText" dense outlined clearable label="Filter classes" class="col" />
      <q-btn
        flat
        dense
        round
        :disable="loading || mslLoading || mslDownloading"
        :loading="loading || mslLoading || mslDownloading"
        :icon="mdiFolderOpenOutline"
        @click="triggerLibraryImport"
      >
        <q-tooltip>Load library</q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        round
        :disable="loading || mslLoading || mslDownloading"
        :icon="mdiCached"
        @click="emit('load-cached-msl')"
      >
        <q-tooltip>Load cached MSL</q-tooltip>
      </q-btn>
      <q-btn-dropdown
        flat
        dense
        round
        :disable="loading || mslLoading || mslDownloading"
        :icon="mdiDotsVertical"
        dropdown-icon=""
      >
        <q-tooltip>Library options</q-tooltip>
        <q-list dense style="min-width: 220px">
          <q-item v-close-popup clickable @click="triggerLibraryImport">
            <q-item-section avatar>
              <q-icon :name="mdiFolderOpenOutline" />
            </q-item-section>
            <q-item-section>Load library ZIP file</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="emit('load-cached-msl')">
            <q-item-section avatar>
              <q-icon :name="mdiCached" />
            </q-item-section>
            <q-item-section>Load cached MSL</q-item-section>
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
      <q-btn flat dense :icon="mdiUnfoldMoreHorizontal" @click="expandRootNodes" />
      <q-btn flat dense :icon="mdiUnfoldLessHorizontal" @click="collapseAllNodes" />
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
        :virtual-scroll-item-size="32"
      >
        <template #default="{ item }">
          <div
            class="library-tree-row row items-center no-wrap"
            :class="{ 'library-tree-row--branch': item.hasChildren && !hasFilter }"
            :style="{ paddingLeft: `${item.depth * 14 + 6}px` }"
            @click="onRowClick(item)"
            @dblclick="emit('openModel', item.qualifiedName)"
          >
            <div class="library-tree-row__icon">
              <q-icon
                v-if="item.hasChildren && !hasFilter"
                size="18px"
                :name="item.expanded ? mdiChevronDown : mdiChevronRight"
              />
            </div>

            <div class="ellipsis">{{ item.label }}</div>
            <q-space />
            <q-chip v-if="item.classType" dense size="sm" color="grey-3" text-color="grey-8">
              {{ item.classType }}
            </q-chip>
          </div>
        </template>
      </q-virtual-scroll>

      <div v-else class="q-pa-md text-grey-7">No classes loaded</div>
    </div>
  </q-card>
</template>

<script setup lang="ts">
import {
  mdiCached,
  mdiChevronDown,
  mdiChevronRight,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiDownloadOutline,
  mdiFolderOpenOutline,
  mdiUnfoldLessHorizontal,
  mdiUnfoldMoreHorizontal,
} from '@quasar/extras/mdi-v6'
import {
  buildFilteredRows,
  buildVisibleRows,
  collapseAll,
  createTreeIndex,
  expandRoots,
  toggleExpandedId,
} from '../../../modules/tree/flatTree'
import { computed, ref } from 'vue'
import type { ModelicaLibraryTreeNode } from './types'

const props = defineProps<{
  loading: boolean
  mslLoading: boolean
  mslDownloading: boolean
  mslCachedZipPath: string
  nodes: ModelicaLibraryTreeNode[]
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'openModel', qualifiedName: string): void
  (e: 'import-library-file', ev: Event): void
  (e: 'load-cached-msl'): void
  (e: 'download-msl'): void
  (e: 'clear-msl'): void
}>()

const filterText = ref('')
const expandedIds = ref<string[]>([])
const libraryImportEl = ref<HTMLInputElement | null>(null)

const treeIndex = computed(() => createTreeIndex(props.nodes))
const hasFilter = computed(() => filterText.value.trim().length > 0)
const mslLoading = computed(() => props.mslLoading)
const mslDownloading = computed(() => props.mslDownloading)

const visibleRows = computed(() => {
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
    depth,
    hasChildren,
    expanded,
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

function onLibraryImportChange(ev: Event) {
  emit('import-library-file', ev)
}

function onRowClick(item: { id: string; hasChildren: boolean }) {
  if (!item.hasChildren || hasFilter.value) return
  toggleNode(item.id)
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
</style>
