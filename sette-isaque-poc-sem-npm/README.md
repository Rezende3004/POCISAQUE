# SETTE Isaque POC — versão sem npm

Esta versão não possui dependências externas e não exige:

- npm install
- npm ci
- node_modules

Requisito: Node.js 24 LTS.

## 1. Criar o arquivo de ambiente

No Git Bash:

```bash
cp .env.example .env
```

## 2. Iniciar

```bash
node --env-file=.env server.mjs
```

Ou dê dois cliques em:

```text
iniciar-windows.bat
```

## 3. Testar health

```bash
curl http://localhost:3000/health
```

## 4. Testar resposta fixa

```bash
curl -X POST http://localhost:3000/api/teste-opa \
  -H "Content-Type: application/json" \
  -d '{"message":"Minha internet caiu"}'
```

Resposta esperada:

```json
{
  "success": true,
  "reply": "Mensagem recebida pela API externa com sucesso.",
  "received_message": "Minha internet caiu"
}
```

## 5. Testar com IA

Preencha `OPENAI_API_KEY` no `.env` e reinicie o servidor.

```bash
curl -X POST http://localhost:3000/api/isaque/responder \
  -H "Content-Type: application/json" \
  -d '{"message":"Minha internet caiu"}'
```

## Opa Suite

Primeiro teste:

- Método: POST
- Endpoint: `https://SEU-DOMINIO/api/teste-opa`
- Body:

```json
{
  "message": "teste enviado pelo Opa"
}
```

Mapeamento:

```json
{
  "reply": "resposta_ia"
}
```

Depois envie `{{resposta_ia}}` ao cliente no bloco seguinte.

Quando o teste fixo funcionar, altere o endpoint para:

```text
/api/isaque/responder
```

e substitua o texto fixo pela variável que contém a mensagem atual do cliente.
