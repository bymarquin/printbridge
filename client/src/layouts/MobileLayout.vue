<script setup lang="ts">
import { BookOpen, LayoutDashboard, ListOrdered, Plug, Printer, Store } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import logoHorizontal from '../assets/images/logo-horizontal.png'
import ProfileMenu from '../components/ProfileMenu.vue'

const route = useRoute()

const links = [
  { name: 'dashboard', label: 'Início', icon: LayoutDashboard },
  { name: 'lojas', label: 'Lojas', icon: Store },
  { name: 'impressoras', label: 'Impress.', icon: Printer },
  { name: 'fila', label: 'Fila', icon: ListOrdered },
  { name: 'integracoes', label: 'Integ.', icon: Plug },
  { name: 'docs', label: 'Docs', icon: BookOpen },
] as const
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="mx-auto max-w-6xl px-4 pb-28">
      <header class="flex items-center justify-between py-3">
        <img :src="logoHorizontal" alt="PrintBridge" class="h-7" />
        <ProfileMenu />
      </header>

      <div class="border-l-4 border-teal-400 pl-3">
        <h1 class="font-bold text-teal-300">{{ route.meta.title ?? '' }}</h1>
        <p class="text-sm text-zinc-400">{{ route.meta.subtitle ?? '' }}</p>
      </div>

      <div class="mt-4"><RouterView /></div>
    </div>

    <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur"
      style="padding-bottom: env(safe-area-inset-bottom)">
      <div class="mx-auto grid max-w-6xl grid-cols-6">
        <RouterLink v-for="l in links" :key="l.name" :to="{ name: l.name }"
          active-class="text-white"
          class="flex flex-col items-center gap-0.5 py-2 text-zinc-500 hover:text-white">
          <component :is="l.icon" :size="20" />
          <span class="text-[10px]">{{ l.label }}</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>
