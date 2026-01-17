<template>
  <q-page padding>
    <q-card>
      <q-card-section class="text-h4">Documentation Index</q-card-section>
      <q-list dense>
        <q-item v-for="doc in toc" :key="doc.title" flat :to="doc.link" :label="doc.title">
          {{ doc.title }}
        </q-item>
      </q-list></q-card
    >
  </q-page>
</template>

<script setup lang="ts">
const toc = Object.entries(
  import.meta.glob('../../public/docs/**/*.md', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
).map(([path]) => {
  const fileName = path.split('/').pop()?.replace('.md', '') ?? 'Unknown'
  return {
    title: fileName,
    link: path.replace('../../public', ''),
  }
})
</script>
