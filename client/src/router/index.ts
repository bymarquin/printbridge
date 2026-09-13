import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/', redirect: '/app' },
    {
      path: '/app',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { auth: true },
      children: [
        {
          path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue'),
          meta: { title: 'Dashboard', subtitle: 'Panorama da operação.' },
        },
        {
          path: 'lojas', name: 'lojas', component: () => import('../views/LojasView.vue'),
          meta: { title: 'Lojas', subtitle: 'Cadastre e gerencie os estabelecimentos.' },
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
      ],
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.auth && !sessionStorage.getItem('pb_owner')) return '/login'
  return true
})

export default router
