<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, ApiError } from '../lib/api'
import { useSession } from '../stores/session'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Input from '../components/ui/Input.vue'

const router = useRouter()
const session = useSession()
const key = ref('')
const erro = ref('')

async function entrar() {
  erro.value = ''
  try {
    await api.agents(key.value.trim())
    session.login(key.value)
    void router.push('/')
  } catch (e) {
    erro.value = '❌ ' + (e instanceof ApiError ? 'chave inválida' : (e as Error).message)
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
    <Card class="w-full max-w-sm text-center">
      <h1 class="text-2xl font-bold text-white">🖨️ PrintBridge</h1>
      <p class="mt-1 text-sm text-zinc-400">Painel do dono — cole a chave owner</p>
      <Input v-model="key" type="password" placeholder="OWNER_SETUP_KEY" class="mt-4" @keyup.enter="entrar" />
      <Button class="mt-3 w-full" @click="entrar">Entrar</Button>
      <p v-if="erro" class="mt-2 text-sm text-red-400">{{ erro }}</p>
    </Card>
  </main>
</template>
