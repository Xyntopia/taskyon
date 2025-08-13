<template>
  <q-page class="fade-scroll" :data-disabled="!enabled" :style="cssVars">
    <!-- Observers -->
    <q-resize-observer :debounce="200" @resize="handleResize" />
    <q-scroll-observer :debounce="16" @scroll="handleScroll" />

    <slot />
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(
  defineProps<{
    fadeHeight?: number
    topOffset?: number
    enabled?: boolean
  }>(),
  {
    fadeHeight: 64,
    topOffset: 0,
    enabled: true,
  },
)

const fadeOff = ref(0)

const cssVars = computed(() => ({
  '--fade-h': `${props.fadeHeight}px`,
  '--fade-off': `${fadeOff.value + props.topOffset}px`,
}))

function handleScroll(info: { position: { top: number } }) {
  // position.top = how far we’ve scrolled down
  fadeOff.value = Math.max(0, info.position.top)
}

function handleResize() {
  // you could re-check something here if needed
}
</script>

<style scoped lang="scss">
.fade-scroll {
  --fade-h: 64px;
  --fade-off: 0px;

  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) calc(var(--fade-off)),
    rgba(0, 0, 0, 1) calc(var(--fade-off) + var(--fade-h)),
    rgba(0, 0, 0, 1) 100%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) calc(var(--fade-off)),
    rgba(0, 0, 0, 1) calc(var(--fade-off) + var(--fade-h)),
    rgba(0, 0, 0, 1) 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.fade-scroll[data-disabled='true'] {
  -webkit-mask-image: none;
  mask-image: none;
}
</style>
