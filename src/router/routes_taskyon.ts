import { RouteRecordRaw } from 'vue-router';
import { mdRoutes } from './routes_default';
import { defineAsyncComponent } from 'vue';
import LoadCircle from 'components/LoadingCircle.vue';

export const taskyonRoutes = {
  path: '/',
  component: () => import('layouts/TaskyonLayout.vue'),
  children: [
    {
      path: '',
      //component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
      component: defineAsyncComponent({
        loader: () => import('pages/TaskChat.vue'),
        loadingComponent: LoadCircle,
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
      component: () => import('pages/SettingsPage.vue'),
    },
    {
      path: 'pricing',
      component: () => import('pages/PricePage.vue'),
    },
    {
      path: 'diagnostics',
      component: () => import('pages/DiagnosticsPage.vue'),
    },
    {
      path: 'tools',
      component: () => import('components/ToolManager.vue'),
    },
    {
      path: 'prompts',
      component: () => import('pages/PromptManager.vue'),
    },
    ...mdRoutes,
  ],
};

const routes: RouteRecordRaw[] = [
  {
    path: '/widgets',
    component: () => import('layouts/WidgetsLayout.vue'),
    children: [{ path: 'chat', component: () => import('pages/TaskChat.vue') }],
  },

  taskyonRoutes,

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
  },
];

export default routes;
