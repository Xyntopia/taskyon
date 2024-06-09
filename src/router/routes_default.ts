import { RouteRecordRaw } from 'vue-router';

export const authRoutes = [
  {
    path: 'account',
    component: () => import('pages/auth/Account.vue'),
  },
  {
    path: 'auth',
    component: () => import('pages/auth/Account.vue'),
  },
];

export const mdRoutes: RouteRecordRaw[] = [
  {
    path: '/md/:filePath+',
    component: import('pages/MarkdownPage.vue'),
    props: (route) => ({
      folder: '', // we use our public folder here for all markdown files :)
      filePath: (route.params.filePath as string[]).join('/') + '.md',
    }),
  },
];

export default authRoutes;
