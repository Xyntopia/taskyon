<template>
  <component :is="tag" ref="rootEl" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { renderSanitizedMarkup } from '@taskyon/common/modules/sanitizeMarkup'

const props = withDefaults(
  defineProps<{
    markup: string
    sanitize?: ((markup: string) => string) | undefined
    tag?: string | undefined
  }>(),
  {
    tag: 'div',
  },
)

const rootEl = ref<HTMLElement | null>(null)

const sanitizedMarkup = computed(() =>
  typeof props.sanitize === 'function' ? props.sanitize(props.markup) : props.markup,
)

watchEffect(() => {
  if (!rootEl.value) return
  renderSanitizedMarkup(rootEl.value, sanitizedMarkup.value)
})
</script>
