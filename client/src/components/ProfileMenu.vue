<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut } from 'lucide-vue-next'
import { api } from '../lib/api'
import { useSession } from '../stores/session'

const router = useRouter()
const session = useSession()
const aberto = ref(false)

function sair() {
  aberto.value = false
  const refresh = session.refreshToken
  session.clear()
  if (refresh) void api.logout(refresh).catch(() => {})
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="relative">
    <button v-if="aberto" class="fixed inset-0 z-40 cursor-default" aria-hidden="true" @click="aberto = false" />
    <button @click="aberto = !aberto" title="Perfil"
      class="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-white hover:bg-zinc-600">
      PB
    </button>
    <div v-if="aberto" class="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
      <p class="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">Dono</p>
      <button @click="sair"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
        <LogOut :size="16" /> Sair
      </button>
    </div>
  </div>
</template>
