<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type Printer } from '../lib/api'
import { useSession } from '../stores/session'
import StatusBadge from '../components/ui/StatusBadge.vue'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Select from '../components/ui/Select.vue'

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
  <main class="min-h-screen bg-zinc-950 p-6 text-zinc-100">
    <div class="flex items-center gap-4">
      <h1 class="text-2xl font-bold text-white">🖨️ Impressoras</h1>
      <Select v-model="filtro" :options="[{ value: '', label: 'Todas as lojas' }, ...lojas]" />
      <Button variant="ghost" @click="carregar">↻</Button>
    </div>
    <Card class="mt-4">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-zinc-400"><th class="py-2">Loja</th><th>Impressora</th><th>Padrão</th><th>Status</th><th>Vista</th></tr></thead>
        <tbody>
          <tr v-for="p in lista" :key="p.agent + p.name" class="border-t border-zinc-800">
            <td class="py-2">{{ p.agent }}</td>
            <td class="font-semibold text-white">{{ p.name }}</td>
            <td>{{ p.isDefault ? '⭐' : '' }}</td>
            <td><StatusBadge :status="p.derivedStatus" /></td>
            <td class="text-zinc-400">{{ new Date(p.lastSeenAt).toLocaleString('pt-BR') }}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  </main>
</template>
