<!-- src/pages/DockViewTest.vue -->
<template>
  <q-page class="q-pa-md column">
    <div class="text-h5 q-mb-md">Dockview + Vue slots + createReusableTemplate Demo</div>

    <div class="col bg-grey-10 rounded-borders overflow-hidden">
      <DockView class="full-height">
        <!-- Editor pane -->
        <template #Editor>
          <div class="q-pa-sm column full-height">
            <div class="text-subtitle1 q-mb-sm">Editor</div>
            <q-input
              v-model="editorText"
              type="textarea"
              filled
              autogrow
              class="col"
              label="Type something..."
            />
          </div>
        </template>

        <!-- Console pane -->
        <template #Console>
          <div class="q-pa-sm column full-height">
            <div class="text-subtitle1 q-mb-sm">Console</div>
            <q-scroll-area class="col" style="border: 1px solid rgba(255, 255, 255, 0.1)">
              <pre class="q-pa-sm">{{ editorText }}</pre>
            </q-scroll-area>
          </div>
        </template>

        <!-- Help pane -->
        <template #Help>
          <div class="q-pa-sm column full-height">
            <div class="text-subtitle1 q-mb-sm">Help</div>
            <div class="text-body2">
              <p>This demo shows how to:</p>
              <ul>
                <li>Map named Vue slots to Dockview panels.</li>
                <li>
                  Reuse the slot templates with
                  <code>createReusableTemplate</code>.
                </li>
                <li>Drag, dock, and rearrange the panels freely.</li>
              </ul>
              <p>Try:</p>
              <ol>
                <li>Dragging panel headers to re-arrange panels.</li>
                <li>Docking panels side by side.</li>
              </ol>
            </div>
          </div>
        </template>
      </DockView>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import DockView from 'src/components/DockView.vue'
import { ref, watch, onMounted } from 'vue'

const editorText = ref('Hello Dockview + Vue slots 👋')

console.log('[DockviewSlotsDemoPage] setup: initial editorText:', editorText.value)

watch(
  editorText,
  (newVal, oldVal) => {
    console.log('[DockviewSlotsDemoPage] editorText changed:', {
      old: oldVal,
      new: newVal,
    })
  },
  { immediate: true },
)

onMounted(() => {
  console.log('[DockviewSlotsDemoPage] onMounted')
})
</script>

<style scoped>
.full-height {
  height: 100%;
}

.q-page {
  display: flex;
  flex-direction: column;
}
</style>
