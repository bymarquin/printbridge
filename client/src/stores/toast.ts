import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  description?: string
}

export interface ToastOpts {
  description?: string
  ms?: number
}

let nextId = 1
const DEFAULT_MS: Record<ToastKind, number> = { success: 4000, error: 6000, warning: 5000, info: 4000 }

/** Toasts globais — qualquer tela chama toast.success/error/warning/info. */
export const useToast = defineStore('toast', () => {
  const items = ref<Toast[]>([])

  function push(kind: ToastKind, message: string, msOrOpts?: number | ToastOpts) {
    const opts: ToastOpts = typeof msOrOpts === 'number' ? { ms: msOrOpts } : (msOrOpts ?? {})
    const id = nextId++
    items.value.push({ id, kind, message, description: opts.description })
    window.setTimeout(() => dismiss(id), opts.ms ?? DEFAULT_MS[kind])
    return id
  }

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id)
  }

  return {
    items,
    dismiss,
    success: (m: string, o?: number | ToastOpts) => push('success', m, o),
    error: (m: string, o?: number | ToastOpts) => push('error', m, o),
    warning: (m: string, o?: number | ToastOpts) => push('warning', m, o),
    info: (m: string, o?: number | ToastOpts) => push('info', m, o),
  }
})
