<template>
  <q-input :type="isPwd ? 'password' : 'text'" v-model="model" v-bind="$attrs">
    <template v-slot:append>
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
