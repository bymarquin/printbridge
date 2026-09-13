<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api, type Agent, type Job } from '../lib/api'
import { useSession } from '../stores/session'
import { useToast } from '../stores/toast'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import Input from '../components/ui/Input.vue'
import Select from '../components/ui/Select.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import Table from '../components/ui/Table.vue'

const session = useSession()
const toast = useToast()
const jobs = ref<Job[]>([])
const lojas = ref<Agent[]>([])
const lojaWs = ref('')
const eventos = ref<string[]>([])
const tokenAvulso = ref('')
let ws: WebSocket | null = null
let timer = 0

async function carregar() {
  try {
    jobs.value = (await api.recentJobs(session.ownerKey)).jobs
  } catch { /* mantém estado */ }
}

const temToken = () => (session.tokens[lojaWs.value] ?? '') !== ''

function salvarToken() {
  if (!lojaWs.value || !tokenAvulso.value.trim()) return
  session.saveToken(lojaWs.value, tokenAvulso.value.trim())
  tokenAvulso.value = ''
  toast.success('Token salvo neste navegador')
  conectar()
}

function tokenDaLoja(id: string): string {
  return session.tokens[id] ?? ''
}

async function retry(j: Job) {
  try {
    const t = tokenDaLoja(lojaWs.value)
    if (!t) return
    await api.patchJob(t, j.id, 'pending')
    toast.success('Job reenfileirado', { description: 'Voltou para a fila de impressão.' })
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível reenfileirar o job.' })
  }
}

function conectar() {
  ws?.close()
  if (!lojaWs.value) return
  const t = tokenDaLoja(lojaWs.value)
  if (!t) {
    toast.warning('Loja sem token', { description: 'Cole o token abaixo para ativar o tempo real e o retry.' })
    return
  }
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
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <Select v-model="lojaWs" :options="lojas.map((l) => ({ value: l.id, label: l.label }))" @change="conectar" />
      <span class="text-xs text-zinc-400">WS da loja + polling 5s</span>
    </div>
    <Card v-if="lojaWs && !temToken()">
      <div class="flex items-end gap-2">
        <Input v-model="tokenAvulso" label="Token da loja (criada fora do painel)" placeholder="pb_…" type="password" class="grow" />
        <Button @click="salvarToken">Salvar</Button>
      </div>
    </Card>
    <Card v-if="eventos.length" class="text-sm text-teal-300">
      <p v-for="e in eventos.slice(0, 5)" :key="e">{{ e }}</p>
    </Card>
    <Card>
      <Table>
        <thead><tr><th>Pedido</th><th>Impressora</th><th>Status</th><th>Tent.</th><th>Erro</th><th></th></tr></thead>
        <tbody>
          <tr v-if="jobs.length === 0"><td colspan="6"><Empty>Nenhum job na fila.</Empty></td></tr>
          <tr v-for="j in jobs" :key="j.id">
            <td><code class="text-xs">{{ (j.orderId || j.idempotencyKey || '').slice(0, 24) }}</code></td>
            <td>{{ j.printerId }}</td>
            <td><StatusBadge :status="j.status" /></td>
            <td>{{ j.attempts }}</td>
            <td class="max-w-60 truncate text-zinc-400">{{ j.lastError ?? '' }}</td>
            <td class="text-right"><Button v-if="j.status === 'failed'" size="sm" @click="retry(j)">Retry</Button></td>
          </tr>
        </tbody>
      </Table>
    </Card>
  </div>
</template>
