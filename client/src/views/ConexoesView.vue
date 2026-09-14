<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api, type Agent, type Printer } from '../lib/api'
import { useToast } from '../stores/toast'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'

const toast = useToast()
const agents = ref<Agent[]>([])
const printers = ref<Printer[]>([])

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

let timer = 0
onMounted(() => {
  void carregar()
  timer = window.setInterval(() => void carregar(), 15000)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="space-y-4">
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
