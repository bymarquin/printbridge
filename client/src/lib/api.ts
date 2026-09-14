/**
 * Cliente HTTP único do produto — toda req/res da UI passa por aqui.
 * Telas e stores importam daqui; nada de fetch espalhado nos .vue.
 */

import { useSession } from '../stores/session'

export const API_URL = import.meta.env.VITE_API_URL ?? 'https://printbridge.duckdns.org'

export type JobStatus = 'pending' | 'received' | 'printing' | 'completed' | 'failed'

export interface Agent { id: string; label: string; createdAt: string }
export interface Printer { agent: string; name: string; isDefault: boolean; derivedStatus: string; lastSeenAt: string }
export interface Job {
  id: string; orderId: string | null; idempotencyKey: string; printerId: string
  status: JobStatus; attempts: number; lastError: string | null
}
export interface Webhook { id: string; url: string; events: string[] }
export interface Enrolled { agentId: string; token: string }
export interface CreatedWebhook extends Webhook { secret: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError' }
}

interface CallOpts { ownerKey?: string; bearer?: string; method?: string; body?: unknown; timeoutMs?: number; session?: boolean }

const DEFAULT_TIMEOUT_MS = 15000

let refreshInflight: Promise<boolean> | null = null

/** Troca o refresh por par novo (rotação). Single-flight para rajadas 401. */
async function refreshOnce(): Promise<boolean> {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const session = useSession()
        if (!session.refreshToken) return false
        const r = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
        if (!r.ok) {
          session.clear()
          return false
        }
        const data = (await r.json()) as { session: SessionPair }
        session.saveSession(data.session)
        return true
      } catch {
        return false
      } finally {
        refreshInflight = null
      }
    })()
  }
  return refreshInflight
}

export interface SessionPair {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
}

function buildHeaders(opts: CallOpts): Record<string, string> {
  const headers: Record<string, string> = {}
  if (opts.ownerKey) headers['x-setup-key'] = opts.ownerKey
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`
  if (opts.session) {
    const access = useSession().accessToken
    if (access) headers['Authorization'] = `Bearer ${access}`
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  return headers
}

async function fetchOnce<T>(path: string, opts: CallOpts, headers: Record<string, string>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const r = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    })
    if (r.status === 204) return null as T
    const data = (await r.json().catch(() => ({}))) as { error?: string } & T
    if (!r.ok) throw new ApiError(r.status, String(data.error ?? `HTTP ${r.status}`))
    return data as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, ctrl.signal.aborted ? 'tempo esgotado (API fora do ar?)' : (e as Error).message)
  } finally {
    clearTimeout(timer)
  }
}

async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
  if (opts.session) {
    const session = useSession()
    if (!session.accessToken && session.refreshToken) await refreshOnce() // boot frio
  }
  try {
    return await fetchOnce<T>(path, opts, buildHeaders(opts))
  } catch (e) {
    // Sessão pode ter virado (15min): rotaciona UMA vez e repete.
    if (opts.session && e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      if (await refreshOnce()) return fetchOnce<T>(path, opts, buildHeaders(opts))
    }
    throw e
  }
}

const s = { session: true } as const
const b = (bearer: string) => ({ bearer })

export const api = {
  // sessão do dono (login persistente)
  login: (setupKey: string) =>
    call<{ session: SessionPair; tokenType: string }>('/auth/login', { method: 'POST', body: { setupKey } }),
  logout: (refreshToken: string) =>
    call<null>('/auth/logout', { method: 'POST', body: { refreshToken } }),

  // owner (via sessão; chave estática só no login)
  agents: () => call<{ agents: Agent[] }>('/print-agent/agents', s),
  enroll: (label: string) => call<Enrolled>('/print-agent/enroll', { ...s, method: 'POST', body: { label } }),
  revokeAgent: (id: string) => call<null>(`/print-agent/agents/${id}`, { ...s, method: 'DELETE' }),
  printersAll: () => call<{ printers: Printer[] }>('/print-agent/printers/all', s),
  recentJobs: (limit = 30) => call<{ jobs: Job[] }>(`/print-agent/jobs/recent?limit=${limit}`, s),
  webhooks: () => call<{ webhooks: Webhook[] }>('/print-agent/webhooks', s),
  createWebhook: (url: string) =>
    call<{ webhook: CreatedWebhook }>('/print-agent/webhooks', { ...s, method: 'POST', body: { url } }),
  deleteWebhook: (id: string) => call<null>(`/print-agent/webhooks/${id}`, { ...s, method: 'DELETE' }),

  // loja (bearer do token da loja)
  enqueue: (t: string, input: { idempotencyKey: string; payloadType: 'raw' | 'pdf'; payloadBase64: string; printerId: string; copies: number }) =>
    call<{ job: Job; deduplicated: boolean }>('/print-agent/jobs', { ...b(t), method: 'POST', body: input }),
  job: (t: string, id: string) => call<{ job: Job }>(`/print-agent/jobs/${id}`, b(t)),
  patchJob: (t: string, id: string, status: JobStatus) =>
    call<{ job: Job }>(`/print-agent/jobs/${id}`, { ...b(t), method: 'PATCH', body: { status } }),

  /** WS tempo real da loja — chamador fecha no unmount. */
  watchJobs: (token: string, onJob: (jobId: string) => void): WebSocket => {
    const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/print-agent/ws?token=${encodeURIComponent(token)}`)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type: string; jobId?: string }
        if (msg.type === 'new-job' && msg.jobId) onJob(msg.jobId)
      } catch { /* frame inválido — ignora */ }
    }
    return ws
  },
}
