import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.PORT || 3000);
const API_TEST_KEY = process.env.API_TEST_KEY?.trim() || "";
const AI_MODE = (process.env.AI_MODE?.trim().toLowerCase() || "mock");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 220);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1_000_000);
const STATE_TTL_MS = Number(process.env.STATE_TTL_MS || 21_600_000); // 6 horas
const IDEMPOTENCY_TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 86_400_000); // 24 horas
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 120);

const OPA_BASE_URL = (process.env.OPA_BASE_URL?.trim() || "").replace(/\/+$/, "");
const OPA_API_TOKEN = process.env.OPA_API_TOKEN?.trim() || "";
const OPA_DELIVERY_MODE = (
  process.env.OPA_DELIVERY_MODE?.trim().toLowerCase() || "mock"
);
const OPA_TIMEOUT_MS = Number(process.env.OPA_TIMEOUT_MS || 15_000);
const OPA_DEFAULT_TEST_MESSAGE =
  process.env.OPA_DEFAULT_TEST_MESSAGE?.trim() ||
  "Mensagem de teste enviada diretamente pela API externa do Isaque.";

const ISAQUE_INSTRUCTIONS = `
Você é Isaque, do suporte técnico da SETTE Fibra.

Converse de forma humana, breve, acolhedora e profissional.

Escopo deste protótipo:
1. Cliente sem conexão com a internet;
2. Cliente com lentidão na internet;
3. Cliente solicitando mudança da senha do Wi-Fi;
4. Cliente solicitando suporte relacionado ao SETTE Play;
5. Mensagem ambígua ou fora do escopo.

Regras obrigatórias:
- Comece a resposta com "*Isaque:*";
- Faça somente uma pergunta ou orientação por vez;
- Aproveite o contexto dos turnos anteriores;
- Não diga que é inteligência artificial, assistente, robô ou sistema;
- Não mencione APIs, ferramentas, variáveis ou sistemas internos;
- Não invente informações, diagnósticos, retornos técnicos ou procedimentos;
- Não afirme a causa do problema sem confirmação;
- Use emojis com moderação;
- Responda somente com a mensagem que será enviada ao cliente.

Primeira orientação por categoria:
- Sem conexão: pergunte se o equipamento está conectado à energia e com alguma luz acesa.
- Lentidão: pergunte se acontece em todos os aparelhos ou apenas em um.
- Mudança de senha: confirme se a solicitação é para a senha da rede Wi-Fi.
- SETTE Play: pergunte se é primeiro acesso ou se o cliente já utilizava e agora não consegue acessar.
- Ambígua: peça que o cliente explique um pouco melhor.
`.trim();

