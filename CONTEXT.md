# CONTEXT — Agente TDAH (ARIA)

## Estado atual (2026-04-09)

### Servidor
- Express rodando localmente na porta 3000
- ngrok ativo tunelando para porta 3000
- Webhook Telegram registrado apontando para URL do ngrok

### Rotas
- `POST /api/telegram` — webhook Telegram (corrigida, funcionando)
- `GET /api/whatsapp` — verificação webhook WhatsApp
- `POST /api/whatsapp` — webhook WhatsApp

### Funcionalidades ativas
- **Texto**: recebe e responde mensagens de texto via Telegram
- **Fotos**: download da maior resolução, conversão base64, análise via Claude vision
- **PDFs**: suporte nativo Claude (< 25 MB) + extração texto via pdf-parse-fork (> 25 MB)
- **Documentos de texto**: leitura direta (.txt, .md, .csv, .json, .js, .py, .html, .css, .ts)
- **Limite real Telegram**: Bot API permite download de arquivos até 20 MB
- **fileReader.js**: funcionando para fotos e PDFs até 20 MB

### Correções aplicadas
- Rota Telegram corrigida de `/webhook/telegram` para `/api/telegram`
- fileReader.js ajustado para funcionar com fotos e PDFs corretamente

### Infraestrutura
- **Local**: Express + ngrok (testes e desenvolvimento)
- **Produção**: Vercel (https://agente-tdah.vercel.app)
- **Variáveis de ambiente**: ANTHROPIC_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, TELEGRAM_TOKEN, PORT

### Modelo de IA
- Claude Opus 4.5 via Anthropic API
- Suporte a vision (fotos) e document (PDFs) nativos

### Para retomar desenvolvimento
1. Iniciar servidor: `node src/index.js`
2. Iniciar ngrok: `ngrok http 3000`
3. Registrar webhook Telegram com nova URL do ngrok:
   ```
   curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/setWebhook?url=https://NGROK_URL/api/telegram"
   ```
4. Testar enviando mensagem para o bot no Telegram
