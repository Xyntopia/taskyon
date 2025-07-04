<template>
  <q-dialog v-model="show">
    <q-card>
      <q-card-section>
        <TyMarkdown v-if="infoText" :src="infoText" />
        <slot></slot>
      </q-card-section>
      <q-card-section>
        <SecretInput
          v-model="newSecret"
          placeholder="Add Secret key here!"
          filled
          label="New Secret"
          @keyup.enter="submit"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn label="Manage Passwords" to="/settings/secrets" />
        <q-btn label="OK" color="primary" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SecretInput from './SecretInput.vue'
import TyMarkdown from './tyMarkdown.vue'

const newSecret = ref<string>('')

const show = defineModel<boolean>({ required: true })

defineProps({
  infoText: {
    type: String,
    required: false,
    default: undefined,
  },
})

const emit = defineEmits<{
  (e: 'ok', secret: string): void
}>()

const submit = () => {
  emit('ok', newSecret.value)
  show.value = false
  newSecret.value = ''
}
</script>
