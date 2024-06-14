<template>
  <a
    href="mailto:support@taskyon.space"
    :icon="matMail"
    v-bind="$attrs"
    target="_blank"
  >
  <q-icon :name="matMail"></q-icon>
  support@taskyon.space
  </a>
</template>

<script setup lang="ts">
import { matMail } from '@quasar/extras/material-icons';
</script>
