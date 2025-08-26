<template>
  <q-dialog v-model="isVisible" persistent>
    <q-card class="q-pa-md" style="min-width: 350px">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ title }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="text-center">
        <div class="text-h4 q-mb-md">☁️</div>
        <div class="text-subtitle1 q-mb-sm">Keep your data synced across devices</div>
        <div class="text-body2 text-grey-6">
          Connect Google Drive for automatic backup? (Optional)
        </div>
      </q-card-section>

      <q-card-actions align="center" class="q-pt-none">
        <q-btn
          color="primary"
          label="Connect Google Drive"
          @click="handleConnect"
          class="q-mr-sm"
        />
        <q-btn flat label="Later" @click="handleDismiss" />
      </q-card-actions>

      <q-card-section v-if="showDontAskOption" class="q-pt-none">
        <q-checkbox v-model="dontAskAgain" label="Don't ask again" size="sm" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  show?: boolean
  title?: string
  showDontAskOption?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  show: false,
  title: 'Backup Your Data',
  showDontAskOption: true,
})

const emit = defineEmits<{
  connect: [dontAskAgain: boolean]
  dismiss: [dontAskAgain: boolean]
}>()

const isVisible = ref(false)
const dontAskAgain = ref(false)

const handleConnect = () => {
  emit('connect', dontAskAgain.value)
  isVisible.value = false
}

const handleDismiss = () => {
  emit('dismiss', dontAskAgain.value)
  isVisible.value = false
}

watch(
  () => props.show,
  (newVal) => {
    isVisible.value = newVal
  },
  { immediate: true },
)
</script>
