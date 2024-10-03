<template>
  <q-page padding>
    <q-card>
      <q-card-section class="text-h4">Documentation Index</q-card-section>
      <q-list dense>
        <q-item
          v-for="doc in toc"
          :key="doc.title"
          flat
          :to="doc.link"
          :label="doc.title"
        >
          {{ doc.title }}
        </q-item>
      </q-list></q-card
    >
  </q-page>
</template>

<script setup lang="ts">
// src/toc.ts
function generateTOC() {
  // Create a require context for all .md files in the directory
  const markdownContext = require.context('../../public/docs/', true, /\.md$/);
  console.log('markdownContext', markdownContext);

  // Get all filenames from the directory
  const markdownFiles: string[] = markdownContext.keys();

  // Generate a table of contents by mapping each file to a link
  const toc = markdownFiles.map((file: string) => {
    const fileName = file.replace('./', '').replace('.md', '');
    return {
      title: fileName, // You can enhance this to extract titles from file contents
      link: `/docs/${fileName}`,
    };
  });

  return toc;
}

const toc = generateTOC();
</script>