const conversationStates = new Map();
const processedMessages = new Map();
const conversationQueues = new Map();
const rateLimits = new Map();

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-API-Key");
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  if (!API_TEST_KEY) return true;
  return req.headers["x-api-key"] === API_TEST_KEY;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  if (!Number.isFinite(RATE_LIMIT_PER_MINUTE) || RATE_LIMIT_PER_MINUTE <= 0) {
    return false;
  }

  const key = clientIp(req);
  const now = Date.now();
  const current = rateLimits.get(key);

  if (!current || now - current.startedAt >= 60_000) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_PER_MINUTE;
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];

  for await (const chunk of req) {
    total += chunk.length;

    if (total > MAX_BODY_BYTES) {
      const error = new Error("BODY_TOO_LARGE");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("INVALID_JSON");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function cleanString(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  if (!cleaned || /^\{\{.*\}\}$/.test(cleaned)) return "";
  return cleaned.slice(0, maxLength);
}

function cleanMessage(value) {
  return cleanString(value, 8_000);
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function positiveAnswer(text) {
  return /\b(sim|s|claro|certo|correto|isso|tem|esta|estao|acesa|acesas|ligado|ligada)\b/.test(text);
}

function negativeAnswer(text) {
  return /\b(nao|n|nenhuma|apagado|apagada|desligado|desligada|sem luz)\b/.test(text);
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}


function opaConfigured() {
  return Boolean(OPA_BASE_URL && OPA_API_TOKEN);
}

function opaHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${OPA_API_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra
  };
}

function requestJson(method, targetUrl, body = undefined, headers = {}) {
  return new Promise((resolve, reject) => {
    let url;

    try {
      url = new URL(targetUrl);
    } catch {
      const error = new Error("OPA_INVALID_BASE_URL");
      error.code = "OPA_INVALID_BASE_URL";
      reject(error);
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    const payload =
      body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");

    const requestHeaders = {
      ...headers
    };

    if (payload) {
      requestHeaders["Content-Length"] = String(payload.length);
    }

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders,
        timeout: OPA_TIMEOUT_MS
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8").trim();
          let data = {};

          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = { raw };
            }
          }

          resolve({
            ok:
              response.statusCode !== undefined &&
              response.statusCode >= 200 &&
              response.statusCode < 300,
            status: response.statusCode || 0,
            data
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      const error = new Error("OPA_REQUEST_TIMEOUT");
      error.code = "OPA_REQUEST_TIMEOUT";
      reject(error);
    });

    request.on("error", (cause) => {
      if (cause?.code === "OPA_REQUEST_TIMEOUT") {
        reject(cause);
        return;
      }

      const error = new Error(cause?.message || "OPA_NETWORK_ERROR");
      error.code = "OPA_NETWORK_ERROR";
      error.cause = cause;
      reject(error);
    });

    if (payload) request.write(payload);
    request.end();
  });
}

async function opaRequest(method, path, body = undefined) {
  if (!opaConfigured()) {
    const error = new Error("OPA_NOT_CONFIGURED");
    error.code = "OPA_NOT_CONFIGURED";
    throw error;
  }

  const response = await requestJson(
    method,
    `${OPA_BASE_URL}${path}`,
    body,
    opaHeaders()
  );

  if (!response.ok) {
    const detail =
      response.data?.message ||
      response.data?.error ||
      response.data?.status ||
      `HTTP ${response.status}`;

    const error = new Error(String(detail));
    error.code = "OPA_REQUEST_FAILED";
    error.httpStatus = response.status;
    error.opaResponse = response.data;
    throw error;
  }

  return response.data;
}

function getOpaCustomerServiceId(body) {
  return (
    cleanString(body.opa_customer_service_id, 200) ||
    cleanString(body.opaCustomerServiceId, 200) ||
    cleanString(body.customerServiceId, 200) ||
    cleanString(body.id_rota, 200) ||
    cleanString(body.opa_atendimento_id, 200) ||
    ""
  );
}

function getOpaProtocol(body) {
  return (
    cleanString(body.opa_protocolo, 200) ||
    cleanString(body.opaProtocol, 200) ||
    cleanString(body.protocolo, 200) ||
    ""
  );
}

async function findOpaAttendanceByProtocol(protocol) {
  const response = await opaRequest("GET", "/api/v1/atendimento", {
    filter: { protocolo: protocol },
    options: { limit: 2 }
  });

  const records = Array.isArray(response?.data) ? response.data : [];
  const exactMatches = records.filter(
    (item) => cleanString(item?.protocolo, 200) === protocol
  );

  if (exactMatches.length === 0) {
    const error = new Error("OPA_ATTENDANCE_NOT_FOUND");
    error.code = "OPA_ATTENDANCE_NOT_FOUND";
    throw error;
  }

  if (exactMatches.length > 1) {
    const error = new Error("OPA_ATTENDANCE_AMBIGUOUS");
    error.code = "OPA_ATTENDANCE_AMBIGUOUS";
    throw error;
  }

  const record = exactMatches[0];
  const customerServiceId = cleanString(record?._id, 200);

  if (!customerServiceId) {
    const error = new Error("OPA_ATTENDANCE_WITHOUT_ID");
    error.code = "OPA_ATTENDANCE_WITHOUT_ID";
    throw error;
  }

  return {
    customerServiceId,
    protocol: cleanString(record?.protocolo, 200),
    status: cleanString(record?.status, 50),
    channel: cleanString(record?.canal, 100)
  };
}

async function resolveOpaAttendance(body) {
  const directId = getOpaCustomerServiceId(body);

  if (directId) {
    return {
      customerServiceId: directId,
      protocol: getOpaProtocol(body) || null,
      status: null,
      channel: null,
      source: "request"
    };
  }

  const protocol = getOpaProtocol(body);

  if (!protocol) {
    const error = new Error("OPA_ATTENDANCE_REFERENCE_REQUIRED");
    error.code = "OPA_ATTENDANCE_REFERENCE_REQUIRED";
    throw error;
  }

  const found = await findOpaAttendanceByProtocol(protocol);
  return {
    ...found,
    source: "protocol_lookup"
  };
}

async function sendOpaText(customerServiceId, text) {
  const response = await opaRequest(
    "POST",
    "/api/v1/atendimento/mensagem/send",
    {
      customerServiceId,
      content: {
        type: "text",
        text
      }
    }
  );

  const success =
    response?.status === "success" &&
    Number(response?.code) >= 200 &&
    Number(response?.code) < 300;

  if (!success) {
    const error = new Error("OPA_SEND_NOT_CONFIRMED");
    error.code = "OPA_SEND_NOT_CONFIRMED";
    error.opaResponse = response;
    throw error;
  }

  return {
    opaMessageId:
      typeof response?.data === "string"
        ? response.data
        : cleanString(response?.data?._id, 200) || null,
    rawStatus: response?.status || null,
    rawCode: response?.code || null
  };
}

async function deliverOpaText(body, text) {
  const attendance = await resolveOpaAttendance(body);

  if (OPA_DELIVERY_MODE !== "opa") {
    return {
      mode: "mock",
      sent: false,
      simulated: true,
      customer_service_id: attendance.customerServiceId,
      protocol: attendance.protocol,
      attendance_source: attendance.source,
      opa_message_id: null,
      text_preview: text
    };
  }

  const sent = await sendOpaText(attendance.customerServiceId, text);

  return {
    mode: "opa",
    sent: true,
    simulated: false,
    customer_service_id: attendance.customerServiceId,
    protocol: attendance.protocol,
    attendance_source: attendance.source,
    opa_message_id: sent.opaMessageId,
    opa_status: sent.rawStatus,
    opa_code: sent.rawCode
  };
}

async function openAIRequest(message, previousResponseId = "") {
  if (!OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY_NOT_CONFIGURED");
    error.code = "OPENAI_API_KEY_NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const requestBody = {
      model: OPENAI_MODEL,
      instructions: ISAQUE_INSTRUCTIONS,
      input: [{ role: "user", content: message }],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: true
    };

    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        data?.error?.message || `A OpenAI respondeu com HTTP ${response.status}.`
      );
      error.code = "OPENAI_REQUEST_FAILED";
      error.httpStatus = response.status;
      throw error;
    }

    const reply = extractResponseText(data);
    if (!reply) {
      const error = new Error("EMPTY_MODEL_RESPONSE");
      error.code = "EMPTY_MODEL_RESPONSE";
      throw error;
    }

    return {
      reply,
      responseId: cleanString(data?.id, 200),
      model: cleanString(data?.model, 100) || OPENAI_MODEL
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function askOpenAI(message, previousResponseId = "") {
  try {
    const result = await openAIRequest(message, previousResponseId);
    return { ...result, contextReset: false };
  } catch (error) {
    // Caso um ID antigo ou inválido seja enviado, inicia uma nova cadeia uma única vez.
    if (previousResponseId && error.code === "OPENAI_REQUEST_FAILED" && error.httpStatus === 400) {
      const result = await openAIRequest(message, "");
      return { ...result, contextReset: true };
    }
    throw error;
  }
}

function classifyInitialMessage(text) {
  if (/sem internet|sem conexao|internet caiu|nao conecta|nao funciona|wifi sem internet/.test(text)) {
    return "sem_conexao";
  }
  if (/lent|travando|demora|velocidade|lag|ping/.test(text)) {
    return "lentidao";
  }
  if (/senha|password|trocar.*wifi|mudar.*wifi/.test(text)) {
    return "senha_wifi";
  }
  if (/sette play|streaming|primeiro acesso|ativar.*play|login.*play/.test(text)) {
    return "sette_play";
  }
  return "ambiguo";
}

function mockAI(message, currentStage = "") {
  const text = normalizeText(message);
  let stage = currentStage;
  let reply = "";

  if (stage === "awaiting_power") {
    if (positiveAnswer(text)) {
      stage = "awaiting_lights_photo";
      reply = "*Isaque:*\n\nPerfeito 😊 Pode me enviar uma foto mostrando as luzes do equipamento, por favor? 💙";
    } else if (negativeAnswer(text)) {
      stage = "awaiting_outlet_type";
      reply = "*Isaque:*\n\nEntendi 😊 O equipamento está ligado diretamente na tomada ou está usando extensão, adaptador ou ‘T’? 💙";
    } else {
      reply = "*Isaque:*\n\nSó para eu confirmar 😊 O equipamento está ligado e possui alguma luz acesa? 💙";
    }
    return { reply, stage, category: "sem_conexao" };
  }

  if (stage === "awaiting_scope") {
    if (/todos|varios|tudo|mais de um/.test(text)) {
      stage = "awaiting_router_position";
      reply = "*Isaque:*\n\nEntendi 😊 Pode me enviar uma foto mostrando onde o equipamento está instalado? 💙";
    } else if (/um|apenas|somente|celular|tv|computador|notebook/.test(text)) {
      stage = "awaiting_device_name";
      reply = "*Isaque:*\n\nQual aparelho está apresentando lentidão? 😊";
    } else {
      reply = "*Isaque:*\n\nA lentidão acontece em todos os aparelhos conectados ou apenas em um deles? 😊";
    }
    return { reply, stage, category: "lentidao" };
  }

  if (stage === "awaiting_password_confirmation") {
    if (positiveAnswer(text)) {
      stage = "awaiting_new_password";
      reply = "*Isaque:*\n\nPerfeito 😊 Qual nova senha você deseja utilizar? Ela precisa ter pelo menos 8 caracteres.";
    } else if (negativeAnswer(text)) {
      stage = "awaiting_clarification";
      reply = "*Isaque:*\n\nEntendi 😊 Pode me dizer qual senha você precisa alterar? 💙";
    } else {
      reply = "*Isaque:*\n\nSó para confirmar: você deseja alterar a senha da sua rede Wi-Fi, certo? 😊";
    }
    return { reply, stage, category: "senha_wifi" };
  }

  if (stage === "awaiting_play_access_type") {
    if (/primeiro|ativar|ativacao|nunca usei/.test(text)) {
      stage = "awaiting_play_product";
      reply = "*Isaque:*\n\nQual streaming ou produto do SETTE Play você deseja ativar? 😊";
    } else if (/ja usava|ja utilizei|nao consigo|erro|parou/.test(text)) {
      stage = "awaiting_play_error";
      reply = "*Isaque:*\n\nEntendi 😊 Qual mensagem ou erro aparece quando você tenta acessar?";
    } else {
      reply = "*Isaque:*\n\nVocê está tentando fazer o primeiro acesso ou já utilizava o serviço e agora não consegue acessar? 😊";
    }
    return { reply, stage, category: "sette_play" };
  }

  if (stage === "awaiting_clarification") {
    const category = classifyInitialMessage(text);
    if (category === "ambiguo") {
      return {
        reply: "*Isaque:*\n\nAinda não consegui identificar sua solicitação com segurança 💙 Vou encaminhar seu atendimento para nossa equipe dar continuidade, tá bom? 😊",
        stage: "handoff",
        category
      };
    }
    stage = "";
  }

  const category = classifyInitialMessage(text);

  if (category === "sem_conexao") {
    return {
      reply: "*Isaque:*\n\nEntendi 😊 O equipamento da internet está conectado à energia e com alguma luz acesa? 💙",
      stage: "awaiting_power",
      category
    };
  }

  if (category === "lentidao") {
    return {
      reply: "*Isaque:*\n\nEntendi 😊 A lentidão acontece em todos os aparelhos conectados ou apenas em um deles? 💙",
      stage: "awaiting_scope",
      category
    };
  }

  if (category === "senha_wifi") {
    return {
      reply: "*Isaque:*\n\nSó para confirmar: você deseja alterar a senha da sua rede Wi-Fi, certo? 😊",
      stage: "awaiting_password_confirmation",
      category
    };
  }

  if (category === "sette_play") {
    return {
      reply: "*Isaque:*\n\nVocê está tentando fazer o primeiro acesso ou já utilizava o serviço e agora não consegue acessar? 😊",
      stage: "awaiting_play_access_type",
      category
    };
  }

  return {
    reply: "*Isaque:*\n\nEntendi 😊 Pode me explicar um pouco melhor o que está acontecendo? Por exemplo: você está sem conexão, com lentidão, precisa alterar a senha do Wi-Fi ou está com algum problema no SETTE Play? 💙",
    stage: "awaiting_clarification",
    category: "ambiguo"
  };
}


function isUnresolvedPlaceholder(value) {
  return typeof value === "string" && /\{\{[^{}]+\}\}/.test(value);
}

function flattenObject(value, prefix = "", output = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenObject(item, path, output);
    });
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenObject(item, path, output);
    }
    return output;
  }

  output[prefix || "(raiz)"] = value;
  return output;
}

