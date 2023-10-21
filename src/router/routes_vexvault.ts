import { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('components/Chat.vue'),
    children: [
      { path: '', component: () => import('components/VecStoreUploader.vue') },
      {
        path: 'chat',
        component: () => import('components/Chat.vue'),
      },
      {
        path: 'uploader',
        component: () => import('components/VecStoreUploader.vue'),
      },
      {
        path: 'searchplugin',
        component: () => import('components/VecStoreUploader.vue'),
      },
      {
        path: 'search',
        component: () => import('components/VecStoreSearch.vue'),
      },
      {
        path: 'admin',
        component: () => import('components/VecStoreSearch.vue'),
      },
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/Error404.vue'),
  },
];

export default routes;
