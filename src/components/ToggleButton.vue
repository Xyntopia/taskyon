<template>
  <q-btn
    v-bind="$attrs"
    :class="model ? 'bg-secondary text-primary' : ''"
    :icon="model ? onIcon : offIcon"
    @click="model = !model"
  >
    <slot></slot>
  </q-btn>
</template>

<script setup lang="ts">
import type { QBtnProps } from 'quasar';

const model = defineModel<boolean>({
  required: false,
});

defineProps<{
  onIcon?: QBtnProps['icon'];
  offIcon?: QBtnProps['icon'];
}>();
</script>