function firstResolvedCandidate(flattened, patterns) {
  for (const [path, value] of Object.entries(flattened)) {
    if (!patterns.some((pattern) => pattern.test(path))) continue;
    if (value === null || value === undefined || value === "") continue;
    if (isUnresolvedPlaceholder(value)) continue;
    return { path, value };
  }
  return null;
}

function buildOpaDiagnostic(body) {
  const flattened = flattenObject(body);
  const unresolved = [];
  const resolved = [];
  const empty = [];

  for (const [path, value] of Object.entries(flattened)) {
    if (isUnresolvedPlaceholder(value)) {
      unresolved.push({ path, value });
    } else if (value === null || value === undefined || value === "") {
      empty.push(path);
    } else {
      resolved.push({ path, value });
    }
  }

  const candidates = {
    message: firstResolvedCandidate(flattened, [
      /(^|\.)(message|mensagem|texto|text|content|conteudo)$/i,
      /(ultima|last|current|atual).*(message|mensagem|texto)/i,
      /(message|mensagem|texto).*(cliente|customer|user)/i
    ]),
    customer_service_id: firstResolvedCandidate(flattened, [
      /customer.?service.?id/i,
      /(^|\.)(id_rota|id_atendimento|atendimento_id|customer_service_id)$/i,
      /(^|\.)(protocolo)$/i
    ]),
    message_id: firstResolvedCandidate(flattened, [
      /(^|\.)(message_id|messageId|id_mensagem|mensagem_id)$/i,
      /(^|\.)(_id)$/i
    ]),
    customer_id: firstResolvedCandidate(flattened, [
      /(^|\.)(customer_id|customerId|id_cliente|cliente_id)$/i
    ]),
    channel: firstResolvedCandidate(flattened, [
      /(^|\.)(channel|canal|canal_id|canalCliente|canal_cliente)$/i
    ])
  };

  return {
    received_keys: Object.keys(body),
    flattened,
    resolved_fields: resolved,
    unresolved_placeholders: unresolved,
    empty_fields: empty,
    detected_candidates: candidates,
    conclusions: {
      body_arrived: true,
      has_resolved_message: Boolean(candidates.message),
      has_stable_conversation_candidate: Boolean(candidates.customer_service_id),
      has_message_id_candidate: Boolean(candidates.message_id),
      all_values_are_placeholders:
        resolved.length === 0 && unresolved.length > 0
    }
  };
}

