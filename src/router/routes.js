
const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        component: () => import('pages/BasicSearch.vue'),
        props: route => ({
          searchPropsFromURL: { ...route.query }
        })
      },
      { path: 'configurator', component: () => import('pages/Configurator.vue') },
      { path: 'component/:id', name: 'component', component: () => import('pages/Component.vue') },
      { path: 'sandbox', component: () => import('pages/Sandbox.vue') },
      { path: 'systemviewer', component: () => import('pages/Systemviewer.vue') },
      { path: 'configuratoradmin', component: () => import('pages/ConfiguratorAdmin.vue') },
      { path: 'ComcharaxControlPanel', component: () => import('pages/ComcharaxControlPanel.vue') },
      { path: 'user', component: () => import('pages/UserProfile.vue') }
    ]
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '*',
    component: () => import('pages/Error404.vue')
  }
]

export default routes
