<template>
  <q-page class="column">
    <header>
      <div>
        <q-icon :name="matAutoAwesomeMosaic" />
        <span class="text-h2">Vue Dock Manager</span>
      </div>
      <div>
        <q-btn
          flat
          label="Add Editor Tab"
          :icon="matAdd"
          @click="addView('editors', `New_File_${nextId++}`)"
        />
        <q-btn
          flat
          label="Add Terminal Tab"
          :icon="matAdd"
          @click="addView('panel', `Process_${nextId++}`)"
        />
      </div>
    </header>

    <!-- New API: v-model:node -->
    <DockView v-model:node="layout" class="col">
      <!-- Explorer View -->
      <template #Explorer>
        <q-card class="fit">
          <div>Files</div>
          <ul>
            <li>src/App.vue</li>
            <li>src/main.ts</li>
            <li>src/components/DockView.vue</li>
          </ul>
        </q-card>
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

      <!-- Fallback for dynamically added tabs -->
      <template v-for="n in 20" :key="getNewFileSlotName(n)" #[getNewFileSlotName(n)]>
        <div>
          <div>New Empty File {{ n }}</div>
        </div>
      </template>

      <template v-for="n in 20" :key="getProcessSlotName(n)" #[getProcessSlotName(n)]>
        <div>
          <div>Process {{ n }} running...</div>
        </div>
      </template>
    </DockView>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { DockNode } from 'components/DockView.vue'
import DockView from 'components/DockView.vue'

/* icons omitted here – keep your own imports */
import { matAdd, matAutoAwesomeMosaic } from '@quasar/extras/material-icons'

/* ---------- Initial layout ---------- */

const createInitialLayout = (): DockNode => ({
  id: 'root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'sidebar',
      type: 'leaf',
      size: 20,
      views: ['Explorer', 'Search'],
      activeViewIndex: 0,
    },
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
          views: ['App.vue', 'main.ts', 'styles.css'],
          activeViewIndex: 0,
        },
        {
          id: 'panel',
          type: 'leaf',
          size: 30,
          views: ['Terminal', 'Output'],
          activeViewIndex: 0,
        },
      ],
    },
  ],
})

const layout = ref<DockNode>(createInitialLayout())
const nextId = ref(1)

/* ---------- Pure helpers for tree updates ---------- */

// Generic depth-first update by id (returns a new tree)
const updateNodeById = (
  node: DockNode,
  targetId: string,
  updater: (node: DockNode) => DockNode,
): DockNode => {
  if (node.id === targetId) {
    return updater(node)
  }

  if (node.type === 'container' && node.children && node.children.length) {
    let changed = false
    const newChildren = node.children.map((child) => {
      const updated = updateNodeById(child, targetId, updater)
      if (updated !== child) changed = true
      return updated
    })
    if (changed) {
      return { ...node, children: newChildren }
    }
  }

  return node
}

const addViewToLeaf = (node: DockNode, name: string): DockNode => {
  if (node.type !== 'leaf') return node
  const views = [...(node.views ?? []), name]
  return { ...node, views, activeViewIndex: views.length - 1 }
}

/* ---------- Actions ---------- */

const addView = (target: 'editors' | 'sidebar' | 'panel', name: string) => {
  layout.value = updateNodeById(layout.value, target, (n) => addViewToLeaf(n, name))
}

// Helpers for dynamic slot names
const getNewFileSlotName = (n: number) => `New_File_${n}`
const getProcessSlotName = (n: number) => `Process_${n}`
</script>
