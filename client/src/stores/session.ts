import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SessionPair } from '../lib/api'

/**
 * Sessão do dono: login persistente (refresh 30d em localStorage),
 * chave curta rotativa (access 15min em sessionStorage).
 * Tokens das lojas continuam em localStorage (pb_tokens).
 */
export const useSession = defineStore('session', () => {
  const accessToken = ref(sessionStorage.getItem('pb_access') ?? '')
  const refreshToken = ref(localStorage.getItem('pb_refresh') ?? '')
  const tokens = ref<Record<string, string>>(JSON.parse(localStorage.getItem('pb_tokens') ?? '{}'))

  const logged = computed(() => refreshToken.value.length > 0)

  function saveSession(pair: SessionPair) {
    accessToken.value = pair.accessToken
    refreshToken.value = pair.refreshToken
    sessionStorage.setItem('pb_access', pair.accessToken)
    localStorage.setItem('pb_refresh', pair.refreshToken)
  }

  function clear() {
    accessToken.value = ''
    refreshToken.value = ''
    sessionStorage.removeItem('pb_access')
    localStorage.removeItem('pb_refresh')
  }

  function saveToken(agentId: string, token: string) {
    tokens.value[agentId] = token
    localStorage.setItem('pb_tokens', JSON.stringify(tokens.value))
  }

  function forgetToken(agentId: string) {
    delete tokens.value[agentId]
    localStorage.setItem('pb_tokens', JSON.stringify(tokens.value))
  }

  return { accessToken, refreshToken, tokens, logged, saveSession, clear, saveToken, forgetToken }
})
