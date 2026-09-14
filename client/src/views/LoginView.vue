<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import logoStacked from '../assets/images/logo-stacked.png'
import { useToast } from '../stores/toast'
import { Printer } from 'lucide-vue-next'
import { api, ApiError } from '../lib/api'
import { useSession } from '../stores/session'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Input from '../components/ui/Input.vue'

const router = useRouter()
const toast = useToast()
const session = useSession()
const key = ref('')

async function entrar() {
  try {
    await api.agents(key.value.trim())
    session.login(key.value)
    void router.push({ name: 'dashboard' })
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      toast.error('Sem resposta da API', { description: 'Verifique sua conexão ou se a API está no ar.' })
    } else {
      toast.error('Chave inválida', { description: 'Confira a OWNER_SETUP_KEY e tente novamente.' })
    }
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
    <Card class="w-full max-w-sm text-center">
      <img :src="logoStacked" alt="PrintBridge" class="mx-auto h-28" />
      <p class="mt-3 text-sm text-zinc-400">Painel do dono — cole a chave owner</p>
      <Input v-model="key" type="password" placeholder="Sua chave owner" class="mt-4" @keyup.enter="entrar" />
      <Button class="mt-3 w-full" @click="entrar">Entrar</Button>
    </Card>
  </main>
</template>
