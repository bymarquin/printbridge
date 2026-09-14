<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, type Agent } from '../lib/api'
import { useSession } from '../stores/session'
import { useToast } from '../stores/toast'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import Empty from '../components/ui/Empty.vue'
import Input from '../components/ui/Input.vue'
import Table from '../components/ui/Table.vue'

const session = useSession()
const toast = useToast()
const agents = ref<Agent[]>([])
const label = ref('')
const novoToken = ref('')
const codigo = ref('')
const revogando = ref<Agent | null>(null)

async function aprovar() {
  try {
    const code = codigo.value.trim().toUpperCase()
    if (!code) return
    const d = await api.pairApprove(code)
    session.saveToken(d.agentId, d.token)
    novoToken.value = d.token
    codigo.value = ''
    toast.success(`Loja ${d.label} pareada`, { description: 'O agente conectou sozinho.' })
    await carregar()
    void routerReplaceClean()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Confira o código no PC da loja.' })
  }
}

/** Limpa o ?code= da URL após usar (magic link de uso único visual). */
function routerReplaceClean() {
  const url = new URL(window.location.href)
  if (url.searchParams.has('code')) {
    url.searchParams.delete('code')
    window.history.replaceState({}, '', url.toString())
  }
}

async function carregar() {
  try {
    agents.value = (await api.agents()).agents
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível carregar as lojas.' })
  }
}

async function enroll() {
  try {
    if (!label.value.trim()) return
    const d = await api.enroll(label.value.trim())
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
    await api.revokeAgent(a.id)
    session.forgetToken(a.id)
    toast.success('Acesso revogado', { description: `O agente da loja ${a.label} parou de funcionar.` })
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível revogar a loja.' })
  } finally {
    revogando.value = null
  }
}

onMounted(() => {
  // Magic link do QR: /app/lojas?code=XXXXXX já vem preenchido.
  const q = useRoute().query.code
  if (typeof q === 'string' && q.trim()) codigo.value = q.trim().toUpperCase()
  void carregar()
})
</script>

<template>
  <div class="space-y-4">
    <Card>
      <div class="flex items-end gap-2">
        <Input v-model="label" label="Nome da loja" placeholder="Nome da sua loja" class="grow" @keyup.enter="enroll" />
        <Button @click="enroll">Cadastrar</Button>
      </div>
    </Card>
    <p v-if="novoToken" class="rounded-xl bg-emerald-950 p-5 text-sm">
      Token (aparece uma vez, já salvo neste navegador):<br /><code class="break-all">{{ novoToken }}</code>
    </p>
    <Card title="Parear novo agente">
      <p class="mb-3 text-sm text-zinc-400">No PC da loja, clique em <b class="text-zinc-200">Parear com código</b> e digite aqui as 6 letras — ou escaneie o QR que leva direto pra esta tela.</p>
      <div class="flex items-end gap-2">
        <Input v-model="codigo" label="Código de pareamento" placeholder="ABC123" class="grow uppercase" @keyup.enter="aprovar" />
        <Button @click="aprovar">Aprovar</Button>
      </div>
    </Card>
    <Card>
      <Table>
        <thead><tr><th>Loja</th><th>ID</th><th></th></tr></thead>
        <tbody>
          <tr v-if="agents.length === 0"><td colspan="3"><Empty>Nenhuma loja cadastrada.</Empty></td></tr>
          <tr v-for="a in agents" :key="a.id">
            <td class="font-semibold text-white">{{ a.label }}</td>
            <td><code class="text-xs">{{ a.id }}</code></td>
            <td class="text-right"><Button variant="danger" size="sm" @click="revogando = a">Revogar</Button></td>
          </tr>
        </tbody>
      </Table>
    </Card>
    <ConfirmModal v-if="revogando" title="Revogar loja?"
      :message="`O agente da loja ${revogando.label} para de funcionar na hora.`"
      @ok="revogar(revogando)" @cancel="revogando = null" />
  </div>
</template>
