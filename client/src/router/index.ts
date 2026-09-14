import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/', redirect: { name: 'dashboard' } },
    {
      path: '/app',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { auth: true },
      children: [
        { path: '', redirect: { name: 'dashboard' } },
        {
          path: 'dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'),
          meta: { title: 'Dashboard', subtitle: 'Panorama da operação.' },
        },
        {
          path: 'lojas', name: 'lojas', component: () => import('../views/LojasView.vue'),
          meta: { title: 'Lojas', subtitle: 'Cadastre e gerencie os estabelecimentos.' },
        },
        {
          path: 'conexoes', name: 'conexoes', component: () => import('../views/ConexoesView.vue'),
          meta: { title: 'Conexões', subtitle: 'Agentes online e pareamento.' },
        },
        {
          path: 'impressoras', name: 'impressoras', component: () => import('../views/ImpressorasView.vue'),
          meta: { title: 'Impressoras', subtitle: 'Status por loja.' },
        },
        {
          path: 'fila', name: 'fila', component: () => import('../views/FilaView.vue'),
          meta: { title: 'Fila', subtitle: 'Jobs em tempo real.' },
        },
        {
          path: 'integracoes', name: 'integracoes', component: () => import('../views/IntegracoesView.vue'),
          meta: { title: 'Integrações', subtitle: 'Webhooks e API.' },
        },
        {
          path: 'docs', name: 'docs', component: () => import('../views/DocsView.vue'),
          meta: { title: 'Docs', subtitle: 'Guia de integração em 5 minutos.' },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.auth && !localStorage.getItem('pb_refresh')) return { name: 'login' }
  return true
})

export default router
