import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import LojasView from '../views/LojasView.vue'
import ImpressorasView from '../views/ImpressorasView.vue'
import FilaView from '../views/FilaView.vue'
import IntegracoesView from '../views/IntegracoesView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'dashboard', component: DashboardView, meta: { auth: true } },
    { path: '/lojas', name: 'lojas', component: LojasView, meta: { auth: true } },
    { path: '/impressoras', name: 'impressoras', component: ImpressorasView, meta: { auth: true } },
    { path: '/fila', name: 'fila', component: FilaView, meta: { auth: true } },
    { path: '/integracoes', name: 'integracoes', component: IntegracoesView, meta: { auth: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.auth && !sessionStorage.getItem('pb_owner')) return '/login'
  return true
})

export default router
