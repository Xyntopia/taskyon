<template>
  <q-btn
    v-bind="$attrs"
    :class="(reverse ? !model : model) ? 'bg-secondary text-primary' : ''"
    :icon="(reverse ? !model : model) ? onIcon : offIcon"
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
  reverse?: boolean;
}>();
</script>
