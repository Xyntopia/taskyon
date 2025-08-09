import { type RouteRecordRaw } from 'vue-router'
import { mdRoutes } from './routes_default'
import { defineAsyncComponent } from 'vue'
import LoadCircle from '@taskyon/ui/components/LoadingCircle.vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { loadTaskChatPage } from './taskChatLoader'

const chatMarkdownRoots = ['docs', 'tyClientExamples'] as const

const getSingleQueryParam = (value: unknown) => (typeof value === 'string' ? value : undefined)

const resolveChatMarkdownProps = (filePathParam: string | string[] | undefined) => {
  const pathSegments = Array.isArray(filePathParam)
    ? filePathParam
    : filePathParam
      ? [filePathParam]
      : []

  if (pathSegments.length === 0) return {}

  const [root, ...rest] = pathSegments
  if (root && chatMarkdownRoots.includes(root as (typeof chatMarkdownRoots)[number])) {
    return {
      folder: root,
      filePath: `${rest.join('/')}.md`,
    }
  }

  return {
    folder: '',
    filePath: `${pathSegments.join('/')}.md`,
  }
}

const resolveTaskChatProps = (
  route: RouteLocationNormalizedLoaded,
  extra: Record<string, unknown> = {},
) => ({
  taskId: getSingleQueryParam(route.query.t),
  gdriveFileId: getSingleQueryParam(route.query.gd),
  importUrl: getSingleQueryParam(route.query.url),
  ...extra,
})

const shouldOpenChatRoute = (route: RouteLocationNormalizedLoaded) =>
  typeof route.query.t === 'string' ||
  typeof route.query.gd === 'string' ||
  typeof route.query.url === 'string'

export const universalTyRoutes: RouteRecordRaw[] = [
  {
    path: 'settings/:tab?',
    component: () => import('pages/taskyon/SettingsPage.vue'),
    meta: { title: 'Settings', description: 'Taskyon AI Chat Companion' },
  },
]

