<template>
  <q-dialog v-model="show" :persistent="props.persistent">
    <q-card>
      <q-card-section>
        <div v-if="props.title" class="text-h6 q-mb-sm">{{ props.title }}</div>
        <TyMarkdown v-if="props.infoText" :src="props.infoText" />
        <slot></slot>
      </q-card-section>
      <q-card-section>
        <SecretInput
          v-model="newSecret"
          :placeholder="props.placeholder"
          filled
          :label="props.label"
          @keyup.enter="submit"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn :label="props.okLabel" color="primary" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import TyMarkdown from './tyMarkdown.vue'
import SecretInput from './varViews/SecretInput.vue'

const newSecret = ref<string>('')

const show = defineModel<boolean>({ required: true })

const props = defineProps({
  title: {
    type: String,
    required: false,
    default: '',
  },
  infoText: {
    type: String,
    required: false,
    default: undefined,
  },
  label: {
    type: String,
    required: false,
    default: 'New Secret',
  },
  placeholder: {
    type: String,
    required: false,
    default: 'Add Secret key here!',
  },
  okLabel: {
    type: String,
    required: false,
    default: 'OK',
  },
  persistent: {
    type: Boolean,
    required: false,
    default: false,
  },
  closeOnSubmit: {
    type: Boolean,
    required: false,
    default: true,
  },
})

const emit = defineEmits<{
  (e: 'ok', secret: string): void
}>()

const submit = () => {
  emit('ok', newSecret.value)

  if (!props.closeOnSubmit) return

  show.value = false
  newSecret.value = ''
}

watch(show, (isVisible) => {
  if (isVisible) return
  newSecret.value = ''
})
</script>
