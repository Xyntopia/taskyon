<template>
  <q-page class="fade-scroll" :data-disabled="!enabled" :style="cssVars">
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
    /** turn on/off smoothing; still works even if disabled */
    smooth?: boolean
    /** CSS transition duration in ms for the fade offset */
    smoothMs?: number
  }>(),
  {
    fadeHeight: 64,
    topOffset: 0,
    enabled: true,
    smooth: true,
    smoothMs: 5,
  },
)

const fadeOff = ref(0)

const cssVars = computed(() => ({
  '--fade-h': `${props.fadeHeight}px`,
  '--fade-off': `${fadeOff.value + props.topOffset}px`,
  '--fade-off-transition': props.smooth ? `${props.smoothMs}ms` : '0ms',
}))

function handleScroll(info: { position: { top: number } }) {
  fadeOff.value = Math.max(0, info.position.top)
}

function handleResize() {
  // nothing special; var recomputes on next scroll or keep last value
}
</script>

<!-- GLOBAL: must NOT be scoped; registers animatable custom property -->
<style lang="scss">
/* allow the var to animate (browser-native interpolation) */
@property --fade-off {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}
</style>

<!-- SCOPED: all component-specific rules can stay scoped -->
<style scoped lang="scss">
.fade-scroll {
  /* transition the custom property itself */
  transition: --fade-off var(--fade-off-transition) linear;

  /* defaults; can be overridden via inline vars */
  --fade-h: 64px;
  --fade-off: 0px;

  /* True transparency at viewport top, opaque after --fade-h */
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
  transition: none;
}
</style>