function getIncomingMessage(body) {
  return (
    cleanMessage(body.message) ||
    cleanMessage(body.mensagem_cliente) ||
    cleanMessage(body.mensagem) ||
    cleanMessage(body.mensagem_candidata) ||
    cleanMessage(body.text) ||
    cleanMessage(body.texto) ||
    ""
  );
}

function getConversationKey(body) {
  return (
    cleanString(body.conversationId, 200) ||
    cleanString(body.conversation_id, 200) ||
    cleanString(body.conversationKey, 200) ||
    cleanString(body.customer_service_id, 200) ||
    cleanString(body.idAtendimento, 200) ||
    cleanString(body.id_atendimento, 200) ||
    cleanString(body.atendimentoId, 200) ||
    cleanString(body.atendimento_id, 200) ||
    ""
  );
}

function getMessageId(body) {
  return (
    cleanString(body.messageId, 200) ||
    cleanString(body.message_id, 200) ||
    cleanString(body.id_mensagem, 200) ||
    cleanString(body.mensagem_id, 200) ||
    cleanString(body._id, 200) ||
    ""
  );
}

function getPreviousResponseId(body) {
  return (
    cleanString(body.previousResponseId, 200) ||
    cleanString(body.previous_response_id, 200)
  );
}

function runSerialized(key, task) {
  if (!key) return task();

  const previous = conversationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  conversationQueues.set(key, current);

  current.finally(() => {
    if (conversationQueues.get(key) === current) {
      conversationQueues.delete(key);
    }
  });

  return current;
}

