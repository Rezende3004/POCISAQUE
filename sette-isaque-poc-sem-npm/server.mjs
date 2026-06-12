import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 3000);
const API_TEST_KEY = process.env.API_TEST_KEY?.trim() || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000);
const MAX_BODY_BYTES = 1_000_000;

const ISAQUE_INSTRUCTIONS = `
Você é Isaque, do suporte técnico da SETTE Fibra.

Analise somente a mensagem atual do cliente e responda de forma breve, humana e acolhedora.

Neste teste, identifique apenas uma destas situações:
1. Cliente sem conexão com a internet;
2. Cliente com lentidão na internet;
3. Cliente solicitou mudança da senha do Wi-Fi;
4. Cliente solicitou suporte relacionado ao SETTE Play;
5. Mensagem ambígua.

Regras:
- Comece a mensagem com "*Isaque:*";
- Faça apenas uma pergunta por vez;
- Não diga que é inteligência artificial, assistente ou robô;
- Não invente informações;
- Não mencione APIs, sistemas ou ferramentas;
- Não faça diagnóstico definitivo;
- Use emojis com moderação.

Respostas esperadas:
- Sem conexão: pergunte se o equipamento está conectado à energia e com alguma luz acesa.
- Lentidão: pergunte se acontece em todos os aparelhos ou apenas em um.
- Mudança de senha: confirme se é a senha da rede Wi-Fi.
- SETTE Play: pergunte se é primeiro acesso ou se já utilizava e não consegue acessar.
- Ambígua: peça que explique um pouco melhor.
`.trim();

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

async function askOpenAI(message) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY_NOT_CONFIGURED");
    error.code = "OPENAI_API_KEY_NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: ISAQUE_INSTRUCTIONS,
        input: message,
        max_output_tokens: 180
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message ||
        `A OpenAI respondeu com HTTP ${response.status}.`;

      const error = new Error(detail);
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

    return reply;
  } finally {
    clearTimeout(timeout);
  }
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
      service: "sette-isaque-poc-sem-npm",
      openai_configured: Boolean(OPENAI_API_KEY)
    });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      success: false,
      code: "UNAUTHORIZED",
      message: "Chave de acesso inválida."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/teste-opa") {
    try {
      const body = await readJsonBody(req);

      return sendJson(res, 200, {
        success: true,
        reply: "Mensagem recebida pela API externa com sucesso.",
        received_message:
          typeof body.message === "string" ? body.message : null
      });
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE") {
        return sendJson(res, 413, {
          success: false,
          code: "BODY_TOO_LARGE",
          message: "O corpo da requisição excedeu o limite permitido."
        });
      }

      return sendJson(res, 400, {
        success: false,
        code: "INVALID_JSON",
        message: "O corpo enviado não é um JSON válido."
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/isaque/responder") {
    try {
      const body = await readJsonBody(req);
      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      if (!message) {
        return sendJson(res, 400, {
          success: false,
          code: "MESSAGE_REQUIRED",
          message: 'Envie o campo "message" com a mensagem do cliente.'
        });
      }

      const reply = await askOpenAI(message);

      return sendJson(res, 200, {
        success: true,
        reply
      });
    } catch (error) {
      if (error.name === "AbortError") {
        return sendJson(res, 504, {
          success: false,
          code: "OPENAI_TIMEOUT",
          message: "A IA demorou mais que o limite configurado."
        });
      }

      if (error.code === "OPENAI_API_KEY_NOT_CONFIGURED") {
        return sendJson(res, 503, {
          success: false,
          code: error.code,
          message: "A chave da OpenAI ainda não foi configurada no servidor."
        });
      }

      if (error.code === "BODY_TOO_LARGE") {
        return sendJson(res, 413, {
          success: false,
          code: error.code,
          message: "O corpo da requisição excedeu o limite permitido."
        });
      }

      if (error.code === "INVALID_JSON") {
        return sendJson(res, 400, {
          success: false,
          code: error.code,
          message: "O corpo enviado não é um JSON válido."
        });
      }

      console.error("Erro ao gerar resposta:", error);

      return sendJson(res, 502, {
        success: false,
        code: error.code || "AI_REQUEST_ERROR",
        message: "Não foi possível gerar a resposta da IA neste momento."
      });
    }
  }

  return sendJson(res, 404, {
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Rota não encontrada."
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Prova de conceito do Isaque rodando na porta ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Teste fixo: POST http://localhost:${PORT}/api/teste-opa`);
  console.log(`Teste com IA: POST http://localhost:${PORT}/api/isaque/responder`);
});