export const taskyonRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/TaskyonLayout.vue'),
    children: [
      {
        path: '',
        beforeEnter: (to) => {
          if (shouldOpenChatRoute(to)) {
            return {
              path: '/chat',
              query: to.query,
            }
          }
          return true
        },
        component: () => import('pages/taskyon/TaskyonHome.vue'),
        meta: {
          title: 'Main',
          description: 'Taskyon AI Chat Companion',
          showSidebar: false,
        },
      },
      {
        path: 'chat',
        component: defineAsyncComponent(loadTaskChatPage),
        meta: { title: 'Main', description: 'Taskyon AI Chat Companion' },
        props: (route) => resolveTaskChatProps(route),
      },
      {
        path: 'detailed',
        component: defineAsyncComponent(loadTaskChatPage),
        meta: { title: 'Detailed Chat', description: 'Detailed Chat' },
        props: (route) => resolveTaskChatProps(route, { detailed: true }),
      },
      {
        path: 'browser/:id',
        component: defineAsyncComponent(loadTaskChatPage),
        meta: { title: 'Task Browser', description: 'Task Browser' },
        props: (route) => ({ treeBrowser: true, rootTaskId: route.params.id }),
      },
      {
        // TODO:  change this, so that we can use "arbitrary" files for this!!!
        path: '/chat/:filePath([^.]*)+',
        component: defineAsyncComponent(loadTaskChatPage),
        meta: { title: 'Chat', description: 'Taskyon AI Chat Companion' },
        props: (route) =>
          resolveTaskChatProps(
            route,
            resolveChatMarkdownProps(route.params.filePath as string | string[]),
          ),
      },
      {
        // TODO: rename this and all references to search?
        path: 'taskmanager',
        component: () => import('pages/taskyon/TaskManager.vue'),
        meta: { title: 'Task Manager', description: 'Manage Tasks & Chats' },
        props: (route) => {
          console.log('open', route)
          if (route.query) return { query: route.query }
        },
      },
      {
        path: 'pricing',
        component: () => import('pages/taskyon/PricePage.vue'),
        meta: {
          title: 'Model List',
          description: 'Model capabilities and pricing information',
        },
      },
      {
        path: 'prompts',
        component: () => import('pages/taskyon/PromptManager.vue'),
        meta: {
          title: 'Prompt Editor',
          description: 'Create & Manage AI Prompts',
        },
      },
      {
        path: 'browser-access',
        component: () => import('pages/taskyon/BrowserAccessPage.vue'),
        meta: {
          title: 'Browser Access',
          description: 'Configure browser MCP, proxy fallback, and research web access.',
        },
      },
      {
        path: 'docindex',
        component: () => import('pages/DocumentationIndex.vue'),
        meta: { title: 'Documentation', description: 'Taskyon Documentation' },
      },
      // mdRoutes should have our normal taskyon layout thats why we put them in here :)
      ...mdRoutes,
      ...universalTyRoutes,
    ],
  },
  {
    path: '/',
    component: () => import('layouts/EmptyLayout.vue'),
    children: [
      {
        path: 'connect/:method',
        component: () => import('pages/ConnectPage.vue'),
        props: true,
        meta: { titel: 'Connect Taskyon', description: 'Connecting Taskyon to the network.' },
      },
      {
        path: 'editor',
        component: () => import('pages/taskyon/CodingPage.vue'),
        meta: {
          title: 'Taskyon Code Editor',
          description: 'Edit code together with AI',
        },
      },
      {
        path: '/sql',
        component: () => import('pages/taskyon/SqlQueryPage.vue'),
        meta: {
          title: 'SQL debugging',
          description: 'Do queries on taskyons databases using SQL',
        },
      },
      {
        path: '/tool',
        component: () => import('src/pages/taskyon/ToolPage.vue'),
        meta: { title: 'Tool Page', description: 'Use Individual Tool' },
        props: true,
      },
      {
        path: '/tool/:name',
        component: () => import('src/pages/taskyon/ToolPage.vue'),
        meta: { title: 'Tool Page', description: 'Use Individual Tool' },
        props: true,
      },
      {
        path: '/mcp-tool-import',
        component: () => import('src/pages/taskyon/McpToolImportPage.vue'),
        meta: {
          title: 'MCP Tool Import Page',
          description: 'Import external MCP tools as Taskyon tools',
        },
        props: true,
      },
      {
        path: '/mcp-tool',
        redirect: '/mcp-tool-import',
      },
      {
        path: '/fm/:pathMatch(.*)*',
        component: () => import('pages/FileManagerPage.vue'),
        props: (route) => ({ initialPath: route.params.pathMatch }),
        meta: {
          title: 'File Manager',
          description: 'Manage files saved in Taskyon OPFS.',
        },
      },
      {
        path: '/opfs',
        component: () => import('pages/FileManagerPage.vue'),
        meta: {
          title: 'Taskyon File Manager',
          description: 'Manage files saved in Taskyon OPFS.',
        },
      },
      {
        path: '/p2p',
        component: () => import('pages/taskyon/Libp2pUniversalChat.vue'),
        meta: {
          title: 'p2p chat',
          description: 'libp2p chat',
        },
      },
      {
        path: '/p2pmonitor',
        component: () => import('pages/taskyon/Libp2pStatusPage.vue'),
        meta: {
          title: 'p2p monitor',
          description: 'libp2p connection status monitor',
        },
      },
      {
        path: '/p2pmonitor-dual',
        component: () => import('pages/taskyon/Libp2pDualIframePage.vue'),
        meta: {
          title: 'dual p2p monitor',
          description: 'two iframe p2p monitor test harness',
        },
      },
      {
        path: '/headless',
        component: () => import('pages/taskyon/HeadlessPage.vue'),
        meta: {
          title: 'taskyon headless',
          description: 'headless runtime bootstrap',
        },
      },

      /*{
        path: '/componenttests',
        component: () => import('pages/ComponentTests.vue'),
        meta: {
          title: 'Test Taskyon Components',
          description: 'Testing Taskyon Components.',
        },
      },*/
    ],
  },
  {
    path: '/',
    component: () => import('layouts/EmptyLayout2.vue'),
    children: [
      {
        path: '/dockview',
        component: () => import('pages/DockViewTest.vue'),
        meta: {
          title: 'dockview test',
          description: 'testing dockview integration',
        },
      },
    ],
  },
  {
    path: '/modelica',
    component: () => import('pages/taskyon/ModelicaPage.vue'),
    meta: {
      title: 'Taskyon Modelica Editor',
      description: 'Edit and run modelica code together with AI',
    },
  },
  // diagnostics should stay in its own page in order to be as independent as possible
  // in case there are any errors in the rest of the app...
  {
    path: '/diagnostics',
    component: () => import('pages/DiagnosticsPage.vue'),
    meta: {
      title: 'Diagnostics',
      description: 'Error & Diagnostics display',
    },
  },
  {
    path: '/clienttest',
    component: () => import('pages/TaskyonClientTest.vue'),
    meta: {
      title: 'Taskyon Client Test',
      description: 'We are testing taskyons client library here.',
    },
  },
  {
    path: '/pageio-test',
    component: () => import('pages/PageIOTestPage.vue'),
    meta: {
      title: 'PageIO Test',
      description: 'Browser page interaction tool test harness.',
    },
  },
  {
    path: '/spaceships',
    component: () => import('@taskyon/spaceships/ProceduralSpaceshipLabPage.vue'),
    meta: {
      title: 'Procedural Spaceship Lab',
      description: 'Inspect deterministic procedural spaceships generated from seed strings.',
    },
  },
]

export const routes: RouteRecordRaw[] = [
  ...taskyonRoutes,
  {
    // we are making sure to only load urls without any extensions here...
    path: '/oauth/return',
    component: () => import('pages/auth/AuthFlow.vue'),
  },
  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
]

export const tyServerRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/ServerControlLayout.vue'),
    children: [
      {
        path: '',
        //component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/ServerControl.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Main', description: 'Taskyon AI Server Control' },
      },
      ...universalTyRoutes,
    ],
  },
  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
]