function cleanupMemory() {
  const now = Date.now();

  for (const [key, state] of conversationStates) {
    if (now - state.updatedAt > STATE_TTL_MS) {
      conversationStates.delete(key);
    }
  }

  for (const [key, item] of processedMessages) {
    if (item.expiresAt <= now) {
      processedMessages.delete(key);
    }
  }

  for (const [key, item] of rateLimits) {
    if (now - item.startedAt > 120_000) {
      rateLimits.delete(key);
    }
  }
}

const cleanupTimer = setInterval(cleanupMemory, 300_000);
cleanupTimer.unref();

function bodyErrorResponse(error) {
  if (error.code === "BODY_TOO_LARGE") {
    return {
      status: 413,
      payload: {
        success: false,
        code: error.code,
        message: "O corpo da requisição excedeu o limite permitido."
      }
    };
  }

  return {
    status: 400,
    payload: {
      success: false,
      code: "INVALID_JSON",
      message: "O corpo enviado não é um JSON válido."
    }
  };
}


function minimalOpaResponse(payload) {
  return {
    success: payload.success === true,
    conversation_id:
      cleanString(payload.conversation_id, 200) ||
      cleanString(payload.customer_service_id, 200) ||
      null,
    conversation_created: payload.conversation_created === true,
    reply: typeof payload.reply === "string" ? payload.reply : null
  };
}

