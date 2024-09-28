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
        loader: () => import('pages/taskyon/TaskChat.vue'),
        loadingComponent: LoadCircle,
        delay: 200,
      }),
      /*component: defineAsyncComponent({
        loader: () => import('pages/TaskChat.vue'),
        loadingComponent: () => import('components/Loading.vue'),
      }),*/
    },
    {
      path: 'taskmanager',
      component: defineAsyncComponent(
        () => import('pages/taskyon/TaskManager.vue'),
      ),
    },
    {
      path: 'chat',
      component: defineAsyncComponent(
        () => import('pages/taskyon/TaskChat.vue'),
      ),
    },
    {
      path: 'settings/:tab?',
      component: () => import('pages/taskyon/SettingsPage.vue'),
    },
    {
      path: 'pricing',
      component: () => import('pages/taskyon/PricePage.vue'),
    },
    {
      path: 'diagnostics',
      component: () => import('pages/taskyon/DiagnosticsPage.vue'),
    },
    {
      path: 'tools',
      component: () => import('components/taskyon/ToolManager.vue'),
    },
    {
      path: 'prompts',
      component: () => import('pages/taskyon/PromptManager.vue'),
    },
    {
      path: 'docs',
      component: () => import('pages/DocumentationIndex.vue'),
    },
    ...mdRoutes,
  ],
};

const routes: RouteRecordRaw[] = [
  {
    path: '/widgets',
    component: () => import('layouts/WidgetsLayout.vue'),
    children: [{ path: 'chat', component: () => import('pages/taskyon/TaskChat.vue') }],
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
