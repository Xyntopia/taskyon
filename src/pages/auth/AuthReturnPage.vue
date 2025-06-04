<template>
  <q-layout>
    <q-page-container>
      <q-page>
        <div>Auth Return Page for: {{ serviceName }}</div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
const props = defineProps<{ serviceName: string; query: unknown }>()
console.log('received', props)
</script>
