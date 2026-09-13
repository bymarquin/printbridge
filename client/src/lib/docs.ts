/** Fonte única da documentação — o botão "copiar .md" usa exatamente este texto. */
export interface DocSection {
  id: string;
  title: string;
  md: string;
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'visao-geral',
    title: 'Visão geral',
    md: `Qualquer sistema web imprime em qualquer loja com 3 chamadas HTTPS. O sistema nunca fala com impressora: enfileira, o agente no PC da loja puxa e imprime.

- **Fila durável** — sem internet na loja, o job espera e sai sozinho
- **Sem duplicada** — \`idempotencyKey = orderId\`
- **Tempo real** — WebSocket com fallback de polling`,
  },
  {
    id: 'onboard',
    title: '1. Onboard da loja',
    md: `Uma vez por loja, como owner. A resposta traz o **token (guarde — aparece uma vez)**.

\`\`\`bash
curl -X POST https://SUA-API/print-agent/enroll \\
  -H "x-setup-key: $OWNER_SETUP_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"label":"loja-centro-caixa-1"}'
\`\`\``,
  },
  {
    id: 'imprimir',
    title: '2. Imprimir',
    md: `Seu backend chama isso por pedido. **201** criado · **200** deduplicado (mesma key) · **422** payload acima de 5MB.

\`\`\`js
await fetch("https://SUA-API/print-agent/jobs", {
  method: "POST",
  headers: { Authorization: \`Bearer \${TOKEN_DA_LOJA}\`, "Content-Type": "application/json" },
  body: JSON.stringify({
    idempotencyKey: order.id,
    payloadType: "raw", // ou "pdf"
    payloadBase64: Buffer.from(cupomEscPos).toString("base64"),
    printerId: "cozinha", // setor: cozinha | bar | caixa
    copies: 1,
  }),
});
\`\`\``,
  },
  {
    id: 'webhook',
    title: '3. Acompanhar via webhook',
    md: `Cada evento chega como \`POST { event, job, timestamp }\` com headers \`x-printbridge-event\` e \`x-printbridge-signature: sha256=<hmac hex do corpo>\`.

\`\`\`js
import { createHmac, timingSafeEqual } from "node:crypto";
function valid(secret, rawBody, header) {
  const expect = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header.length === expect.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expect));
}
\`\`\`

Sem webhook, o fallback é \`GET /print-agent/jobs/:id\` → \`pending → received → printing → completed | failed\`.`,
  },
  {
    id: 'producao',
    title: '4. Produção',
    md: `| Sinal | Significado | Ação |
|---|---|---|
| 200 deduplicated | pedido reenviado | nada — cupom já está na fila |
| failed + lastError | papel, atolamento ou offline | corrigir e retry (\`PATCH\` para \`pending\`) |
| derivedStatus offline | PC ou agente fora | checar o notebook da loja |`,
  },
];
