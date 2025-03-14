<template>
  <q-dialog v-model="showInfo">
    <q-card>
      <q-card-section>
        <QMarkdown v-if="infoText" :src="infoText" />
        <slot></slot>
      </q-card-section>
      <q-card-section>
        <SecretInput
          placeholder="Add Secret key here!"
          filled
          v-model="newSecret"
          label="New Secret"
        >
        </SecretInput>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown'
import SecretInput from './SecretInput.vue'

const newSecret = ref<string>('')
const showInfo = ref(false)

defineProps({
  infoText: {
    type: String,
    required: false,
    default: undefined,
  },
})
</script>
