<template>
  <q-btn
    class="col-auto self-end"
    flat
    dense
    icon="tune"
    @click="
      () => {
        expandedTaskCreation = !expandedTaskCreation;
      }
    "
    ><q-tooltip> Toggle Task Settings </q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
const expandedTaskCreation = defineModel<boolean>({
  required: true,
});
</script>sw
