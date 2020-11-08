
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
      { path: 'offerconfigurator', component: () => import('pages/OfferConfigurator.vue') },
      { path: 'extractcomponentdata', component: () => import('pages/ExtractComponentData.vue') },
      { path: 'component/:uid', name: 'component', component: () => import('pages/Component.vue') },
      { path: 'sandbox', component: () => import('pages/Sandbox.vue') },
      { path: 'systemviewer', component: () => import('pages/Systemviewer.vue') },
      { path: 'projectsadmin', component: () => import('pages/ProjectsAdmin.vue') },
      { path: 'componardosettings', component: () => import('pages/ComponardoSettings.vue') },
      { path: 'scrapercontrolpanel', component: () => import('pages/ScraperControlPanel.vue') },
      { path: 'user', component: () => import('pages/UserProfile.vue') },
      { path: 'task/:uid', name: 'task', component: () => import('pages/Task.vue') },
      { path: 'login', name: 'login', component: () => import('pages/Login.vue') }
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
