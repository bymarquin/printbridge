import { onMounted, onUnmounted, ref } from 'vue'

/** true quando rodando instalado como PWA (standalone) em vez do navegador. */
export function useIsPwa() {
  const isPwa = ref(false)
  const update = () => {
    isPwa.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
  }
  let mql: MediaQueryList | null = null
  onMounted(() => {
    update()
    mql = window.matchMedia('(display-mode: standalone)')
    mql.addEventListener('change', update)
  })
  onUnmounted(() => mql?.removeEventListener('change', update))
  return isPwa
}
