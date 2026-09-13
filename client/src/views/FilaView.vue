<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api, type Agent, type Job } from '../lib/api'
import { useSession } from '../stores/session'
import StatusBadge from '../components/ui/StatusBadge.vue'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Select from '../components/ui/Select.vue'

const session = useSession()
const jobs = ref<Job[]>([])
const lojas = ref<Agent[]>([])
const lojaWs = ref('')
const eventos = ref<string[]>([])
const erro = ref('')
let ws: WebSocket | null = null
let timer = 0

async function carregar() {
  try {
    jobs.value = (await api.recentJobs(session.ownerKey)).jobs
  } catch { /* mantém estado */ }
}

function tokenDaLoja(id: string): string {
  const t = session.tokens[id] ?? ''
  if (!t) alert('Token da loja não salvo neste navegador (aparece uma vez no cadastro)')
  return t
}

async function retry(j: Job) {
  erro.value = ''
  try {
    const t = tokenDaLoja(lojaWs.value)
    if (!t) return
    await api.patchJob(t, j.id, 'pending')
    await carregar()
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

function conectar() {
  ws?.close()
  if (!lojaWs.value) return
  const t = tokenDaLoja(lojaWs.value)
  if (!t) return
  ws = api.watchJobs(t, (jobId) => {
    eventos.value.unshift(`${new Date().toLocaleTimeString('pt-BR')} — novo job ${jobId.slice(0, 8)}…`)
    void carregar()
  })
}

onMounted(async () => {
  try {
    lojas.value = (await api.agents(session.ownerKey)).agents
    if (lojas.value[0]) { lojaWs.value = lojas.value[0].id; conectar() }
  } catch { /* sem chave */ }
  await carregar()
  timer = window.setInterval(() => void carregar(), 5000)
})
onUnmounted(() => { window.clearInterval(timer); ws?.close() })
</script>

<template>
  <main class="min-h-screen bg-zinc-950 p-6 text-zinc-100">
    <div class="flex items-center gap-4">
      <h1 class="text-2xl font-bold text-white">📋 Fila ao vivo</h1>      <Select v-model="lojaWs" :options="lojas.map((l) => ({ value: l.id, label: l.label }))" @change="conectar" />
      <span class="text-xs text-zinc-400">WS da loja + polling 5s</span>
    </div>
    <p v-if="erro" class="mt-2 text-sm text-red-400">{{ erro }}</p>
    <Card v-if="eventos.length" class="mt-4 text-sm text-teal-300">
      <p v-for="e in eventos.slice(0, 5)" :key="e">{{ e }}</p>
    </Card>
    <Card class="mt-4">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-zinc-400"><th class="py-2">Pedido</th><th>Impressora</th><th>Status</th><th>Tent.</th><th>Erro</th><th></th></tr></thead>
        <tbody>
          <tr v-for="j in jobs" :key="j.id" class="border-t border-zinc-800">
            <td class="py-2"><code class="text-xs">{{ (j.orderId || j.idempotencyKey || '').slice(0, 24) }}</code></td>
            <td>{{ j.printerId }}</td>
            <td><StatusBadge :status="j.status" /></td>
            <td>{{ j.attempts }}</td>
            <td class="max-w-60 truncate text-zinc-400">{{ j.lastError ?? '' }}</td>
            <td class="text-right"><Button v-if="j.status === 'failed'" @click="retry(j)">Retry</Button></td>
          </tr>
        </tbody>
      </table>
    </Card>
  </main>
</template>
