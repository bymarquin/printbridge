/**
 * Contrato público da API PrintBridge para sistemas web.
 * Servido em GET /openapi.json — espelha exatamente as rotas de routes/printAgent.ts.
 */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "PrintBridge API",
    version: "0.1.0",
    description:
      "Fila durável de impressão para sistemas web. O sistema enfileira jobs via HTTPS; o agente na loja puxa via WSS/polling e imprime. Webhooks avisam cada transição.",
  },
  servers: [{ url: "https://sua-api.exemplo.com", description: "VPS do lojista" }],
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", description: "Token do agente/loja (POST /print-agent/enroll)" },
      setupKey: { type: "apiKey", in: "header", name: "x-setup-key", description: "Chave owner — só enroll" },
    },
    schemas: {
      PrintJob: {
        type: "object",
        properties: {
          id: { type: "string" },
          idempotencyKey: { type: "string" },
          orderId: { type: ["string", "null"] },
          payloadType: { type: "string", enum: ["pdf", "raw"] },
          payloadBase64: { type: "string" },
          printerId: { type: "string" },
          copies: { type: "integer" },
          paperWidth: { type: "integer", enum: [58, 80] },
          status: { type: "string", enum: ["pending", "received", "printing", "completed", "failed"] },
          attempts: { type: "integer" },
          lastError: { type: ["string", "null"] },
          nextAttemptAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      EnqueueInput: {
        type: "object",
        required: ["idempotencyKey", "payloadType", "payloadBase64", "printerId"],
        properties: {
          idempotencyKey: { type: "string", minLength: 8, maxLength: 128, description: "Use o orderId — retry não duplica" },
          orderId: { type: "string" },
          payloadType: { type: "string", enum: ["pdf", "raw"] },
          payloadBase64: { type: "string", description: "PDF binário ou texto/ESC-POS em base64 (máx 5MB)" },
          printerId: { type: "string", description: "Setor: cozinha, bar, caixa…" },
          copies: { type: "integer", minimum: 1, maximum: 10, default: 1 },
          paperWidth: { type: "integer", enum: [58, 80], default: 80 },
        },
      },
      Webhook: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string", description: "Destino https — recebe POST a cada evento" },
          secret: { type: "string", description: "Só no POST de criação — assina x-printbridge-signature" },
          events: { type: "array", items: { type: "string" } },
          printerIds: { type: "array", items: { type: "string" }, description: "Vazio = todas as impressoras" },
        },
      },
      WebhookDelivery: {
        type: "object",
        description: "Eventos job.*: POST { event, job: { id, orderId, printerId, status, attempts, lastError }, timestamp }. Eventos printer.*: POST { event, printer: { agentId, agentLabel, name, isDefault, lastSeenAt }, timestamp } — disparado na transição (não a cada heartbeat) quando uma impressora passa de/para offline (90s sem sync). Headers: x-printbridge-event, x-printbridge-signature: sha256=<hmac hex do corpo>.",
        properties: {
          event: {
            type: "string",
            enum: [
              "job.created", "job.received", "job.printing", "job.completed", "job.failed", "job.requeued",
              "printer.offline", "printer.online",
            ],
          },
          job: { $ref: "#/components/schemas/PrintJob", description: "Presente só em eventos job.*" },
          printer: {
            type: "object",
            description: "Presente só em eventos printer.*",
            properties: {
              agentId: { type: "string" },
              agentLabel: { type: "string" },
              name: { type: "string" },
              isDefault: { type: "boolean" },
              lastSeenAt: { type: "string", format: "date-time" },
            },
          },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  paths: {
    "/health": {
      get: { summary: "Sonda", responses: { "200": { description: "ok" } } },
    },
    "/openapi.json": {
      get: { summary: "Este contrato", responses: { "200": { description: "OpenAPI JSON" } } },
    },
    "/app/admin": {
      get: { summary: "Painel do dono (HTML, login com x-setup-key na página)", responses: { "200": { description: "página HTML" } } },
    },
    "/auth/login": {
      post: {
        summary: "Login persistente (access 15min + refresh 30d rotativo)",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { setupKey: { type: "string" } } } } } },
        responses: { "200": { description: "{ session, tokenType }" }, "403": { description: "forbidden" } },
      },
    },
    "/auth/refresh": {
      post: {
        summary: "Rotaciona o par (refresh antigo morre; reuso derruba a cadeia)",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { refreshToken: { type: "string" } } } } } },
        responses: { "200": { description: "{ session, tokenType }" }, "403": { description: "inválido/expirado" } },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Revoga a sessão",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { refreshToken: { type: "string" } } } } } },
        responses: { "204": { description: "revogado" } },
      },
    },
    "/print-agent/enroll": {
      post: {
        summary: "Gera token da loja (sessão owner ou setup key)",
        security: [{ bearer: [] }, { setupKey: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" } } } } } },
        responses: { "201": { description: "agentId + token (guarde — não é recuperável)" }, "403": { description: "setup key inválida" } },
      },
    },
    "/print-agent/jobs": {
      post: {
        summary: "Enfileirar impressão (idempotente)",
        security: [{ bearer: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/EnqueueInput" } } } },
        responses: { "201": { description: "criado" }, "200": { description: "deduplicado (mesma key)" }, "422": { description: "payload grande/inválido" } },
      },
      get: {
        summary: "Polling de pendentes",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ jobs }" } },
      },
    },
    "/print-agent/jobs/{id}": {
      get: {
        summary: "Status do job",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ job }" }, "404": { description: "não existe" } },
      },
      patch: {
        summary: "Reportar transição (agente)",
        security: [{ bearer: [] }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["received", "printing", "completed", "failed", "pending"] }, errorMessage: { type: "string" } } } } } },
        responses: { "200": { description: "{ job }" }, "404": { description: "não existe" }, "409": { description: "race benigna" }, "422": { description: "transição inválida" } },
      },
    },
    "/print-agent/jobs/{id}/claim": {
      post: {
        summary: "Reivindicar job (atômico)",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ job }" }, "404": { description: "não existe" }, "409": { description: "já reivindicado" } },
      },
    },
    "/print-agent/agents": {
      get: {
        summary: "Listar lojas (owner)",
        security: [{ setupKey: [] }],
        responses: { "200": { description: "{ agents }" }, "403": { description: "forbidden" } },
      },
    },
    "/print-agent/agents/{id}": {
      delete: {
        summary: "Revogar loja (owner)",
        security: [{ setupKey: [] }],
        responses: { "204": { description: "revogado" }, "404": { description: "não existe" } },
      },
    },
    "/print-agent/jobs/recent": {
      get: {
        summary: "Últimos jobs p/ painel (owner, sem payload)",
        security: [{ setupKey: [] }],
        responses: { "200": { description: "{ jobs }" } },
      },
    },
    "/print-agent/printers/all": {
      get: {
        summary: "Todas impressoras + loja (owner, painel)",
        security: [{ setupKey: [] }],
        responses: { "200": { description: "{ printers }" } },
      },
    },
    "/print-agent/printers/sync": {
      post: {
        summary: "Heartbeat: sobe lista + default do Windows",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ ok, synced }" } },
      },
    },
    "/print-agent/printers": {
      get: {
        summary: "Impressoras com derivedStatus (offline após 90s sem heartbeat)",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ printers }" } },
      },
    },
    "/print-agent/webhooks": {
      post: {
        summary: "Assinar eventos de status",
        security: [{ bearer: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
        responses: { "201": { description: "webhook com secret (única exibição)" }, "422": { description: "url deve ser https" } },
      },
      get: {
        summary: "Listar webhooks (sem secrets)",
        security: [{ bearer: [] }],
        responses: { "200": { description: "{ webhooks }" } },
      },
    },
    "/print-agent/webhooks/{id}": {
      delete: {
        summary: "Remover webhook",
        security: [{ bearer: [] }],
        responses: { "204": { description: "removido" }, "404": { description: "não existe" } },
      },
    },
  },
} as const;
