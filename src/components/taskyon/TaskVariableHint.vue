<template>
  <span class="task-variable-hint">
    <q-btn
      dense
      flat
      size="xs"
      color="secondary"
      label="View"
      @click="$emit('open-variable', taskId)"
    >
      <q-tooltip anchor="top middle" self="bottom middle" :delay="150">
        Inspect variable
      </q-tooltip>
    </q-btn>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  taskId: string
}>()

defineEmits<{
  (e: 'open-variable', taskId: string): void
}>()
</script>

<style scoped>
.task-variable-hint {
  display: inline-flex;
  align-items: center;
}
</style>
