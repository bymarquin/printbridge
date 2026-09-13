<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api, type Job, type Printer } from '../lib/api'
import { useSession } from '../stores/session'
import Card from '../components/ui/Card.vue'

const session = useSession()
const printers = ref<Printer[]>([])
const jobs = ref<Job[]>([])
const totalLojas = ref(0)

async function carregar() {
  try {
    const [p, j, a] = await Promise.all([
      api.printersAll(session.ownerKey),
      api.recentJobs(session.ownerKey, 50),
      api.agents(session.ownerKey),
    ])
    printers.value = p.printers
    jobs.value = j.jobs
    totalLojas.value = a.agents.length
  } catch { /* mantém último estado em erro de rede */ }
}

const online = () => printers.value.filter((p) => p.derivedStatus === 'ready').length
const offlineList = () => printers.value.filter((p) => p.derivedStatus !== 'ready')
const falhas = () => jobs.value.filter((j) => j.status === 'failed').length

let timer = 0
onMounted(() => { void carregar(); timer = window.setInterval(() => void carregar(), 10000) })
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <main class="min-h-screen bg-zinc-950 p-6 text-zinc-100">
    <h1 class="text-2xl font-bold text-white">Dashboard</h1>
    <div class="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card><p class="text-sm text-zinc-400">Lojas</p><p class="text-3xl font-bold text-white">{{ totalLojas }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Impressoras ok</p><p class="text-3xl font-bold text-emerald-400">{{ online() }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Offline</p><p class="text-3xl font-bold text-red-400">{{ offlineList().length }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Falhas recentes</p><p class="text-3xl font-bold text-amber-400">{{ falhas() }}</p></Card>
    </div>
    <h2 class="mt-8 text-lg font-semibold text-white">Impressoras offline</h2>
    <Card>
      <p v-if="offlineList().length === 0" class="text-sm text-zinc-400">Tudo online. ✅</p>
      <ul v-else class="text-sm">
        <li v-for="p in offlineList()" :key="p.agent + p.name"><b>{{ p.agent }}</b> — {{ p.name }} ({{ p.derivedStatus }})</li>
      </ul>
    </Card>
  </main>
</template>
