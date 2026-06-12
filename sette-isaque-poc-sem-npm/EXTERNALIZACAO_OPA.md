# EXTERNALIZAÇÃO MAIOR — API OFICIAL DO OPA

## O que esta versão faz

A API externa passa a:

1. receber a mensagem atual do cliente;
2. manter o contexto pelo `conversation_id`;
3. gerar a resposta do Isaque;
4. localizar ou receber o ID oficial do atendimento;
5. chamar a API oficial do OPA;
6. enviar a resposta diretamente ao atendimento.

O fluxo visual do OPA não deve enviar `{{resposta_ia}}` quando a rota
`/api/opa/externalizar` estiver em uso.

---

## Endpoints adicionados

### 1. Localizar atendimento pelo protocolo

```http
POST /api/opa/resolver-atendimento
```

Body:

```json
{
  "opa_protocolo": "OPA20232017"
}
```

A API chama oficialmente:

```http
GET /api/v1/atendimento
```

com:

```json
{
  "filter": {
    "protocolo": "OPA20232017"
  },
  "options": {
    "limit": 2
  }
}
```

### 2. Enviar mensagem fixa diretamente

```http
POST /api/opa/testar-envio-direto
```

Usando o ID oficial:

```json
{
  "opa_customer_service_id": "ID_OFICIAL_DO_ATENDIMENTO",
  "text": "Teste de envio direto da API externa."
}
```

Ou usando protocolo:

```json
{
  "opa_protocolo": "OPA20232017",
  "text": "Teste de envio direto da API externa."
}
```

A API chama oficialmente:

```http
POST /api/v1/atendimento/mensagem/send
```

### 3. Gerar e enviar a resposta diretamente

```http
POST /api/opa/externalizar
```

Com ID oficial:

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}",
  "conversation_id": "{{conversation_id}}",
  "opa_customer_service_id": "{{opa_customer_service_id}}"
}
```

Com protocolo:

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}",
  "conversation_id": "{{conversation_id}}",
  "opa_protocolo": "{{opa_protocolo}}"
}
```

Resposta ao fluxo:

```json
{
  "success": true,
  "conversation_id": "UUID_INTERNO",
  "conversation_created": false,
  "reply_dispatched": true,
  "delivery": {
    "mode": "opa",
    "sent": true,
    "customer_service_id": "ID_OFICIAL",
    "opa_message_id": "ID_DA_MENSAGEM_ENVIADA"
  }
}
```

A mensagem ao cliente é enviada pela nossa API. Não existe campo `reply`
no retorno simplificado para o fluxo exibir.

---

## Variáveis do Render

Primeiro, modo seguro:

```text
OPA_DELIVERY_MODE=mock
OPA_BASE_URL=https://DOMINIO-REAL-DO-OPA
OPA_API_TOKEN=TOKEN_REAL_DO_USUARIO_API
```

No modo `mock`, a API gera a resposta, mas não chama o endpoint de envio.

Para o teste real controlado:

```text
OPA_DELIVERY_MODE=opa
```

A documentação informa que o token deve pertencer a um usuário com perfil
de permissões do tipo API.

---

## Ordem obrigatória dos testes

### Teste 1 — configuração

```bash
curl https://sette-isaque-poc.onrender.com/health
```

Confirme:

```json
{
  "opa_delivery_mode": "mock",
  "opa_configured": true
}
```

### Teste 2 — localizar um atendimento controlado

```bash
curl -X POST https://sette-isaque-poc.onrender.com/api/opa/resolver-atendimento \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SUA_CHAVE_DA_API_INTERNA" \
  -d '{"opa_protocolo":"PROTOCOLO_DE_TESTE"}'
```

### Teste 3 — envio fixo real

Troque temporariamente:

```text
OPA_DELIVERY_MODE=opa
```

Depois:

```bash
curl -X POST https://sette-isaque-poc.onrender.com/api/opa/testar-envio-direto \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SUA_CHAVE_DA_API_INTERNA" \
  -d '{
    "opa_customer_service_id":"ID_OFICIAL_CONFIRMADO",
    "text":"Mensagem de teste enviada diretamente pela API externa."
  }'
```

O bloco visual do OPA não participa desse teste.

### Teste 4 — externalização completa

No fluxo, altere o endpoint para:

```text
opa/externalizar
```

Body:

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}",
  "conversation_id": "{{conversation_id}}",
  "opa_customer_service_id": "{{opa_customer_service_id}}"
}
```

Output:

```json
{
  "conversation_id": "data.conversation_id",
  "sucesso_api": "data.success",
  "mensagem_enviada": "data.reply_dispatched"
}
```

Depois da ferramenta:

- salvar `conversation_id`;
- não enviar `{{resposta_ia}}`;
- voltar a aguardar a próxima mensagem do cliente.

---

## Proteção contra duplicidade

Durante a troca para envio direto, remova ou desative o bloco que envia
`{{resposta_ia}}`. Caso contrário, o cliente poderá receber duas mensagens.

---

## Observação de produção

Esta versão ainda mantém o estado em memória. Antes da produção definitiva,
migre o estado de conversa para PostgreSQL ou Redis.
