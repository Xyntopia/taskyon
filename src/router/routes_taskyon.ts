import { RouteRecordRaw } from 'vue-router';
import authRoutes from './routes_default';

export const taskyonRoutes = {
  path: '/',
  component: () => import('layouts/Taskyon.vue'),
  children: [
    { path: '', component: () => import('pages/TaskChat.vue') },
    { path: 'taskmanager', component: () => import('pages/TaskManager.vue') },
    {
      path: 'chat',
      component: () => import('pages/TaskChat.vue'),
    },
    {
      path: 'settings/:tab?',
      component: () => import('pages/Settings.vue'),
    },
    {
      path: 'diagnostics',
      component: () => import('pages/Diagnostics.vue'),
    },
    {
      path: 'uploader',
      component: () => import('components/VecStoreUploader.vue'),
    },
    {
      path: 'search',
      component: () => import('components/VecStoreSearch.vue'),
    },
    {
      path: 'tools',
      component: () => import('components/ToolManager.vue'),
    },
    ...authRoutes
  ],
}

const routes: RouteRecordRaw[] = [
  {
    path: '/widgets',
    component: () => import('layouts/Widgets.vue'),
    children: [{ path: 'chat', component: () => import('pages/TaskChat.vue') }],
  },
  
  taskyonRoutes,

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/Error404.vue'),
  },
];

export default routes;
