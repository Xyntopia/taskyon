<template>
  <div
    class="procedural-spaceship"
    :style="containerStyle"
    role="img"
    :aria-label="`Procedural spaceship identicon generated from ${normalizedSeed}`"
  >
    <div class="procedural-spaceship__frame">
      <img
        v-if="imageUrl"
        class="procedural-spaceship__image"
        :src="imageUrl"
        :alt="`Procedural spaceship identicon generated from ${normalizedSeed}`"
        draggable="false"
      />
      <div
        v-else-if="sanitizedSvgMarkup"
        ref="svgFallbackHost"
        class="procedural-spaceship__svg-fallback"
      />
      <div v-else class="procedural-spaceship__placeholder" :style="placeholderStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RewindPolicy } from './spaceshipSchemas'
import type { SpaceshipLibraryFile } from './spaceshipSchemas'
import { spaceshipLibrarySchema } from './spaceshipSchemas'
import { DEFAULT_SPACESHIP_LIBRARY } from './proceduralSpaceship'
import { getSpaceshipImage, normalizeSpaceshipSeed } from './spaceshipIdenticonCache'
import { sanitizeSvgMarkup } from './sanitizeSvgMarkup'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
const DEBUG_SPACESHIP_IDENTICON = false

const props = withDefaults(
  defineProps<{
    seedText: string
    library?: SpaceshipLibraryFile | undefined
    size?: number | undefined
    backgroundFill?: string | undefined
    renderMode?: 'png-first' | 'svg-only' | undefined
    disableCache?: boolean | undefined
    clearCache?: boolean | undefined
    debugBounds?: boolean | undefined
    focusedModuleId?: string | undefined
    catalogVersion?: number | undefined
    maxGlobalRewinds?: number | undefined
    maxIntraStageBacktracks?: number | undefined
    rewindPolicy?: RewindPolicy | undefined
    stagnationRepeatThreshold?: number | undefined
    preferDeeperRewindOnRepeat?: boolean | undefined
  }>(),
  {
    library: undefined,
    size: undefined,
    backgroundFill: 'rgba(6, 14, 24, 0.92)',
    renderMode: 'png-first',
    disableCache: false,
    clearCache: false,
    debugBounds: false,
    focusedModuleId: undefined,
    catalogVersion: undefined,
    maxGlobalRewinds: 2,
    maxIntraStageBacktracks: 2,
    rewindPolicy: 'quality-first',
    stagnationRepeatThreshold: 1,
    preferDeeperRewindOnRepeat: true,
  },
)

const normalizedSeed = computed(() => normalizeSpaceshipSeed(props.seedText))
const effectiveLibrary = computed(() =>
  spaceshipLibrarySchema.parse(props.library ?? DEFAULT_SPACESHIP_LIBRARY),
)
const imageUrl = ref<string | null>(null)
const svgMarkup = ref('')
const svgFallbackHost = ref<HTMLDivElement | null>(null)
let requestToken = 0
let queuedRefresh = false
let queuedRefreshReason = 'unspecified'

const effectiveSize = computed(() => props.size ?? effectiveLibrary.value.algorithm.identiconSize)
const containerStyle = computed(() => ({
  width: `${effectiveSize.value}px`,
  height: `${effectiveSize.value}px`,
}))
const placeholderStyle = computed(() => ({
  background: effectiveLibrary.value.algorithm.showBackground
    ? props.backgroundFill
    : 'transparent',
}))
const sanitizedSvgMarkup = computed(() => sanitizeSvgMarkup(svgMarkup.value))

watchEffect(() => {
  const host = svgFallbackHost.value
  if (!host) return

  host.replaceChildren()

  const markup = sanitizedSvgMarkup.value
  if (!markup) return

  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.tagName.toLowerCase() !== 'svg') return

  host.appendChild(document.importNode(svg, true))
})

function identiconDebug(message: string, details?: Record<string, unknown>) {
  if (!DEBUG_SPACESHIP_IDENTICON) return
  const prefix = `[SpaceshipIdenticon size=${effectiveSize.value} seed=${normalizedSeed.value}]`
  if (details) {
    console.log(`${prefix} ${message}`, details)
    return
  }
  console.log(`${prefix} ${message}`)
}

