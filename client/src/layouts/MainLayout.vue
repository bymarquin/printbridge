<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, LayoutDashboard, ListOrdered, LogOut, Plug, Printer, Store } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import logoHorizontal from '../assets/images/logo-horizontal.png'
import { api } from '../lib/api'
import { useSession } from '../stores/session'

const route = useRoute()
const router = useRouter()
const session = useSession()
const menuAberto = ref(false)
const avatarUrl = 'https://api.dicebear.com/9.x/initials/svg?seed=PrintBridge&backgroundColor=27272a'

const links = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'lojas', label: 'Lojas', icon: Store },
  { name: 'impressoras', label: 'Impressoras', icon: Printer },
  { name: 'fila', label: 'Fila', icon: ListOrdered },
  { name: 'integracoes', label: 'Integrações', icon: Plug },
  { name: 'docs', label: 'Docs', icon: BookOpen },
] as const

function sair() {
  menuAberto.value = false
  const refresh = session.refreshToken
  session.clear()
  if (refresh) void api.logout(refresh).catch(() => {})
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto max-w-6xl px-4 pb-10">
      <button v-if="menuAberto" class="fixed inset-0 z-40 cursor-default" aria-hidden="true" @click="menuAberto = false" />
      <header class="flex items-center justify-between py-4">
        <div class="flex items-center gap-2">
          <img :src="logoHorizontal" alt="PrintBridge" class="h-9" />
        </div>
        <div class="relative">
          <button @click="menuAberto = !menuAberto" title="Perfil"            class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-800 hover:bg-zinc-700">
            <img :src="avatarUrl" alt="Perfil" class="h-8 w-8" />
          </button>
          <div v-if="menuAberto" class="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
            <p class="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">Dono</p>
            <button @click="sair"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
              <LogOut :size="16" /> Sair
            </button>
          </div>
        </div>
      </header>

      <nav class="flex items-center justify-center gap-2 overflow-x-auto rounded-xl bg-zinc-900 px-4 py-3">
        <RouterLink v-for="l in links" :key="l.name" :to="{ name: l.name }"
          active-class="bg-zinc-800 text-white"
          class="flex flex-col items-center gap-1 rounded-lg px-5 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white">
          <component :is="l.icon" :size="22" />
          {{ l.label }}
        </RouterLink>
      </nav>

      <div class="mt-6 border-l-4 border-teal-400 pl-3">
        <h1 class="font-bold text-teal-300">{{ route.meta.title ?? '' }}</h1>
        <p class="text-sm text-zinc-400">{{ route.meta.subtitle ?? '' }}</p>
      </div>

      <div class="mt-4"><RouterView /></div>
    </div>
  </div>
</template>
