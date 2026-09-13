<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { API_URL, api, type Webhook } from '../lib/api'
import { useSession } from '../stores/session'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Input from '../components/ui/Input.vue'

const session = useSession()
const hooks = ref<Webhook[]>([])
const url = ref('')
const secret = ref('')
const erro = ref('')

async function carregar() {
  try {
    hooks.value = (await api.webhooks(session.ownerKey)).webhooks
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

async function assinar() {
  erro.value = ''
  try {
    if (!url.value.trim()) return
    secret.value = (await api.createWebhook(session.ownerKey, url.value.trim())).webhook.secret
    url.value = ''
    await carregar()
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

async function excluir(id: string) {
  erro.value = ''
  try {
    if (!confirm('Excluir webhook?')) return
    await api.deleteWebhook(session.ownerKey, id)
    await carregar()
  } catch (e) {
    erro.value = '❌ ' + (e as Error).message
  }
}

onMounted(() => void carregar().catch(() => {}))
</script>

<template>
  <main class="min-h-screen bg-zinc-950 p-6 text-zinc-100">
    <h1 class="text-2xl font-bold text-white">🔌 Integrações</h1>
    <p v-if="erro" class="mt-2 text-sm text-red-400">{{ erro }}</p>

    <h2 class="mt-6 text-lg font-semibold text-white">Webhooks</h2>
    <Card class="mt-2">
      <div class="flex items-end gap-2">
        <Input v-model="url" label="URL https do sistema" placeholder="https://seu-sistema.com/hooks/print" class="grow" @keyup.enter="assinar" />
        <Button @click="assinar">Assinar tudo</Button>
      </div>
    </Card>
    <p v-if="secret" class="mt-2 rounded-xl bg-emerald-950 p-4 text-sm">✅ Secret (uma vez):<br /><code class="break-all">{{ secret }}</code></p>
    <Card class="mt-2">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-zinc-400"><th class="py-2">ID</th><th>URL</th><th>Eventos</th><th></th></tr></thead>
        <tbody>
          <tr v-for="w in hooks" :key="w.id" class="border-t border-zinc-800">
            <td class="py-2"><code class="text-xs">{{ w.id }}</code></td>
            <td>{{ w.url }}</td>
            <td class="text-zinc-400">{{ w.events.join(', ') }}</td>
            <td class="text-right"><Button variant="danger" @click="excluir(w.id)">Excluir</Button></td>
          </tr>
        </tbody>
      </table>
    </Card>

    <h2 class="mt-6 text-lg font-semibold text-white">Como integrar (5 min)</h2>
    <Card class="mt-2 text-sm">
      <p><b>1. Imprimir:</b> <code>POST /print-agent/jobs</code> com <code>idempotencyKey = orderId</code>, <code>payloadBase64</code> e <code>printerId</code> (setor).</p>
      <p class="mt-2"><b>2. Acompanhar:</b> assine o webhook acima ou consulte <code>GET /print-agent/jobs/:id</code>.</p>
      <p class="mt-2"><b>3. Assinatura:</b> header <code>x-printbridge-signature: sha256=&lt;hmac do corpo&gt;</code>.</p>
      <p class="mt-2"><b>4. Contrato completo:</b> <a :href="API_URL + '/openapi.json'" target="_blank" class="text-teal-300 underline">openapi.json</a></p>
    </Card>
  </main>
</template>
