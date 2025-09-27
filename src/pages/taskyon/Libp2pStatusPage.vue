<template>
  <q-page class="q-pa-md">
    <q-card class="q-ma-md">
      <Libp2pStatus :p2p="p2p" />
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { getActiveP2pNode } from '@taskyon/taskyon'
import Libp2pStatus from 'src/components/taskyon/Libp2pStatus.vue'

const p2p = getActiveP2pNode()
</script>
