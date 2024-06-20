<template>
  <q-btn
    @click="model = !model"
    v-bind="$attrs"
    :class="model ? 'bg-secondary text-primary' : ''"
    :icon="model ? onIcon : offIcon"
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
