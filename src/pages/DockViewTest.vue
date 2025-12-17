<!-- DockViewTest.vue -->
<template>
  <q-page class="column">
    <header>
      <div>
        <q-icon :name="matAutoAwesomeMosaic" />
        <span class="text-h2">Vue Dock Manager</span>
      </div>
      <!-- Removed the old "Add Editor Tab" / "Add Terminal Tab" buttons -->
    </header>

    <!-- v-model:node -->
    <q-card flat class="col column">
      <DockView v-model:node="layout" class="col" @add-view="handleAddView">
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
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { DockNode, AddViewContext, AddViewDone } from 'components/DockView.vue'
import DockView from 'components/DockView.vue'

import { matAutoAwesomeMosaic } from '@quasar/extras/material-icons'

/* ---------- Initial layout ---------- */

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
    {
      id: 'sidebar',
      type: 'leaf',
      size: 20,
      views: ['Explorer', 'Search'],
      activeViewIndex: 0,
    },
  ],
})

const layout = ref<DockNode>(createInitialLayout())
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
