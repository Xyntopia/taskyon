<template>
  <ProceduralSpaceshipLabPage :storage-client="taskyon.storageClient" />
</template>

<script setup lang="ts">
import ProceduralSpaceshipLabPage from '@taskyon/spaceships/ProceduralSpaceshipLabPage.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'

const taskyon = useTaskyonStore()
</script>
