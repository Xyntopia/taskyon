<template>
  <q-page :style-fn="myPageStyle">
    <slot name="default" />
  </q-page>
</template>

<script setup lang="ts">
// we make sure, that we use "dvh" and also we need to declare
// q-page to be a
function myPageStyle(offset: number) {
  // offset = header+footer size in px
  return {
    display: 'flex',
    flexDirection: 'column',
    height: offset ? `calc(100dvh - ${offset}px)` : '100dvh',
  }
}
</script>
