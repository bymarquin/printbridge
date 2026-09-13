<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSession } from '../stores/session'

const router = useRouter()
const session = useSession()

const links = [
  { to: '/', label: '📊 Dashboard' },
  { to: '/lojas', label: '🏪 Lojas' },
  { to: '/impressoras', label: '🖨️ Impressoras' },
  { to: '/fila', label: '📋 Fila' },
  { to: '/integracoes', label: '🔌 Integrações' },
]

function sair() {
  session.logout()
  void router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen bg-zinc-950 text-zinc-100">
    <aside class="flex w-52 shrink-0 flex-col gap-1 border-r border-zinc-800 bg-zinc-900 p-4">
      <p class="mb-3 text-lg font-bold text-white">🖨️ PrintBridge</p>
      <RouterLink v-for="l in links" :key="l.to" :to="l.to" active-class="bg-zinc-800 text-white"
        class="rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
        {{ l.label }}
      </RouterLink>
      <button @click="sair" class="mt-auto rounded-md bg-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-700">
        Sair
      </button>
    </aside>
    <div class="min-w-0 flex-1"><slot /></div>
  </div>
</template>
