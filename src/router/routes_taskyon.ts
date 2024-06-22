import { RouteRecordRaw } from 'vue-router';
import { mdRoutes } from './routes_default';
import { defineAsyncComponent } from 'vue';
import Load from 'components/Loading.vue';

export const taskyonRoutes = {
  path: '/',
  component: () => import('layouts/Taskyon.vue'),
  children: [
    {
      path: '',
      //component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
      component: defineAsyncComponent({
        loader: () => import('pages/TaskChat.vue'),
        loadingComponent: Load,
        delay: 200,
      }),
      /*component: defineAsyncComponent({
        loader: () => import('pages/TaskChat.vue'),
        loadingComponent: () => import('src/components/Loading.vue'),
      }),*/
    },
    {
      path: 'taskmanager',
      component: defineAsyncComponent(() => import('pages/TaskManager.vue')),
    },
    {
      path: 'chat',
      component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
    },
    {
      path: 'settings/:tab?',
      component: () => import('pages/Settings.vue'),
    },
    {
      path: 'pricing',
      component: () => import('pages/PricePage.vue'),
    },
    {
      path: 'diagnostics',
      component: () => import('pages/Diagnostics.vue'),
    },
    {
      path: 'tools',
      component: () => import('components/ToolManager.vue'),
    },
    {
      path: 'prompts',
      component: () => import('components/PromptManager.vue'),
    },
    ...mdRoutes,
  ],
};

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
