<template>
  <q-btn
    class="col-auto self-end"
    flat
    dense
    :icon="matTune"
    @click="
      () => {
        expandedTaskCreation = !expandedTaskCreation;
      }
    "
    v-bind="$attrs"
    ><q-tooltip> Toggle Task Settings </q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
import { matTune } from '@quasar/extras/material-icons';

const expandedTaskCreation = defineModel<boolean>({
  required: true,
});
</script>
sw
