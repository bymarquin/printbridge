/**
 * Cliente HTTP único do produto — toda req/res da UI passa por aqui.
 * Telas e stores importam daqui; nada de fetch espalhado nos .vue.
 */

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

interface CallOpts { ownerKey?: string; bearer?: string; method?: string; body?: unknown; timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 15000

async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.ownerKey) headers['x-setup-key'] = opts.ownerKey
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
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

const o = (ownerKey: string) => ({ ownerKey })
const b = (bearer: string) => ({ bearer })

export const api = {
  // owner
  agents: (k: string) => call<{ agents: Agent[] }>('/print-agent/agents', o(k)),
  enroll: (k: string, label: string) => call<Enrolled>('/print-agent/enroll', { ...o(k), method: 'POST', body: { label } }),
  revokeAgent: (k: string, id: string) => call<null>(`/print-agent/agents/${id}`, { ...o(k), method: 'DELETE' }),
  printersAll: (k: string) => call<{ printers: Printer[] }>('/print-agent/printers/all', o(k)),
  recentJobs: (k: string, limit = 30) => call<{ jobs: Job[] }>(`/print-agent/jobs/recent?limit=${limit}`, o(k)),
  webhooks: (k: string) => call<{ webhooks: Webhook[] }>('/print-agent/webhooks', o(k)),
  createWebhook: (k: string, url: string) =>
    call<{ webhook: CreatedWebhook }>('/print-agent/webhooks', { ...o(k), method: 'POST', body: { url } }),
  deleteWebhook: (k: string, id: string) => call<null>(`/print-agent/webhooks/${id}`, { ...o(k), method: 'DELETE' }),

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