async function processIsaqueBody(body, minimal = false) {
  const message = getIncomingMessage(body);
  const sender =
    cleanString(body.sender, 50).toLowerCase() ||
    cleanString(body.remetente, 50).toLowerCase() ||
    "customer";
  const receivedConversationKey = getConversationKey(body);
  const messageId = getMessageId(body);
  const requestedPreviousResponseId = getPreviousResponseId(body);
  const reset = body.reset === true || body.reset === "true";

  if (!message) {
    return {
      status: 400,
      payload: {
        success: false,
        reply: null,
        code: "MESSAGE_REQUIRED",
        message:
          'Envie a mensagem em "message", "mensagem_cliente", "mensagem" ou "mensagem_candidata".'
      }
    };
  }

  const conversationKey = receivedConversationKey || randomUUID();
  const conversationCreated = !receivedConversationKey;

  if (sender !== "customer" && sender !== "client" && sender !== "cliente") {
    const ignored = {
      success: true,
      ignored: true,
      conversation_id: conversationKey,
      conversation_created: conversationCreated,
      reply: null,
      reason: "A mensagem não foi identificada como enviada pelo cliente.",
      sender
    };

    return {
      status: 200,
      payload: minimal ? minimalOpaResponse(ignored) : ignored
    };
  }

  if (messageId && processedMessages.has(messageId)) {
    const cached = processedMessages.get(messageId);
    const duplicate = {
      ...cached.response,
      duplicate: true
    };

    return {
      status: 200,
      payload: minimal ? minimalOpaResponse(duplicate) : duplicate
    };
  }

  const result = await runSerialized(conversationKey, async () => {
    if (reset && conversationKey) {
      conversationStates.delete(conversationKey);
    }

    const currentState = conversationKey
      ? conversationStates.get(conversationKey) || {}
      : {};

    if (AI_MODE === "openai") {
      const previousResponseId =
        requestedPreviousResponseId ||
        cleanString(currentState.previousResponseId, 200);

      const aiResult = await askOpenAI(message, previousResponseId);

      const response = {
        success: true,
        conversation_id: conversationKey,
        conversation_created: conversationCreated,
        reply: aiResult.reply,
        response_id: aiResult.responseId || null,
        customer_service_id: receivedConversationKey || null,
        message_id: messageId || null,
        duplicate: false,
        ai_mode: "openai",
        context_source: requestedPreviousResponseId
          ? "request"
          : previousResponseId
            ? "server_memory"
            : "new",
        context_reset: aiResult.contextReset,
        model: aiResult.model
      };

      if (conversationKey) {
        conversationStates.set(conversationKey, {
          previousResponseId: aiResult.responseId,
          updatedAt: Date.now()
        });
      }

      return response;
    }

    const mockResult = mockAI(
      message,
      cleanString(currentState.mockStage, 100)
    );

    const response = {
      success: true,
      conversation_id: conversationKey,
      conversation_created: conversationCreated,
      reply: mockResult.reply,
      response_id: null,
      customer_service_id: receivedConversationKey || null,
      message_id: messageId || null,
      duplicate: false,
      ai_mode: "mock",
      category: mockResult.category,
      stage: mockResult.stage,
      context_source: conversationKey ? "server_memory" : "stateless"
    };

    if (conversationKey) {
      conversationStates.set(conversationKey, {
        mockStage: mockResult.stage,
        updatedAt: Date.now()
      });
    }

    return response;
  });

  if (messageId) {
    processedMessages.set(messageId, {
      response: result,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
    });
  }

  return {
    status: 200,
    payload: minimal ? minimalOpaResponse(result) : result
  };
}


