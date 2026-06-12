# SETTE Isaque Loop v2 — sem npm

Esta versão não possui dependências externas e implementa o ciclo:

```text
Cliente -> OPA -> API -> IA -> API -> OPA -> cliente
```

## Melhorias desta versão

- recebe a mensagem real do cliente;
- mantém contexto temporário por `customerServiceId`;
- no modo OpenAI, aceita e devolve `response_id` para continuidade;
- impede processamento de mensagens que não sejam do cliente;
- evita duplicidade quando `messageId` é enviado;
- processa mensagens do mesmo atendimento em ordem;
- possui rota para limpar o contexto;
- inclui modo `mock` para testar o loop sem chave da OpenAI;
- fixa Node 24 no Render.

## 1. Executar localmente

```bash
cp .env.example .env
node --env-file=.env server.mjs
```

## 2. Health

```bash
curl http://localhost:3000/health
```

## 3. Testar o loop sem chave da OpenAI

O `.env.example` usa `AI_MODE=mock`.

Primeira mensagem:

```bash
curl -X POST http://localhost:3000/api/isaque/responder \
  -H "Content-Type: application/json" \
  -d '{
    "customerServiceId":"atendimento-123",
    "messageId":"msg-001",
    "sender":"customer",
    "message":"Minha internet caiu"
  }'
```

Segunda mensagem, usando o mesmo `customerServiceId`:

```bash
curl -X POST http://localhost:3000/api/isaque/responder \
  -H "Content-Type: application/json" \
  -d '{
    "customerServiceId":"atendimento-123",
    "messageId":"msg-002",
    "sender":"customer",
    "message":"Sim, tem luzes acesas"
  }'
```

A segunda resposta utiliza o contexto da primeira.

## 4. Ativar a IA real

No Render ou no `.env`:

```env
AI_MODE=openai
OPENAI_API_KEY=sua_chave
OPENAI_MODEL=gpt-4.1-mini
```

No modo OpenAI, a API devolve `response_id`. O OPA pode enviar esse valor como `previousResponseId` no turno seguinte. Se ele não for enviado, a API também mantém uma memória temporária pelo `customerServiceId` enquanto a instância estiver ativa.

## 5. Body recomendado no OPA

```json
{
  "customerServiceId": "{{id_atendimento}}",
  "messageId": "{{id_mensagem}}",
  "sender": "customer",
  "message": "{{mensagem_atual_cliente}}",
  "previousResponseId": "{{retorno_api.response_id}}"
}
```

Os nomes das variáveis são exemplos. Use os nomes reais disponibilizados no fluxo da OPA.

Na primeira mensagem, `previousResponseId` pode estar vazio. A API ignora valores vazios e placeholders não resolvidos.

## 6. Output da ferramenta no OPA

Use o formato que já foi validado:

```json
{
  "retorno_api": "data"
}
```

Depois envie ao cliente somente:

```text
retorno_api.reply
```

Não envie o objeto JSON completo.

## 7. Resposta da API

```json
{
  "success": true,
  "reply": "*Isaque:*\n\nEntendi...",
  "response_id": "resp_...",
  "customer_service_id": "atendimento-123",
  "message_id": "msg-001",
  "duplicate": false,
  "ai_mode": "openai"
}
```

## 8. Resetar o contexto

```bash
curl -X POST http://localhost:3000/api/isaque/reset \
  -H "Content-Type: application/json" \
  -d '{"customerServiceId":"atendimento-123"}'
```

## 9. Segurança

No Render, configure `API_TEST_KEY` com um valor secreto. No App HTTP da OPA, envie:

```json
{
  "Content-Type": "application/json",
  "X-API-Key": "MESMO_VALOR_CONFIGURADO_NO_RENDER"
}
```

Nunca coloque `OPENAI_API_KEY` no fluxo da OPA ou no GitHub.

## Limitação do protótipo

A memória interna do servidor é temporária e pode ser perdida quando o Render reiniciar. Para produção, use PostgreSQL ou Redis para idempotência, filas e estado operacional. No modo OpenAI, reenviar `response_id` pelo OPA reduz essa dependência.


# Prova de conceito de variáveis do OPA

Use esta rota para descobrir exatamente o que o construtor de fluxo consegue enviar:

```http
POST /api/opa/diagnostico
```

Exemplo de Body para o teste:

```json
{
  "controle_literal": "chegou-no-endpoint",
  "mensagem_candidata": "{{VARIAVEL_ESCOLHIDA_NO_OPA}}",
  "customer_service_id_candidato": "{{VARIAVEL_ESCOLHIDA_NO_OPA}}",
  "id_rota_candidato": "{{VARIAVEL_ESCOLHIDA_NO_OPA}}",
  "message_id_candidato": "{{VARIAVEL_ESCOLHIDA_NO_OPA}}",
  "protocolo_candidato": "{{VARIAVEL_ESCOLHIDA_NO_OPA}}"
}
```

Não digite nomes aleatórios quando o OPA oferecer um seletor de variáveis. Insira cada variável pela interface da plataforma.

A resposta contém:

- `diagnostic.flattened`: tudo que chegou à API;
- `diagnostic.resolved_fields`: valores realmente substituídos pelo OPA;
- `diagnostic.unresolved_placeholders`: placeholders que chegaram literalmente;
- `diagnostic.detected_candidates`: possíveis mensagem, atendimento e ID de mensagem;
- `diagnostic.conclusions`: conclusão objetiva do teste.

Output recomendado no OPA:

```json
{
  "retorno_api": "data"
}
```

Durante esta prova, envie ou exiba o objeto `retorno_api` completo no ambiente de teste. Não use esse comportamento com clientes reais.

## Teste por curl

```bash
curl -X POST https://SEU-SERVICO.onrender.com/api/opa/diagnostico \
  -H "Content-Type: application/json" \
  -d '{
    "controle_literal":"chegou",
    "mensagem_candidata":"Minha internet caiu",
    "id_rota_candidato":"rota-123",
    "message_id_candidato":"msg-456"
  }'
```


# Rota simplificada para o OPA

```http
POST /api/opa/responder
```

Body mínimo:

```json
{
  "mensagem_cliente": "minha internet caiu"
}
```

Retorno mínimo:

```json
{
  "success": true,
  "reply": "*Isaque:*\n\nEntendi 😊 O equipamento da internet está conectado à energia e com alguma luz acesa? 💙"
}
```

A rota também aceita os campos `message`, `mensagem`, `mensagem_candidata`, `text` e `texto`.
