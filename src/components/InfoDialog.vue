<template>
  <q-btn flat rounded dense :icon="matInfo" @click="showInfo = true">
    <q-dialog v-model="showInfo">
      <q-card>
        <q-card-section>
          <QMarkdown :src="infoText" />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-btn>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
const showInfo = ref(false);
import { matInfo } from '@quasar/extras/material-icons';
defineProps({
  infoText: {
    type: String,
    required: true,
  },
});
</script>
