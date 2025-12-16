<!-- src/components/DockviewFromSlots.vue -->
<template>
  <div class="dockview-container">
    <DockviewVue
      class="dockview-theme-abyss full-size"
      :components="components"
      :options="options"
      @ready="onReady"
    />

    <!-- Hidden reusable templates: one per named slot -->
    <template v-for="name in slotNames" :key="name">
      <!-- templates[name][0] === DefineTemplateComponent -->
      <component :is="templates[name]![0]" v-slot="slotProps">
        <!--
          Forward any props from ReuseTemplate to user slots, in case
          you want to use them later (for data, params, etc.)
        -->
        <slot :name="name" v-bind="slotProps" />
      </component>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, h, useSlots, reactive, type Component } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { DockviewVue, type DockviewReadyEvent } from 'dockview-vue'

// Make sure this is imported once in your app (can be here or in main.ts)
import 'dockview-core/dist/styles/dockview.css'

// Grab all named slots from the parent
const vueSlots = useSlots()

// Names of slots => names of Dockview components/panels
const slotNames = computed(() => Object.keys(vueSlots))

// For each slot we store a tuple: [DefineTemplate, ReuseTemplate]
type TemplatePair = ReturnType<typeof createReusableTemplate>
const templates = reactive<Record<string, TemplatePair>>({})

// Initialize template pairs for each slot
for (const name of slotNames.value) {
  templates[name] = createReusableTemplate()
}

// Create Dockview component definitions for each slot
const components = computed<Record<string, Component>>(() => {
  const result: Record<string, Component> = {}

  for (const name of slotNames.value) {
    const pair = templates[name]
    if (!pair) continue
    const ReuseTemplate = pair[1] // [1] === ReuseTemplateComponent

    // Each Dockview component just renders the corresponding ReuseTemplate
    result[name] = {
      setup() {
        return () => h(ReuseTemplate)
      },
    } as Component
  }

  return result
})

// Dockview options (customize as needed or expose as props)
const options = {
  // e.g. floating: false
}

const onReady = (event: DockviewReadyEvent) => {
  const api = event.api
  const names = slotNames.value

  if (!names.length) return

  const [first, ...rest] = names

  if (first)
    // Add first panel as root
    api.addPanel({
      id: first,
      component: first,
      title: first,
    })

  // Add remaining panels to the right of the first one
  for (const name of rest) {
    api.addPanel({
      id: name,
      component: name,
      title: name,
      position: {
        referencePanel: first,
        direction: 'right',
      },
    })
  }
}
</script>

<style scoped>
.dockview-container {
  width: 100%;
  height: 100%;
  min-height: 300px;
  position: relative;
}

.full-size {
  width: 100%;
  height: 100%;
}
</style>
