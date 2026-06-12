# CONFIGURAÇÃO OPA — ROTA DE RESPOSTA

## Endpoint

Use a mesma URL base já cadastrada no App HTTP:

```text
https://sette-isaque-poc.onrender.com/api/
```

Na ferramenta:

```text
Endpoint: opa/responder
Método: POST
```

## Header

```json
{
  "Content-Type": "application/json"
}
```

## Body mínimo

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}"
}
```

A variável `{{mensagem_cliente}}` deve ser preenchida no fluxo com a mensagem atual do cliente antes da ferramenta ser executada.

## Body com memória, quando houver um identificador confirmado

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}",
  "conversation_id": "{{IDENTIFICADOR_ESTAVEL_CONFIRMADO}}"
}
```

O campo `conversation_id` é opcional. Enquanto nenhum identificador estável do atendimento for confirmado, use somente `mensagem_cliente`.

## Output

```json
{
  "retorno_api": "data"
}
```

## Retorno da API

```json
{
  "success": true,
  "reply": "*Isaque:*\n\nEntendi 😊 O equipamento da internet está conectado à energia e com alguma luz acesa? 💙"
}
```

## Instrução depois da ferramenta

Após a ferramenta retornar, analise o objeto `retorno_api`.

Se `retorno_api.success` for igual a `true` e `retorno_api.reply` estiver preenchido, envie ao cliente somente o conteúdo de `retorno_api.reply`.

Não envie o JSON completo, nomes de campos ou informações técnicas.

Se `reply` estiver vazio ou se `success` não for `true`, não invente uma resposta.

## Modos da API

### Teste sem IA externa

No Render:

```text
AI_MODE=mock
```

A API responde usando regras locais de protótipo.

### IA externa

No Render:

```text
AI_MODE=openai
OPENAI_API_KEY=chave_da_empresa
OPENAI_MODEL=modelo_configurado_pela_empresa
```

A chave deve existir apenas no Render.

## Teste por curl

```bash
curl -X POST https://sette-isaque-poc.onrender.com/api/opa/responder \
  -H "Content-Type: application/json" \
  -d '{"mensagem_cliente":"minha internet caiu"}'
```

Resposta esperada no modo mock:

```json
{
  "success": true,
  "reply": "*Isaque:*\n\nEntendi 😊 O equipamento da internet está conectado à energia e com alguma luz acesa? 💙"
}
```
