<template>
  <div class="graph-canvas-wrap">
    <button type="button" class="copy-btn" :disabled="copying" @click="onCopyPng">
      {{ copyLabel }}
    </button>
    <div ref="containerRef" class="graph-canvas"></div>
  </div>
</template>

<script setup lang="ts">
import {
  createGraphController,
  type GraphData,
  type LayoutEdge,
  type LayoutNode,
  type RenderOptions,
} from '@taskyon/common/modules/graph'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  graph: GraphData
  options?: RenderOptions
}>()

const containerRef = ref<HTMLElement | null>(null)
let controller: ReturnType<typeof createGraphController> | null = null
let resizeObserver: ResizeObserver | null = null
const copying = ref(false)
const copyLabel = ref('Copy PNG')

const makeRuntimeOptions = (): RenderOptions => {
  const base = props.options ?? {}
  return {
    enablePanZoom: true,
    nodeTooltipHtml: (node: LayoutNode) =>
      `<div><strong>${node.label ?? node.id}</strong><div>${node.id}</div></div>`,
    edgeTooltipHtml: (edge: LayoutEdge) =>
      edge.label ? `<div><strong>${edge.label}</strong></div>` : `<div>${edge.id}</div>`,
    ...base,
  }
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  controller = createGraphController(container, props.graph, makeRuntimeOptions())

  resizeObserver = new ResizeObserver(() => controller?.resize())
  resizeObserver.observe(container)
})

const onCopyPng = async () => {
  if (!controller || copying.value) return
  copying.value = true
  copyLabel.value = 'Copying...'
  try {
    const copied = await controller.copyAsPng()
    copyLabel.value = copied ? 'Copied PNG' : 'Downloaded PNG'
  } catch {
    copyLabel.value = 'Copy failed'
  } finally {
    window.setTimeout(() => {
      copyLabel.value = 'Copy PNG'
      copying.value = false
    }, 1200)
  }
}

const fit = () => controller?.fit()

defineExpose({ fit })

watch(
  () => props.graph,
  (next) => controller?.setGraph(next),
  { deep: true },
)

watch(
  () => props.options,
  () => controller?.setOptions(makeRuntimeOptions()),
  { deep: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  controller?.destroy()
  controller = null
})
</script>

<style scoped>
.graph-canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.graph-canvas {
  width: 100%;
  height: 100%;
  min-height: 480px;
}

.copy-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 4;
  border: 1px solid var(--graph-control-border, rgba(186, 230, 253, 0.4));
  border-radius: 8px;
  background: var(--graph-control-background, rgba(8, 47, 73, 0.8));
  color: var(--graph-control-color, rgba(224, 242, 254, 0.98));
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  cursor: pointer;
}

.copy-btn:disabled {
  opacity: 0.72;
  cursor: default;
}
</style>