function opaErrorResponse(error) {
  const publicErrors = {
    OPA_NOT_CONFIGURED: {
      status: 503,
      message:
        "A integração oficial com o OPA ainda não foi configurada no servidor."
    },
    OPA_INVALID_BASE_URL: {
      status: 500,
      message: "A URL configurada para o OPA é inválida."
    },
    OPA_REQUEST_TIMEOUT: {
      status: 504,
      message: "O OPA não respondeu dentro do tempo limite."
    },
    OPA_NETWORK_ERROR: {
      status: 502,
      message: "Não foi possível conectar à API oficial do OPA."
    },
    OPA_REQUEST_FAILED: {
      status: 502,
      message: "A API oficial do OPA recusou ou não concluiu a requisição."
    },
    OPA_ATTENDANCE_REFERENCE_REQUIRED: {
      status: 400,
      message:
        "Envie opa_customer_service_id ou opa_protocolo para identificar o atendimento."
    },
    OPA_ATTENDANCE_NOT_FOUND: {
      status: 404,
      message: "Nenhum atendimento foi localizado com o protocolo informado."
    },
    OPA_ATTENDANCE_AMBIGUOUS: {
      status: 409,
      message:
        "Mais de um atendimento foi localizado e não foi possível selecionar com segurança."
    },
    OPA_ATTENDANCE_WITHOUT_ID: {
      status: 502,
      message: "O atendimento retornado pelo OPA não possui um ID válido."
    },
    OPA_SEND_NOT_CONFIRMED: {
      status: 502,
      message: "O OPA não confirmou o envio da mensagem."
    }
  };

  const selected = publicErrors[error?.code];

  if (selected) {
    return {
      status: selected.status,
      payload: {
        success: false,
        code: error.code,
        message: selected.message
      }
    };
  }

  console.error("Erro OPA não tratado:", {
    code: error?.code || "UNKNOWN",
    status: error?.httpStatus || null,
    message: error?.message
  });

  return {
    status: 500,
    payload: {
      success: false,
      code: error?.code || "OPA_UNKNOWN_ERROR",
      message: "Não foi possível concluir a integração com o OPA."
    }
  };
}

function isaqueErrorResponse(error) {
  if (error.name === "AbortError") {
    return {
      status: 504,
      payload: {
        success: false,
        reply: null,
        code: "OPENAI_TIMEOUT",
        message: "A IA demorou mais que o limite configurado."
      }
    };
  }

  if (error.code === "OPENAI_API_KEY_NOT_CONFIGURED") {
    return {
      status: 503,
      payload: {
        success: false,
        reply: null,
        code: error.code,
        message: "A chave da OpenAI ainda não foi configurada no servidor."
      }
    };
  }

  if (error.code === "BODY_TOO_LARGE" || error.code === "INVALID_JSON") {
    const response = bodyErrorResponse(error);
    return {
      status: response.status,
      payload: {
        ...response.payload,
        reply: null
      }
    };
  }

  console.error("Erro ao gerar resposta:", {
    code: error.code || "UNKNOWN",
    status: error.httpStatus || null,
    message: error.message
  });

  return {
    status: 502,
    payload: {
      success: false,
      reply: null,
      code: error.code || "AI_REQUEST_ERROR",
      message: "Não foi possível gerar a resposta da IA neste momento."
    }
  };
}

