# PrintBridge — integração em 5 minutos

Qualquer sistema web imprime em qualquer loja com 3 chamadas HTTPS. O sistema nunca fala com impressora: enfileira, o agente no PC da loja puxa e imprime.

Contrato máquina-legível: `GET /openapi.json`.

## 1. Onboard da loja (1 vez, como owner)

```bash
curl -X POST https://SUA-API/print-agent/enroll \
  -H "x-setup-key: $OWNER_SETUP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"loja-centro-caixa-1"}'
# → {"agentId":"ag_...","token":"pb_..."}  (guarde o token: 1 por loja)
```

No PC da loja: instale o `PrintBridge-Agent-setup.exe`, abra o assistente e cole a URL da API + a chave owner + nome do computador. Pronto — tray no ar, autostart ativo.

## 2. Imprimir (seu backend chama isso por pedido)

```js
const res = await fetch("https://SUA-API/print-agent/jobs", {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN_DA_LOJA}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    idempotencyKey: order.id,          // retry do pedido NUNCA duplica o cupom
    orderId: order.id,
    payloadType: "raw",                // ou "pdf"
    payloadBase64: Buffer.from(cupomEscPos).toString("base64"),
    printerId: "cozinha",              // setor: cozinha | bar | caixa
    copies: 1,
  }),
});
// 201 criado · 200 deduplicado (mesma key) · 422 payload > 5MB
```

## 3. Acompanhar sem polling: webhook

```bash
curl -X POST https://SUA-API/print-agent/webhooks \
  -H "Authorization: Bearer $TOKEN_DA_LOJA" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://seu-sistema.com/hooks/print","events":["job.completed","job.failed"],"printerIds":["cozinha"]}'
# → {"webhook":{"id":"wh_...","secret":"..."}}  (secret aparece UMA vez)
```

Eventos `job.*` chegam como `POST { event, job: { id, orderId, printerId, status, attempts, lastError }, timestamp }`. Eventos `printer.offline`/`printer.online` chegam como `POST { event, printer: { agentId, agentLabel, name, isDefault, lastSeenAt }, timestamp }` — disparado só na transição (impressora parou/voltou de responder por 90s), não a cada heartbeat. Ambos com headers `x-printbridge-event` e `x-printbridge-signature: sha256=<hmac hex do corpo>`. Verifique no Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function valid(secret, rawBody, header) {
  const expect = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header.length === expect.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expect));
}
```

Sem webhook, o fallback é `GET /print-agent/jobs/:id` → `pending → received → printing → completed | failed` (`409` = race benigna, `422` = transição inválida).

## 4. Impressoras e offline

```bash
curl https://SUA-API/print-agent/printers -H "Authorization: Bearer $TOKEN_DA_LOJA"
# → { printers: [{ name, isDefault, status, derivedStatus }] }
# derivedStatus = offline se 90s sem heartbeat do agente
```

Não precisa ficar fazendo polling nisso: assine `printer.offline`/`printer.online` no webhook (item 3) e é avisado assim que uma impressora para ou volta a responder.

## 5. Produção: o que dá errado e o que fazer

| Sinal | Significado | Ação |
|---|---|---|
| `200 deduplicated` | pedido reenviado | nada — cupom já está na fila |
| `failed` + `lastError` | papel/atolamento/offline | corrigir na loja e `PATCH /jobs/:id {"status":"pending"}` (retry) |
| `derivedStatus: offline` | PC/agente fora | checar notebook da loja |
| webhook para de chegar | URL fora ou `dead` | entregas retentam 30s e 5min; confira a URL e recadastre |

Limites: payload 5MB, `copies` 1–10, papel 58/80, webhook só `https` (http liberado só em `localhost`).
