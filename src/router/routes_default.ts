import { RouteRecordRaw } from 'vue-router';

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
    component: () => import('pages/MarkdownPage.vue'),
    props: (route) => {
      console.log('open', route);
      return {
        folder: 'docs', // we use our public folder here for all markdown files :)
        filePath: 'index.md',
      };
    },
    meta: { description: 'Taskyon Documentation' },
  },
  {
    path: '/docs/:filePath([^.]*)*',
    component: () => import('pages/MarkdownPage.vue'),
    props: (route) => {
      console.log('open', route);
      return {
        folder: 'docs', // we use our public folder here for all markdown files :)
        filePath: (route.params.filePath as string[]).join('/') + '.md',
      };
    },
    meta: { description: 'Taskyon Documentation' },
  },
];

export const authRoutes: RouteRecordRaw[] = [
  {
    // we are making sure to only load urls without any extensions here...
    path: '/authreturngit', // we can declare new routes for different service and extract the access tokens from the return parameters
    component: () => import('pages/auth/AuthReturnPage.vue'),
    props: (route) => ({
      accessToken: route.query, // whatever we find in the URL here :)
    }),
  },
];