const server = createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "sette-isaque-loop-v6-externalizacao-opa",
      ai_mode: AI_MODE,
      openai_configured: Boolean(OPENAI_API_KEY),
      active_conversations: conversationStates.size,
      opa_delivery_mode: OPA_DELIVERY_MODE,
      opa_configured: opaConfigured()
    });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      success: false,
      code: "UNAUTHORIZED",
      message: "Chave de acesso inválida."
    });
  }

  if (isRateLimited(req)) {
    return sendJson(res, 429, {
      success: false,
      code: "RATE_LIMITED",
      message: "Muitas requisições em pouco tempo. Tente novamente em instantes."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/teste-opa") {
    try {
      const body = await readJsonBody(req);
      return sendJson(res, 200, {
        success: true,
        reply: "Mensagem recebida pela API externa com sucesso.",
        received_message: typeof body.message === "string" ? body.message : null
      });
    } catch (error) {
      const response = bodyErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }


  if (req.method === "POST" && url.pathname === "/api/opa/diagnostico") {
    try {
      const body = await readJsonBody(req);
      const diagnostic = buildOpaDiagnostic(body);

      console.log("OPA_DIAGNOSTICO", JSON.stringify({
        received_keys: diagnostic.received_keys,
        unresolved_placeholders: diagnostic.unresolved_placeholders,
        detected_candidates: diagnostic.detected_candidates,
        conclusions: diagnostic.conclusions
      }));

      return sendJson(res, 200, {
        success: true,
        reply: "Payload do OPA recebido e analisado com sucesso.",
        diagnostic
      });
    } catch (error) {
      const response = bodyErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }


  if (
    req.method === "POST" &&
    url.pathname === "/api/opa/resolver-atendimento"
  ) {
    try {
      const body = await readJsonBody(req);
      const attendance = await resolveOpaAttendance(body);

      return sendJson(res, 200, {
        success: true,
        customer_service_id: attendance.customerServiceId,
        protocol: attendance.protocol,
        status: attendance.status,
        channel: attendance.channel,
        source: attendance.source
      });
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE" || error.code === "INVALID_JSON") {
        const response = bodyErrorResponse(error);
        return sendJson(res, response.status, response.payload);
      }

      const response = opaErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/opa/testar-envio-direto"
  ) {
    try {
      const body = await readJsonBody(req);
      const text =
        cleanMessage(body.text) ||
        cleanMessage(body.mensagem) ||
        OPA_DEFAULT_TEST_MESSAGE;

      const delivery = await deliverOpaText(body, text);

      return sendJson(res, 200, {
        success: true,
        delivery
      });
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE" || error.code === "INVALID_JSON") {
        const response = bodyErrorResponse(error);
        return sendJson(res, response.status, response.payload);
      }

      const response = opaErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/opa/externalizar"
  ) {
    try {
      const body = await readJsonBody(req);

      // Primeiro valida/localiza o atendimento. Assim o contexto da IA não
      // avança quando não há como entregar a resposta.
      const attendance = await resolveOpaAttendance(body);

      const aiResult = await processIsaqueBody(body, false);

      if (aiResult.status < 200 || aiResult.status >= 300) {
        return sendJson(res, aiResult.status, aiResult.payload);
      }

      const reply = cleanMessage(aiResult.payload?.reply);

      if (!reply) {
        return sendJson(res, 502, {
          success: false,
          code: "EMPTY_GENERATED_REPLY",
          message: "A IA não retornou uma mensagem válida para envio."
        });
      }

      let delivery;

      if (OPA_DELIVERY_MODE === "opa") {
        const sent = await sendOpaText(attendance.customerServiceId, reply);
        delivery = {
          mode: "opa",
          sent: true,
          simulated: false,
          customer_service_id: attendance.customerServiceId,
          protocol: attendance.protocol,
          attendance_source: attendance.source,
          opa_message_id: sent.opaMessageId,
          opa_status: sent.rawStatus,
          opa_code: sent.rawCode
        };
      } else {
        delivery = {
          mode: "mock",
          sent: false,
          simulated: true,
          customer_service_id: attendance.customerServiceId,
          protocol: attendance.protocol,
          attendance_source: attendance.source,
          opa_message_id: null,
          text_preview: reply
        };
      }

      return sendJson(res, 200, {
        success: true,
        conversation_id: aiResult.payload.conversation_id,
        conversation_created:
          aiResult.payload.conversation_created === true,
        reply_dispatched: delivery.sent,
        delivery
      });
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE" || error.code === "INVALID_JSON") {
        const response = bodyErrorResponse(error);
        return sendJson(res, response.status, response.payload);
      }

      if (
        String(error?.code || "").startsWith("OPA_")
      ) {
        const response = opaErrorResponse(error);
        return sendJson(res, response.status, response.payload);
      }

      const response = isaqueErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/isaque/reset") {
    try {
      const body = await readJsonBody(req);
      const conversationKey = getConversationKey(body);

      if (!conversationKey) {
        return sendJson(res, 400, {
          success: false,
          code: "CUSTOMER_SERVICE_ID_REQUIRED",
          message: "Envie customerServiceId para limpar o contexto."
        });
      }

      conversationStates.delete(conversationKey);
      return sendJson(res, 200, {
        success: true,
        reset: true,
        customer_service_id: conversationKey
      });
    } catch (error) {
      const response = bodyErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/opa/responder") {
    try {
      const body = await readJsonBody(req);
      const result = await processIsaqueBody(body, true);
      return sendJson(res, result.status, result.payload);
    } catch (error) {
      const response = isaqueErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/isaque/responder") {
    try {
      const body = await readJsonBody(req);
      const result = await processIsaqueBody(body, false);
      return sendJson(res, result.status, result.payload);
    } catch (error) {
      const response = isaqueErrorResponse(error);
      return sendJson(res, response.status, response.payload);
    }
  }

  return sendJson(res, 404, {
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Rota não encontrada."
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SETTE Isaque Loop v6 rodando na porta ${PORT}`);
  console.log(`Modo de IA: ${AI_MODE}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Teste fixo: POST http://localhost:${PORT}/api/teste-opa`);
  console.log(`Diagnóstico OPA: POST http://localhost:${PORT}/api/opa/diagnostico`);
  console.log(`Resposta simples OPA: POST http://localhost:${PORT}/api/opa/responder`);
  console.log(`Resolver atendimento: POST http://localhost:${PORT}/api/opa/resolver-atendimento`);
  console.log(`Teste envio direto: POST http://localhost:${PORT}/api/opa/testar-envio-direto`);
  console.log(`Externalizar: POST http://localhost:${PORT}/api/opa/externalizar`);
  console.log(`Responder: POST http://localhost:${PORT}/api/isaque/responder`);
  console.log(`Reset: POST http://localhost:${PORT}/api/isaque/reset`);
});
