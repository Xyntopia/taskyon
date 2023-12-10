<template>
  <q-page class="q-pa-md q-gutter-md">
    <div v-for="(e, idx) of errors" :key="idx">
      <p class="text-bold">{{ idx }}:</p>
      <pre>{{ e }}</pre>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { errors } from 'boot/taskyon';
</script>
