<template>
  <q-page padding>
    Connect Taskyon to
    {{ method }}
    {{ secret }}
  </q-page>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'

defineProps<{
  method?: string
}>()

const route = useRoute()
const secret = route.hash
//route.hash = ''
</script>
