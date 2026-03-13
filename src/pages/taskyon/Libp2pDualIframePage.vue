<template>
  <q-page class="dual-page q-pa-md">
    <div class="header q-mb-md">
      <div>
        <div class="text-h4">Dual Browser p2p Test</div>
        <div class="text-body2">
          Two isolated `/p2pmonitor` iframes in one page for faster local relay testing.
        </div>
      </div>
      <div class="row q-gutter-sm">
        <q-btn label="Reload Both Frames" @click="reloadFrames" />
      </div>
    </div>

    <div class="frame-grid">
      <q-card class="frame-card">
        <q-card-section class="frame-card__header">
          <div class="text-h6">Iframe A</div>
          <div class="text-caption">{{ leftSrc }}</div>
        </q-card-section>
        <iframe ref="leftFrameRef" class="frame" :src="leftSrc" title="p2p monitor iframe A" />
      </q-card>

      <q-card class="frame-card">
        <q-card-section class="frame-card__header">
          <div class="text-h6">Iframe B</div>
          <div class="text-caption">{{ rightSrc }}</div>
        </q-card-section>
        <iframe ref="rightFrameRef" class="frame" :src="rightSrc" title="p2p monitor iframe B" />
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const leftFrameRef = ref<HTMLIFrameElement | null>(null)
const rightFrameRef = ref<HTMLIFrameElement | null>(null)

const createFrameSrc = (label: string) => {
  const params = new URLSearchParams(window.location.search)
  params.delete('taskyonFrameLabel')
  params.set('taskyonFrameLabel', label)
  const query = params.toString()
  return `/p2pmonitor${query ? `?${query}` : ''}`
}

const leftSrc = computed(() => createFrameSrc('A'))
const rightSrc = computed(() => createFrameSrc('B'))

const reloadFrame = (frame: HTMLIFrameElement | null) => {
  frame?.contentWindow?.location.reload()
}

const reloadFrames = () => {
  reloadFrame(leftFrameRef.value)
  reloadFrame(rightFrameRef.value)
}
</script>

<style scoped>
.dual-page {
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.frame-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.frame-card {
  min-height: calc(100vh - 180px);
  display: flex;
  flex-direction: column;
}

.frame {
  width: 100%;
  min-height: calc(100vh - 260px);
  border: 0;
  flex: 1;
}

@media (max-width: 1024px) {
  .frame-grid {
    grid-template-columns: 1fr;
  }

  .frame-card {
    min-height: 70vh;
  }

  .frame {
    min-height: 65vh;
  }
}
</style>
