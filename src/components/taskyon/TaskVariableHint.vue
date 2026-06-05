<template>
  <span class="task-variable-hint">
    <q-btn dense flat size="xs" color="secondary" label="Task">
      <q-tooltip anchor="top middle" self="bottom middle" :delay="150" class="bg-dark text-white">
        <div class="column q-gutter-xs">
          <div class="text-caption">Task variable</div>
          <div class="row q-gutter-xs">
            <q-btn dense flat color="white" label="Open task" @click="$emit('open-task', taskId)" />
            <q-btn dense flat color="white" label="View data" @click="$emit('open-data', taskId)" />
          </div>
        </div>
      </q-tooltip>
    </q-btn>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  taskId: string
}>()

defineEmits<{
  (e: 'open-task', taskId: string): void
  (e: 'open-data', taskId: string): void
}>()
</script>

<style scoped>
.task-variable-hint {
  display: inline-flex;
  align-items: center;
}
</style>
