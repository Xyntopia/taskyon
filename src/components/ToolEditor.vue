<template>
  <div>
    <ObjectTreeView :model-value="tool" />
    {{ tool }}
  </div>
</template>

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

<script setup lang="ts">
import { dump } from 'js-yaml';
import { Tool } from 'src/modules/taskyon/tools';
import { computed, ref, defineProps } from 'vue';
import { ObjectTreeView } from 'src/components/ObjectTreeView';

const props = defineProps<{
  tool: Tool;
}>();
</script>
