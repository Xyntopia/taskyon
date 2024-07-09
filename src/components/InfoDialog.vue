<template>
  <div>
    <q-btn
      flat
      rounded
      dense
      :icon="matHelpOutline"
      v-bind="$attrs"
      @click="showInfo = true"
    >
      <q-dialog v-model="showInfo">
        <q-card>
          <q-card-section>
            <QMarkdown v-if="infoText" :src="infoText" />
            <slot></slot>
          </q-card-section>
        </q-card>
      </q-dialog>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
const showInfo = ref(false);
import { matHelpOutline } from '@quasar/extras/material-icons';
defineProps({
  infoText: {
    type: String,
    required: false,
  },
});
</script>
