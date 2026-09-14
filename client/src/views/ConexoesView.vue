<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, type Agent, type Printer } from '../lib/api'
import { useSession } from '../stores/session'
import { useToast } from '../stores/toast'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import Input from '../components/ui/Input.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'

const session = useSession()
const toast = useToast()
const route = useRoute()
const agents = ref<Agent[]>([])
const printers = ref<Printer[]>([])
const codigo = ref('')
const novoToken = ref('')

const ONLINE_MS = 90_000

async function carregar() {
  try {
    const [a, p] = await Promise.all([api.agents(), api.printersAll()])
    agents.value = a.agents
    printers.value = p.printers
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível carregar as conexões.' })
  }
}

const porLoja = computed(() => {
  const map = new Map<string, { agent: Agent; printers: Printer[]; lastSeen: string | null; online: boolean }>()
  for (const a of agents.value) map.set(a.id, { agent: a, printers: [], lastSeen: null, online: false })
  for (const p of printers.value) {
    const entry = [...map.values()].find((e) => e.agent.label === p.agent)
    if (!entry) continue
    entry.printers.push(p)
    if (!entry.lastSeen || p.lastSeenAt > entry.lastSeen) entry.lastSeen = p.lastSeenAt
  }
  const agora = Date.now()
  for (const e of map.values()) e.online = !!e.lastSeen && agora - Date.parse(e.lastSeen) < ONLINE_MS
  return [...map.values()]
})

async function aprovar() {
  try {
    const code = codigo.value.trim().toUpperCase()
    if (!code) return
    const d = await api.pairApprove(code)
    session.saveToken(d.agentId, d.token)
    novoToken.value = d.token
    codigo.value = ''
    toast.success(`Loja ${d.label} conectada`, { description: 'O agente aparece online em segundos.' })
    await carregar()
    limparQuery()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Confira o código no PC da loja.' })
  }
}

function limparQuery() {
  const url = new URL(window.location.href)
  if (url.searchParams.has('code')) {
    url.searchParams.delete('code')
    window.history.replaceState({}, '', url.toString())
  }
}

let timer = 0
onMounted(() => {
  const q = route.query.code
  if (typeof q === 'string' && q.trim()) codigo.value = q.trim().toUpperCase()
  void carregar()
  timer = window.setInterval(() => void carregar(), 15000)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="space-y-4">
    <Card title="Parear novo agente">
      <p class="mb-3 text-sm text-zinc-400">No PC da loja, clique em <b class="text-zinc-200">Parear com código</b> e digite aqui as 6 letras — ou escaneie o QR, que já abre esta tela com o código.</p>
      <div class="flex items-end gap-2">
        <Input v-model="codigo" label="Código de pareamento" placeholder="ABC123" class="grow uppercase" @keyup.enter="aprovar" />
        <Button @click="aprovar">Aprovar e conectar</Button>
      </div>
    </Card>
    <p v-if="novoToken" class="rounded-xl bg-emerald-950 p-5 text-sm">
      Token (aparece uma vez, já salvo neste navegador):<br /><code class="break-all">{{ novoToken }}</code>
    </p>
    <div class="grid gap-4 md:grid-cols-2">
      <Card v-for="e in porLoja" :key="e.agent.id">
        <div class="mb-2 flex items-center justify-between">
          <p class="font-semibold text-white">{{ e.agent.label }}</p>
          <StatusBadge :status="e.online ? 'online' : 'offline'" />
        </div>
        <p v-if="e.printers.length === 0" class="text-sm text-zinc-500">Nenhuma impressora sincronizada.</p>
        <ul v-else class="space-y-1 text-sm">
          <li v-for="p in e.printers" :key="p.name" class="flex justify-between">
            <span>{{ p.name }} {{ p.isDefault ? '· Padrão' : '' }}</span>
            <span class="text-zinc-500">{{ p.derivedStatus }}</span>
          </li>
        </ul>
        <p class="mt-2 text-xs text-zinc-500">
          {{ e.lastSeen ? 'Visto ' + new Date(e.lastSeen).toLocaleString('pt-BR') : 'Nunca conectado' }}
        </p>
      </Card>
    </div>
    <Card v-if="porLoja.length === 0"><Empty>Nenhuma loja conectada.</Empty></Card>
  </div>
</template>
