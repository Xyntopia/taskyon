<template>
  <q-input v-model="model" :type="isPwd ? 'password' : 'text'" v-bind="$attrs">
    <!-- 1) Forward all incoming slots except 'append' -->
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}"></slot>
    </template>

    <template #append>
      <slot name="append">
        <q-icon
          :name="isPwd ? matVisibilityOff : matVisibility"
          class="cursor-pointer"
          @click="isPwd = !isPwd"
        />
      </slot>
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { matVisibility, matVisibilityOff } from '@quasar/extras/material-icons'
import { ref } from 'vue'

const model = defineModel<string>()
const isPwd = ref(true)
</script>
