# CONFIGURAÇÃO DO OPA — CONVERSATION_ID GERADO PELA API

## Funcionamento

Na primeira mensagem, a variável `{{conversation_id}}` pode estar vazia.

A API:

1. recebe a mensagem;
2. cria um UUID;
3. guarda o estado da conversa usando esse UUID;
4. devolve `conversation_id` e `reply`.

O OPA salva o ID devolvido em `{{conversation_id}}`.

Nas mensagens seguintes, o OPA envia o mesmo ID e a API recupera o contexto correto.

---

## Ferramenta HTTP

URL base:

```text
https://sette-isaque-poc.onrender.com/api/
```

Endpoint:

```text
opa/responder
```

Método:

```text
POST
```

Header:

```json
{
  "Content-Type": "application/json"
}
```

Body:

```json
{
  "mensagem_cliente": "{{mensagem_cliente}}",
  "conversation_id": "{{conversation_id}}"
}
```

Se `{{conversation_id}}` ainda não tiver valor, a API criará um automaticamente.

Output:

```json
{
  "retorno_api": "data"
}
```

---

## Retorno

Primeira mensagem:

```json
{
  "success": true,
  "conversation_id": "2b876bc3-f7d2-4db0-b6fd-040856010dda",
  "conversation_created": true,
  "reply": "*Isaque:*\n\nEntendi 😊 O equipamento da internet está conectado à energia e com alguma luz acesa? 💙"
}
```

Próximas mensagens:

```json
{
  "success": true,
  "conversation_id": "2b876bc3-f7d2-4db0-b6fd-040856010dda",
  "conversation_created": false,
  "reply": "*Isaque:*\n\nPerfeito 😊 Pode me enviar uma foto mostrando as luzes do equipamento, por favor? 💙"
}
```

---

## Instrução anterior à ferramenta

```text
Assim que o cliente responder, salve exatamente o conteúdo recebido na variável {{mensagem_cliente}}.

Não resuma, não corrija e não altere a mensagem.

Execute obrigatoriamente a ferramenta responsável por enviar a mensagem para a API externa.

No Body da ferramenta, envie {{mensagem_cliente}} e o valor atual de {{conversation_id}}.

Na primeira execução, {{conversation_id}} poderá estar vazio.

Não envie nenhuma mensagem ao cliente antes de executar a ferramenta.
```

## Instrução posterior à ferramenta

```text
Após a ferramenta retornar, analise o objeto retorno_api.

Se retorno_api.success for igual a true:

1. salve exatamente o valor de retorno_api.conversation_id na variável {{conversation_id}};
2. não gere, altere ou substitua esse identificador por conta própria;
3. envie ao cliente somente o conteúdo de retorno_api.reply.

Nas próximas mensagens, reutilize exatamente o valor já salvo em {{conversation_id}}.

Não envie ao cliente o conversation_id, o objeto JSON, nomes de campos ou informações técnicas.

Se retorno_api.success não for true, se conversation_id estiver ausente ou se reply estiver vazio, não invente uma resposta.
```

---

## Teste do loop

Primeira mensagem:

```text
minha internet caiu
```

A API deve devolver um novo `conversation_id`.

Segunda mensagem, no mesmo fluxo:

```text
sim
```

O Body precisa enviar o ID salvo na primeira chamada.

A resposta esperada no modo mock é uma solicitação de foto das luzes, pois a API lembrará da pergunta anterior.

---

## Limitação atual da prova de conceito

O estado ainda é mantido na memória do processo e expira conforme `STATE_TTL_MS`.

Reinício, novo deploy ou troca de instância pode apagar esse contexto. Antes de produção, o estado deve ser persistido em banco de dados ou Redis.
