<template>
  <q-layout view="hHr lpR lFr">
    <TopBar />

    <q-page-container class="fit">
      <div class="row fit no-wrap">
        <!-- Main split area: router-view (left) + placeholder (right) -->
        <div class="col">
          <q-splitter
            v-model="splitterModel"
            :limits="[MIN_BEFORE, MAX_BEFORE]"
            class="fit"
            separator-class="bg-teal"
            separator-style="width: 3px"
          >
            <!-- Left pane: main app content -->
            <template #before>
              <div class="fit">
                <router-view />
              </div>
            </template>

            <!-- Right pane: placeholder that defines geometry for Taskyon -->
            <template #after>
              <div ref="afterPane" class="fit"></div>
            </template>
          </q-splitter>
        </div>
      </div>
    </q-page-container>

    <!-- Fixed Taskyon rail, ALWAYS in DOM, aligned to splitter's "after" area,
         but height clamped to viewport -->
    <div id="taskyon-rail" class="taskyon-rail" :style="taskyonRailStyle">
      <iframe
        id="taskyon"
        frameborder="0"
        :src="taskyon.tyUrl"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>

    <!-- Fixed toggle button, always same position (right middle) -->
    <div class="taskyon-toggle">
      <q-btn flat class="q-px-xs q-py-md" @click="toggleExpanded">
        <span class="vertical-label">Joulios</span>
      </q-btn>
    </div>
  </q-layout>
</template>

<script setup lang="ts">
import TopBar from 'src/components/TopBar.vue'
import { syncRefsWithLocalStorage } from 'src/modules/saveState'
import { useTaskyonStore } from 'src/stores/taskyon'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

const taskyon = useTaskyonStore()

// q-splitter model: percentage of "before" (left / router) pane
const splitterModel = ref(75) // router takes 75%, Joulios 25% initially

// min/max for the "before" pane
const MIN_BEFORE = 20
const MAX_BEFORE = 100 // when expanded, keep a small min width for Joulios

const isExpanded = ref(true)
const lastSplitterModel = ref(splitterModel.value)

syncRefsWithLocalStorage('AIsplit', { splitterModel, isExpanded, lastSplitterModel })

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const toggleExpanded = () => {
  if (isExpanded.value) {
    // Collapse Joulios: remember current split and push router to 100%
    lastSplitterModel.value = splitterModel.value
    isExpanded.value = false
    splitterModel.value = 100
  } else {
    // Expand Joulios: restore previous split within limits
    isExpanded.value = true
    splitterModel.value = clamp(lastSplitterModel.value || 75, MIN_BEFORE, MAX_BEFORE)
  }
}

// ---- Measure the splitter's "after" pane and align a fixed rail to it ----
const afterPane: Ref<HTMLElement | null> = ref(null)
const railBox = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
})

const updateRailBox = () => {
  const el = afterPane.value
  if (!el) return
  const rect = el.getBoundingClientRect()

  if (rect.width > 0) {
    const top = rect.top
    const height = Math.max(0, window.innerHeight - top) // clamp to viewport

    railBox.value = {
      left: rect.left,
      top,
      width: rect.width,
      height,
    }
  }
}

let resizeObserver: ResizeObserver | undefined

onMounted(async () => {
  // Ensure DOM (including iframe) is rendered before initializing Taskyon
  await nextTick()

  // At this point, <iframe id="taskyon"> definitely exists
  void taskyon.initialize()

  updateRailBox()

  if (afterPane.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => {
      updateRailBox()
    })
    resizeObserver.observe(afterPane.value)
  }

  // Recalculate on window resize (layout / header height may change)
  window.addEventListener('resize', updateRailBox)
  // No scroll listener: we want the rail fixed relative to the viewport
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateRailBox)
})

const taskyonRailStyle = computed(() => {
  const style: Record<string, string> = {
    left: `${railBox.value.left}px`,
    top: `${railBox.value.top}px`,
    width: `${railBox.value.width}px`,
    height: `${railBox.value.height}px`,
  }

  // When not expanded or not yet measured, hide purely via CSS,
  // but keep iframe DOM node alive.
  if (!isExpanded.value || railBox.value.width === 0 || railBox.value.height === 0) {
    style.display = 'none'
  }

  return style
})
</script>

<style scoped lang="sass">
/* Vertical label on the toggle button */
.vertical-label
  writing-mode: vertical-rl
  text-orientation: mixed

/* Fixed toggle button: right middle of the viewport, independent of layout */
.taskyon-toggle
  position: fixed
  right: 0
  top: 50%
  transform: translateY(-50%)
  z-index: 1100

/* Fixed rail:
   - Always in DOM (so iframe never dies)
   - Horizontally aligned with splitter's "after" pane
   - Vertically: top = split-view top, height clamped to viewport
   - Does NOT move on scroll (no scroll-based updates)
   - No background -> transparent, page background shines through.

.taskyon-rail
  position: fixed
  z-index: 1000
  overflow: hidden

  iframe
    width: 100%
    height: 100%
    border: 0
</style>
