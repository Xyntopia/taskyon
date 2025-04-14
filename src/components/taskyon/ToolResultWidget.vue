<template>
  <div v-if="functionCall">
    <div class="text-bold">arguments (yaml):</div>
    <div caption>
      <div class="scroll-area">
        {{ dump(functionCall.arguments) }}
      </div>
    </div>
  </div>
  <div v-if="result">
    <div class="text-bold">result (yaml):</div>
    <div caption class="relative-position">
      <div class="scroll-area">
        {{ safeYamlDump(result) }}
      </div>
      <q-btn
        class="scroll-area-btn"
        flat
        :icon="matContentCopy"
        @click="copyToClipboard(safeYamlDump(result))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { matContentCopy } from '@quasar/extras/material-icons'
import { dump } from 'js-yaml'
import type { FunctionCall } from 'src/modules/taskyon/types'
import { copyToClipboard } from 'src/modules/utils'
import { safeYamlDump } from 'src/modules/yamlUtils'

defineProps<{
  result?: unknown
  functionCall?: FunctionCall | undefined
}>()
</script>

<style lang="sass" scoped>

.scroll-area-btn
  position: absolute
  top: 0px // Adjust as needed for proper alignment
  right: 0px // Adjust as needed for proper alignment
  z-index: 10 // Ensure the button is above other content

.scroll-area
  white-space: pre-wrap
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3)
  max-height: 300px // Adjust this value based on your needs
  overflow-y: auto
  width: auto // Ensures it takes the necessary width up to its parent's maximum
  min-width: 100% // Ensures it stretches to at least the width of its parent
</style>
