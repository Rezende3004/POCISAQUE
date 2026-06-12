# POC 3 — Descoberta das variáveis reais do OPA

## Objetivo

Confirmar, sem suposição:

1. se o OPA consegue enviar a mensagem atual do cliente;
2. se existe no fluxo um identificador estável do atendimento;
3. se existe um identificador único da mensagem;
4. quais nomes e formatos realmente chegam à API.

## Endpoint

```text
POST https://sette-isaque-poc.onrender.com/api/opa/diagnostico
```

## Configuração da ferramenta

- App HTTP: o mesmo já criado;
- Endpoint: `opa/diagnostico`;
- Método: `POST`;
- Header: `Content-Type: application/json`;
- Output:

```json
{
  "retorno_api": "data"
}
```

## Body

Primeiro mantenha um campo literal para provar que o Body chegou:

```json
{
  "controle_literal": "teste-diagnostico-opa"
}
```

Depois acrescente campos usando SOMENTE variáveis selecionadas pela interface do OPA:

```json
{
  "controle_literal": "teste-diagnostico-opa",
  "mensagem_candidata": "{{VARIAVEL_REAL_SELECIONADA_NO_OPA}}",
  "atendimento_candidato": "{{VARIAVEL_REAL_SELECIONADA_NO_OPA}}",
  "mensagem_id_candidata": "{{VARIAVEL_REAL_SELECIONADA_NO_OPA}}",
  "cliente_candidato": "{{VARIAVEL_REAL_SELECIONADA_NO_OPA}}",
  "protocolo_candidato": "{{VARIAVEL_REAL_SELECIONADA_NO_OPA}}"
}
```

Os nomes à esquerda são nossos e podem ser mantidos. Os valores à direita precisam vir do seletor real de variáveis do OPA.

## Como interpretar

- Valor real em `resolved_fields`: variável confirmada.
- Texto `{{alguma_variavel}}` em `unresolved_placeholders`: OPA não substituiu esse placeholder.
- Campo ausente: OPA não enviou.
- `detected_candidates.message`: possível conteúdo da mensagem.
- `detected_candidates.customer_service_id`: possível chave estável da conversa.
- `detected_candidates.message_id`: possível ID único da mensagem.

## Critério de aprovação

A POC está aprovada quando a resposta mostrar:

- a mensagem real digitada pelo cliente;
- um identificador que permaneça igual em duas mensagens do mesmo atendimento;
- preferencialmente, um identificador que mude a cada nova mensagem.

## Teste em dois turnos

Primeiro envio do cliente:

```text
mensagem de teste número um
```

Segundo envio, no mesmo atendimento:

```text
mensagem de teste número dois
```

Compare:

- o campo da mensagem deve mudar;
- a chave do atendimento deve permanecer igual;
- o ID da mensagem, se disponível, deve mudar.
