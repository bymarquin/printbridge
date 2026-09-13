<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type Agent } from '../lib/api'
import { useSession } from '../stores/session'
import { useToast } from '../stores/toast'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import Input from '../components/ui/Input.vue'
import Table from '../components/ui/Table.vue'

const session = useSession()
const toast = useToast()
const agents = ref<Agent[]>([])
const label = ref('')
const novoToken = ref('')

async function carregar() {
  try {
    agents.value = (await api.agents(session.ownerKey)).agents
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível carregar as lojas.' })
  }
}

async function enroll() {
  try {
    if (!label.value.trim()) return
    const d = await api.enroll(session.ownerKey, label.value.trim())
    session.saveToken(d.agentId, d.token)
    novoToken.value = d.token
    label.value = ''
      toast.success('Loja cadastrada', { description: 'Token exibido uma única vez. Guarde em local seguro.' })
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível cadastrar a loja.' })
  }
}

async function revogar(a: Agent) {
  try {
    if (!confirm(`Revogar acesso da loja ${a.label}? O agente dela para de funcionar.`)) return
    await api.revokeAgent(session.ownerKey, a.id)
    session.forgetToken(a.id)
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível revogar a loja.' })
  }
}

onMounted(() => void carregar())
</script>

<template>
  <div class="space-y-4">
    <Card>
      <div class="flex items-end gap-2">
        <Input v-model="label" label="Nome da loja" placeholder="Ex.: Embraza Gringos" class="grow" @keyup.enter="enroll" />
        <Button @click="enroll">Cadastrar</Button>
      </div>
    </Card>
    <p v-if="novoToken" class="rounded-xl bg-emerald-950 p-5 text-sm">
      Token (aparece uma vez, já salvo neste navegador):<br /><code class="break-all">{{ novoToken }}</code>
    </p>
    <Card>
      <Table>
        <thead><tr><th>Loja</th><th>ID</th><th></th></tr></thead>
        <tbody>
          <tr v-if="agents.length === 0"><td colspan="3"><Empty>Nenhuma loja cadastrada.</Empty></td></tr>
          <tr v-for="a in agents" :key="a.id">
            <td class="font-semibold text-white">{{ a.label }}</td>
            <td><code class="text-xs">{{ a.id }}</code></td>
            <td class="text-right"><Button variant="danger" size="sm" @click="revogar(a)">Revogar</Button></td>
          </tr>
        </tbody>
      </Table>
    </Card>
  </div>
</template>
