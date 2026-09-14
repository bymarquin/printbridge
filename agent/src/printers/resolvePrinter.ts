export interface KnownPrinter {
  name: string;
  isDefault: boolean;
  /** Porta do Windows (USB001, WSD…, TCP/IP). Ausente fora do Windows. */
  port?: string;
}

const isUsb = (p: KnownPrinter): boolean => !!p.port && /usb/i.test(p.port);

/**
 * Descoberta por prioridade (loja típica = zero configuração):
 * 1) nome exato pedido no job (setor)
 * 2) única USB direta
 * 3) padrão do Windows
 * 4) única impressora (qualquer porta)
 * 5) passthrough (deixa a spool falhar com erro real) ou default
 */
export function resolvePrinter(
  wanted: string,
  known: KnownPrinter[],
  defaultPrinter?: string,
  log: (msg: string) => void = () => {},
): string {
  if (wanted && known.some((p) => p.name === wanted)) return wanted;
  const usb = known.filter(isUsb);
  if (usb.length === 1 && usb[0]) {
    if (wanted !== usb[0].name) log(`impressora USB única: '${wanted || "(vazio)"}' -> '${usb[0].name}'`);
    return usb[0].name;
  }
  const def = known.find((p) => p.isDefault);
  if (def && (!wanted || !known.some((p) => p.name === wanted))) return def.name;
  if (known.length === 1 && known[0]) {
    if (wanted !== known[0].name) log(`impressora única: '${wanted || "(vazio)"}' -> '${known[0].name}'`);
    return known[0].name;
  }
  return wanted || defaultPrinter || "";
}
