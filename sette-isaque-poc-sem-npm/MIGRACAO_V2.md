# Migração rápida para a versão Loop v2

## Atualizar o GitHub

Substitua os arquivos atuais pelos arquivos desta pasta e execute:

```bash
git add .
git commit -m "feat: adiciona loop com contexto e protecao contra duplicidade"
git push
```

O Render deve fazer o deploy automaticamente.

## Primeiro teste no Render sem OpenAI

Adicione ou confirme:

```env
AI_MODE=mock
```

Teste:

```bash
curl -X POST https://SEU-DOMINIO/api/isaque/responder \
  -H "Content-Type: application/json" \
  -d '{
    "customerServiceId":"teste-123",
    "messageId":"teste-msg-1",
    "sender":"customer",
    "message":"Minha internet caiu"
  }'
```

Depois:

```bash
curl -X POST https://SEU-DOMINIO/api/isaque/responder \
  -H "Content-Type: application/json" \
  -d '{
    "customerServiceId":"teste-123",
    "messageId":"teste-msg-2",
    "sender":"customer",
    "message":"Sim, tem luzes acesas"
  }'
```

A segunda resposta deve continuar a etapa anterior.

## Ativar a OpenAI

No Render:

```env
AI_MODE=openai
OPENAI_API_KEY=CHAVE_DA_EMPRESA
OPENAI_MODEL=gpt-4.1-mini
```

Nunca coloque `OPENAI_API_KEY` no GitHub nem na OPA.

## Body no OPA

Comece com os campos que estiverem disponíveis:

```json
{
  "customerServiceId": "{{id_atendimento}}",
  "messageId": "{{id_mensagem}}",
  "sender": "customer",
  "message": "{{mensagem_cliente}}",
  "previousResponseId": "{{retorno_api.response_id}}"
}
```

Output já validado:

```json
{
  "retorno_api": "data"
}
```

A instrução deve enviar ao cliente somente `retorno_api.reply` e depois aguardar uma nova mensagem antes de executar a ferramenta novamente.
