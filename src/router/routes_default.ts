import type { RouteRecordRaw } from 'vue-router'

// our MarkdownPage accepts the properties below
export const mdRoutes: RouteRecordRaw[] = [
  {
    // we are making sure to only load urls without any extensions here...
    path: '/md/:filePath([^.]*)*',
    component: () => import('pages/MarkdownPage.vue'),
    props: (route) => ({
      folder: '', // we use our public folder here for all markdown files :)
      filePath: (route.params.filePath as string[]).join('/') + '.md',
    }),
  },
  {
    path: '/docs/',
    component: () => import('pages/TaskyonDocumentationPage.vue'),
    meta: { description: 'Taskyon Documentation' },
  },
  {
    path: '/docs/:filePath([^.]*)*',
    component: () => import('pages/TaskyonDocumentationPage.vue'),
    meta: { description: 'Taskyon Documentation' },
  },
]
