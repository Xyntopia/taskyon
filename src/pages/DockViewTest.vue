<!-- DockViewTest.vue -->
<template>
  <q-page class="column">
    <span class="text-h4 q-pa-md"> <q-icon :name="matAutoAwesomeMosaic" /> Vue Dock Manager</span>
    <q-toggle
      v-model="showLeaf"
      label="Show leaf as root (no tabs, just content)"
      class="q-ma-md"
    />

    <template v-if="showLeaf">
      <DockView v-model:node="nestedLayout" class="col" hide-tab-add hide-tab-close>
        <template #nested-Explorer>
          <q-card class="fit column">
            <div>nested view! which expands</div>
            <div class="col column justify-around items-center">
              <div v-for="i in 20" :key="i">line {{ i }}</div>
            </div>
          </q-card>
        </template>
        <template #nested-Search>
          <div>search inside nested view!</div>
        </template>
      </DockView>
    </template>
    <!-- If not showing leaf as root, show the full layout with sidebar, editors, and panel -->
    <template v-else>
      <!-- v-model:node -->
      <q-card flat class="col column bg-transparent text-secondary">
        <DockView v-model:node="layout" class="col" @add-view="handleAddView">
          <!-- Explorer View -->
          <template #ExplorerWithAVeryLongName>
            <q-card class="fit">
              <div>Files</div>
              <ul>
                <li>src/App.vue</li>
                <li>src/main.ts</li>
                <li>src/components/DockView.vue</li>
              </ul>
            </q-card>
          </template>

          <!-- Nested View -->
          <template #Nested>
            <DockView v-model:node="nestedLayout" class="fit" hide-tab-add hide-tab-close>
              <template #nested-Explorer>
                <q-card class="fit column">
                  <div>nested view! which expands</div>
                  <div class="col column justify-around items-center">
                    <div v-for="i in 20" :key="i">line {{ i }}</div>
                  </div>
                </q-card>
              </template>
              <template #nested-Search>
                <div>search inside nested view!</div>
              </template>
            </DockView>
          </template>

          <template #Search>
            <q-card>
              <input type="text" placeholder="Search files..." />
              <div>No results</div>
            </q-card>
          </template>

          <!-- Editor Views -->
          <template v-for="view in ['App.vue', 'main.ts', 'styles.css']" :key="view" #[view]>
            <div>
              <div>
                <pre>
// Content of {{ view }}
import { defineComponent } from 'vue';

export default defineComponent({
  name: '{{ view.replace('.vue', '') }}',
  setup() {
    return {};
  }
});</pre
                >
              </div>
            </div>
          </template>

          <!-- Terminal Views -->
          <template #Terminal>
            <div>
              <div>$ npm run dev</div>
              <div>Ready in 300ms.</div>
              <div>> Network: http://localhost:5000/</div>
              <div>_</div>
            </div>
          </template>

          <template #Output>
            <div>
              <div>[Log] Application mounted.</div>
              <div>[Info] Dock layout initialized.</div>
            </div>
          </template>

          <template #KeepAliveTicker>
            <KeepAliveProbe />
          </template>

          <!-- Fallback for dynamically added tabs (editors) -->
          <template v-for="n in 20" :key="getNewFileSlotName(n)" #[getNewFileSlotName(n)]>
            <div>
              <div>New Empty File {{ n }}</div>
            </div>
          </template>

          <!-- Fallback for dynamically added tabs (processes) -->
          <template v-for="n in 20" :key="getProcessSlotName(n)" #[getProcessSlotName(n)]>
            <div>
              <div>Process {{ n }} running...</div>
            </div>
          </template>
        </DockView>
      </q-card>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DockNode, AddViewContext, AddViewDone } from 'components/DockView.vue'
import DockView from 'components/DockView.vue'

import { matAutoAwesomeMosaic } from '@quasar/extras/material-icons'

/* ---------- Initial layout ---------- */

const showLeaf = ref(false)

const KeepAliveProbe = defineComponent({
  name: 'KeepAliveProbe',
  setup() {
    const mountId = ref(`${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`)
    const ticks = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined

    onMounted(() => {
      timer = setInterval(() => {
        ticks.value += 1
      }, 200)
    })

    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
    })

    return () =>
      h('div', { class: 'q-pa-sm' }, [
        h('div', ['Mount ID: ', h('span', { 'data-cy': 'keepalive-mount-id' }, mountId.value)]),
        h('div', ['Ticks: ', h('span', { 'data-cy': 'keepalive-ticks' }, String(ticks.value))]),
        h('div', { class: 'text-caption text-grey-7' }, 'Should keep ticking while minimized'),
      ])
  },
})

const createInitialLayout = (): DockNode => ({
  id: 'root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'main',
      type: 'container',
      direction: 'column',
      size: 80,
      children: [
        {
          id: 'editors',
          type: 'leaf',
          size: 70,
          views: ['App.vue', 'main.ts', 'styles.css', 'Nested'],
          activeViewIndex: 0,
        },
        {
          id: 'panel',
          type: 'leaf',
          size: 30,
          views: ['Terminal', 'Output', 'KeepAliveTicker'],
          keepAliveViews: ['KeepAliveTicker'],
          activeViewIndex: 0,
        },
      ],
    },
    {
      id: 'sidebar',
      type: 'leaf',
      size: 20,
      views: ['ExplorerWithAVeryLongName', 'Search'],
      activeViewIndex: 0,
    },
  ],
})

const layout = ref<DockNode>(createInitialLayout())
const nestedLayout = ref<DockNode>({
  id: 'nested',
  type: 'leaf',
  views: ['nested-Explorer', 'nested-Search'],
  activeViewIndex: 0,
})
const nextId = ref(1)

/* ---------- Helpers for dynamic slot names ---------- */

const getNewFileSlotName = (n: number) => `New_File_${n}`
const getProcessSlotName = (n: number) => `Process_${n}`

/* ---------- Handle add-view from DockView ---------- */

/**
 * Decide what kind of view to add based on which leaf the "+" was clicked in.
 * For now:
 *  - in 'editors' → add New_File_X
 *  - in 'panel'   → add Process_X
 *  - in others    → do nothing
 */
const handleAddView = (ctx: AddViewContext, done: AddViewDone) => {
  if (ctx.leafId === 'editors') {
    const id = nextId.value++
    const viewId = getNewFileSlotName(id)
    done({ viewId, makeActive: true })
  } else if (ctx.leafId === 'panel') {
    const id = nextId.value++
    const viewId = getProcessSlotName(id)
    done({ viewId, makeActive: true })
  } else {
    // For now, do nothing for sidebar or unknown leaves
    done(null)
  }
}
</script>
