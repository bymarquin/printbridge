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
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card><p class="text-sm text-zinc-400">Lojas</p><p class="mt-1 text-3xl font-bold text-white">{{ totalLojas }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Impressoras ok</p><p class="mt-1 text-3xl font-bold text-emerald-400">{{ online() }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Offline</p><p class="mt-1 text-3xl font-bold text-red-400">{{ offlineList().length }}</p></Card>
      <Card><p class="text-sm text-zinc-400">Falhas recentes</p><p class="mt-1 text-3xl font-bold text-amber-400">{{ falhas() }}</p></Card>
    </div>
    <Card title="Impressoras offline">
      <p v-if="offlineList().length === 0" class="text-sm text-zinc-400">Tudo online.</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="p in offlineList()" :key="p.agent + p.name">
          <b class="text-white">{{ p.agent }}</b> <span class="text-zinc-400">— {{ p.name }} ({{ p.derivedStatus }})</span>
        </li>
      </ul>
    </Card>
  </div>
</template>