function scheduleRefresh(reason: string) {
  queuedRefreshReason = reason
  if (queuedRefresh) return
  queuedRefresh = true
  queueMicrotask(() => {
    queuedRefresh = false
    void refreshImage(queuedRefreshReason)
  })
}

watch(
  [
    normalizedSeed,
    effectiveLibrary,
    effectiveSize,
    () => props.backgroundFill,
    () => props.renderMode,
    () => props.disableCache,
    () => props.clearCache,
    () => props.debugBounds,
    () => props.focusedModuleId,
    () => props.maxGlobalRewinds,
    () => props.maxIntraStageBacktracks,
    () => props.rewindPolicy,
    () => props.stagnationRepeatThreshold,
    () => props.preferDeeperRewindOnRepeat,
    () => props.catalogVersion,
  ],
  () => {
    scheduleRefresh('core prop watcher')
  },
  { immediate: true, deep: true },
)
watch(
  () => props.catalogVersion,
  (next, prev) => {
    identiconDebug('catalogVersion changed', { prev, next })
  },
)

onBeforeUnmount(() => {
  identiconDebug('beforeUnmount')
  clearImageUrl()
})

async function refreshImage(reason = 'unspecified') {
  const token = ++requestToken
  identiconDebug('refreshImage start', {
    reason,
    token,
    catalogVersion: props.catalogVersion,
  })
  clearImageUrl()
  svgMarkup.value = ''

  const options = {
    size: effectiveSize.value,
    showStars: effectiveLibrary.value.algorithm.showStars,
    showBackground: effectiveLibrary.value.algorithm.showBackground,
    backgroundFill: props.backgroundFill,
    renderMode: props.renderMode,
    disableCache: props.disableCache,
    clearCache: props.clearCache,
    debugBounds: props.debugBounds,
    symmetry: effectiveLibrary.value.algorithm.symmetry,
    moduleLibrary: effectiveLibrary.value.moduleCatalog,
    stages: effectiveLibrary.value.algorithm.stages,
    gridSize: effectiveLibrary.value.algorithm.gridSize,
    randomSvgColors: effectiveLibrary.value.algorithm.randomSvgColors,
    ...(props.maxGlobalRewinds !== undefined ? { maxGlobalRewinds: props.maxGlobalRewinds } : {}),
    ...(props.maxIntraStageBacktracks !== undefined
      ? { maxIntraStageBacktracks: props.maxIntraStageBacktracks }
      : {}),
    ...(props.rewindPolicy !== undefined ? { rewindPolicy: props.rewindPolicy } : {}),
    ...(props.stagnationRepeatThreshold !== undefined
      ? { stagnationRepeatThreshold: props.stagnationRepeatThreshold }
      : {}),
    ...(props.preferDeeperRewindOnRepeat !== undefined
      ? { preferDeeperRewindOnRepeat: props.preferDeeperRewindOnRepeat }
      : {}),
    ...(props.focusedModuleId !== undefined ? { focusedModuleId: props.focusedModuleId } : {}),
  }

  const result = await getSpaceshipImage(normalizedSeed.value, options)
  if (token !== requestToken) {
    identiconDebug('refreshImage stale result dropped', { token, activeToken: requestToken })
    return
  }

  if (result.kind === 'png') {
    imageUrl.value = URL.createObjectURL(result.blob)
    identiconDebug('refreshImage done (png)', { token, cacheHit: result.cacheHit })
    return
  }

  svgMarkup.value = result.svg
  identiconDebug('refreshImage done (svg)', { token })
}

function clearImageUrl() {
  if (!imageUrl.value) return
  URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = null
}
</script>

<style scoped>
.procedural-spaceship {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.procedural-spaceship__frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  /* CSS-only visual framing hook; keep at 0 by default while renderer fills 100%. */
  padding: var(--spaceship-identicon-inset, 0);
  border-radius: var(--spaceship-identicon-radius, 0);
}

.procedural-spaceship__image,
.procedural-spaceship__svg-fallback,
.procedural-spaceship__placeholder {
  width: 100%;
  height: 100%;
  display: block;
}

.procedural-spaceship__image {
  object-fit: contain;
  filter: var(--spaceship-identicon-shadow, none);
}

.procedural-spaceship__svg-fallback :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  filter: var(--spaceship-identicon-shadow, none);
}

.procedural-spaceship__placeholder {
  border-radius: 14px;
}
</style>
