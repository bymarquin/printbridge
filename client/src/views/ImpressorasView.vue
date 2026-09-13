<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { api, type Printer } from '../lib/api'
import { useSession } from '../stores/session'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Empty from '../components/ui/Empty.vue'
import Select from '../components/ui/Select.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import Table from '../components/ui/Table.vue'

const session = useSession()
const printers = ref<Printer[]>([])
const filtro = ref('')

async function carregar() {
  printers.value = (await api.printersAll(session.ownerKey)).printers
}

const lista = computed(() => (filtro.value ? printers.value.filter((p) => p.agent === filtro.value) : printers.value))
const lojas = computed(() => [...new Set(printers.value.map((p) => p.agent))].map((l) => ({ value: l, label: l })))

onMounted(() => void carregar())
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <Select v-model="filtro" :options="[{ value: '', label: 'Todas as lojas' }, ...lojas]" />
      <Button variant="ghost" @click="carregar" title="Recarregar"><RefreshCw :size="16" /></Button>
    </div>
    <Card>
      <Table>
        <thead><tr><th>Loja</th><th>Impressora</th><th>Padrão</th><th>Status</th><th>Vista</th></tr></thead>
        <tbody>
          <tr v-if="lista.length === 0"><td colspan="5"><Empty>Nenhuma impressora sincronizada.</Empty></td></tr>
          <tr v-for="p in lista" :key="p.agent + p.name">
            <td>{{ p.agent }}</td>
            <td class="font-semibold text-white">{{ p.name }}</td>
            <td><span v-if="p.isDefault" class="inline-flex h-5 items-center rounded-full bg-zinc-800 px-2.5 text-xs font-medium text-zinc-300">Padrão</span></td>
            <td><StatusBadge :status="p.derivedStatus" /></td>
            <td class="text-zinc-400">{{ new Date(p.lastSeenAt).toLocaleString('pt-BR') }}</td>
          </tr>
        </tbody>
      </Table>
    </Card>
  </div>
</template>
