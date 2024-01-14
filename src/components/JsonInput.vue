<template>
  <q-input type="textarea" filled v-model="jsonString">
    <template v-slot:append>
      <q-btn flat dense @click="onSave" icon="save" />
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuasar } from 'quasar';

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['update:modelValue']);

const q = useQuasar();

const jsonString = ref(JSON.stringify(props.modelValue, null, 2));

watch(
  () => props.modelValue,
  (newValue) => {
    jsonString.value = JSON.stringify(newValue, null, 2);
  },
  { deep: true }
);

const onSave = () => {
  //TODO:  do zod validation here...
  try {
    const parsed = JSON.parse(jsonString.value) as unknown;
    emit('update:modelValue', parsed);
  } catch (e) {
    q.notify({
      color: 'negative',
      position: 'top',
      message: 'Invalid JSON format',
      icon: 'report_problem',
    });
  }
};
</script>
