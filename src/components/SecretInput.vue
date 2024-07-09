<template>
  <q-input v-model="model" :type="isPwd ? 'password' : 'text'" v-bind="$attrs">
    <template #append>
      <q-icon
        :name="isPwd ? matVisibilityOff : matVisibility"
        class="cursor-pointer"
        @click="isPwd = !isPwd"
      />
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { matVisibility, matVisibilityOff } from '@quasar/extras/material-icons';
import { ref } from 'vue';

const model = defineModel<string>();
const isPwd = ref(true);
</script>
