<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo">
        <q-icon :name="matAutoAwesomeMosaic" />
        <span>Vue Dock Manager</span>
      </div>
      <div class="controls">
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

    <main class="dock-area">
      <!-- New API: v-model:node -->
      <DockView v-model:node="layout">
        <!-- Explorer View -->
        <template #Explorer>
          <div class="panel-content sidebar">
            <h3>Files</h3>
            <ul>
              <li>src/App.vue</li>
              <li>src/main.ts</li>
              <li>src/components/DockView.vue</li>
            </ul>
          </div>
        </template>

        <template #Search>
          <div class="panel-content sidebar">
            <input type="text" placeholder="Search files..." class="search-input" />
            <div class="empty-state">No results</div>
          </div>
        </template>

        <!-- Editor Views -->
        <template v-for="view in ['App.vue', 'main.ts', 'styles.css']" :key="view" #[view]>
          <div class="panel-content editor">
            <div class="line-numbers">
              <span v-for="n in 20" :key="n">{{ n }}</span>
            </div>
            <div class="code">
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
          <div class="panel-content terminal">
            <div>$ npm run dev</div>
            <div class="success">Ready in 300ms.</div>
            <div>> Network: http://localhost:5000/</div>
            <div class="cursor">_</div>
          </div>
        </template>

        <template #Output>
          <div class="panel-content terminal">
            <div>[Log] Application mounted.</div>
            <div>[Info] Dock layout initialized.</div>
          </div>
        </template>

        <!-- Fallback for dynamically added tabs -->
        <template v-for="n in 20" :key="getNewFileSlotName(n)" #[getNewFileSlotName(n)]>
          <div class="panel-content editor">
            <div class="empty-state">New Empty File {{ n }}</div>
          </div>
        </template>

        <template v-for="n in 20" :key="getProcessSlotName(n)" #[getProcessSlotName(n)]>
          <div class="panel-content terminal">
            <div>Process {{ n }} running...</div>
          </div>
        </template>
      </DockView>
    </main>
  </div>
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

<style>
:root {
  --bg-dark: #1e1e1e;
  --bg-darker: #181818;
  --bg-light: #252526;
  --border: #3e3e3e;
  --accent: #007fd4;
  --text: #cccccc;
  --text-muted: #858585;
}

body,
html,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans',
    'Helvetica Neue', sans-serif;
  background-color: var(--bg-dark);
  color: var(--text);
  overflow: hidden;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  height: 40px;
  background-color: var(--bg-light);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  justify-content: space-between;
}

.logo {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.controls {
  display: flex;
  gap: 8px;
}

.btn {
  background: var(--accent);
  border: none;
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn:hover {
  opacity: 0.9;
}

.dock-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* Panel Content Styles (unchanged, just theming the inner views) */
.panel-content {
  height: 100%;
  width: 100%;
  overflow: auto;
  position: relative;
}

.panel-content.sidebar {
  padding: 10px;
  background-color: var(--bg-light);
}

.panel-content.sidebar ul {
  list-style: none;
  padding: 0;
  margin-top: 10px;
}

.panel-content.sidebar li {
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.panel-content.sidebar li:hover {
  background-color: #2a2d2e;
  color: var(--text);
}

.search-input {
  width: 100%;
  padding: 6px;
  background: #3c3c3c;
  border: 1px solid transparent;
  color: white;
  border-radius: 2px;
}

.search-input:focus {
  border-color: var(--accent);
  outline: none;
}

.panel-content.editor {
  display: flex;
  background-color: var(--bg-dark);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
}

.line-numbers {
  width: 50px;
  background-color: var(--bg-dark);
  color: #6e7681;
  text-align: right;
  padding-right: 15px;
  padding-top: 10px;
  user-select: none;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
}

.code {
  flex: 1;
  padding: 10px;
}

.panel-content.terminal {
  background-color: var(--bg-dark);
  padding: 10px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.success {
  color: #4ec9b0;
}

.cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}
</style>
