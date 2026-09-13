<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type Agent } from '../lib/api'
import { useSession } from '../stores/session'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Input from '../components/ui/Input.vue'

const session = useSession()
const agents = ref<Agent[]>([])
const label = ref('')
const novoToken = ref('')
const erro = ref('')

async function carregar() {
  try {
    agents.value = (await api.agents(session.ownerKey)).agents
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

async function enroll() {
  erro.value = ''
  try {
    if (!label.value.trim()) return
    const d = await api.enroll(session.ownerKey, label.value.trim())
    session.saveToken(d.agentId, d.token)
    novoToken.value = d.token
    label.value = ''
    await carregar()
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

async function revogar(a: Agent) {
  erro.value = ''
  try {
    if (!confirm(`Revogar acesso da loja ${a.label}? O agente dela para de funcionar.`)) return
    await api.revokeAgent(session.ownerKey, a.id)
    session.forgetToken(a.id)
    await carregar()
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

onMounted(() => void carregar())
</script>

<template>
  <main class="min-h-screen bg-zinc-950 p-6 text-zinc-100">
    <h1 class="text-2xl font-bold text-white">🏪 Lojas</h1>
    <p v-if="erro" class="mt-2 text-sm text-red-400">{{ erro }}</p>
    <Card class="mt-4">
      <div class="flex items-end gap-2">
        <Input v-model="label" label="Nome da loja" placeholder="Ex.: Embraza Gringos" @keyup.enter="enroll" />
        <Button @click="enroll">Cadastrar</Button>
      </div>
    </Card>
    <p v-if="novoToken" class="mt-2 rounded-xl bg-emerald-950 p-4 text-sm">
      ✅ Token (aparece uma vez, já salvo neste navegador):<br /><code class="break-all">{{ novoToken }}</code>
    </p>
    <Card class="mt-4">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-zinc-400"><th class="py-2">Loja</th><th>ID</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in agents" :key="a.id" class="border-t border-zinc-800">
            <td class="py-2 font-semibold text-white">{{ a.label }}</td>
            <td><code class="text-xs">{{ a.id }}</code></td>
            <td class="text-right"><Button variant="danger" @click="revogar(a)">Revogar</Button></td>
          </tr>
        </tbody>
      </table>
    </Card>
  </main>
</template>
