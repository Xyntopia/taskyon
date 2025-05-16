<template>
  <div class="row q-gutter-sm items-center">
    <q-icon v-if="item.icon" size="sm" :name="item.icon"></q-icon>
    <div v-if="item.label" class="col-auto" style="min-width: 200px">{{ item.label }}:</div>
    <!--valueSlot-->
    <slot> </slot>
    <info-dialog v-if="item.description">
      {{ item.description }}
    </info-dialog>
  </div>
</template>

<script setup lang="ts">
import InfoDialog from 'components/InfoDialog.vue'

defineProps<{
  item: {
    icon?: string
    description?: string
    label?: string
  }
}>()
</script>
