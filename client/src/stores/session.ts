import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Sessão do dono: chave owner (só na aba) + tokens das lojas (neste navegador).
 * Mesmas chaves do /app/admin legado — os dois painéis compartilham.
 */
export const useSession = defineStore('session', () => {
  const ownerKey = ref(sessionStorage.getItem('pb_owner') ?? '')
  const tokens = ref<Record<string, string>>(JSON.parse(localStorage.getItem('pb_tokens') ?? '{}'))

  const logged = computed(() => ownerKey.value.length > 0)

  function login(key: string) {
    ownerKey.value = key.trim()
    sessionStorage.setItem('pb_owner', ownerKey.value)
  }

  function logout() {
    ownerKey.value = ''
    sessionStorage.removeItem('pb_owner')
  }

  function saveToken(agentId: string, token: string) {
    tokens.value[agentId] = token
    localStorage.setItem('pb_tokens', JSON.stringify(tokens.value))
  }

  function forgetToken(agentId: string) {
    delete tokens.value[agentId]
    localStorage.setItem('pb_tokens', JSON.stringify(tokens.value))
  }

  return { ownerKey, tokens, logged, login, logout, saveToken, forgetToken }
})
