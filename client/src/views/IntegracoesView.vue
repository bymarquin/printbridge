<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { API_URL, api, type Webhook } from '../lib/api'
import { useSession } from '../stores/session'
import { useToast } from '../stores/toast'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import Input from '../components/ui/Input.vue'
import Table from '../components/ui/Table.vue'

const session = useSession()
const toast = useToast()
const hooks = ref<Webhook[]>([])
const url = ref('')
const secret = ref('')

async function carregar() {
  try {
    hooks.value = (await api.webhooks(session.ownerKey)).webhooks
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível carregar os webhooks.' })
  }
}

async function assinar() {
  try {
    if (!url.value.trim()) return
    secret.value = (await api.createWebhook(session.ownerKey, url.value.trim())).webhook.secret
    url.value = ''
    toast.success('Webhook assinado', { description: 'Eventos de status serão enviados para a URL.' })
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível assinar o webhook.' })
  }
}

async function excluir(id: string) {
  try {
    if (!confirm('Excluir webhook?')) return
    await api.deleteWebhook(session.ownerKey, id)
    await carregar()
  } catch (e) {
    toast.error((e as Error).message, { description: 'Não foi possível excluir o webhook.' })
  }
}

onMounted(() => void carregar().catch(() => {}))
</script>

<template>
  <div class="space-y-4">
    <Card title="Webhooks">
      <div class="flex items-end gap-2">
        <Input v-model="url" label="URL https do sistema" placeholder="https://seu-sistema.com/hooks/print" class="grow" @keyup.enter="assinar" />
        <Button @click="assinar">Assinar tudo</Button>
      </div>
    </Card>
    <p v-if="secret" class="rounded-xl bg-emerald-950 p-5 text-sm">Secret (uma vez):<br /><code class="break-all">{{ secret }}</code></p>
    <Card>
      <Table>
        <thead><tr><th>ID</th><th>URL</th><th>Eventos</th><th></th></tr></thead>
        <tbody>
          <tr v-if="hooks.length === 0"><td colspan="4"><Empty>Nenhum webhook assinado.</Empty></td></tr>
          <tr v-for="w in hooks" :key="w.id">
            <td><code class="text-xs">{{ w.id }}</code></td>
            <td>{{ w.url }}</td>
            <td class="text-zinc-400">{{ w.events.join(', ') }}</td>
            <td class="text-right"><Button variant="danger" size="sm" @click="excluir(w.id)">Excluir</Button></td>
          </tr>
        </tbody>
      </Table>
    </Card>
    <Card title="Como integrar (5 min)">
      <div class="space-y-2 text-sm">
        <p><b>1. Imprimir:</b> <code>POST /print-agent/jobs</code> com <code>idempotencyKey = orderId</code>, <code>payloadBase64</code> e <code>printerId</code> (setor).</p>
        <p><b>2. Acompanhar:</b> assine o webhook acima ou consulte <code>GET /print-agent/jobs/:id</code>.</p>
        <p><b>3. Assinatura:</b> header <code>x-printbridge-signature: sha256=&lt;hmac do corpo&gt;</code>.</p>
        <p><b>4. Contrato completo:</b> <a :href="API_URL + '/openapi.json'" target="_blank" class="text-teal-300 underline">openapi.json</a></p>
      </div>
    </Card>
  </div>
</template>
