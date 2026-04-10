# PROGRESS — Agente TDAH (ARIA)

## 2026-04-09 — Arquitetura completa + Deploy + Integrações

### Arquitetura do projeto

```
agente-tdah/
├── src/
│   ├── index.js              — servidor Express, rotas WhatsApp + Telegram
│   ├── integrations/
│   │   └── astrology.js      — fase lunar (cálculo local + RapidAPI fallback)
│   ├── modules/
│   │   ├── profile.js        — perfil holístico da Carol (dosha, buffer, etc)
│   │   ├── ayurveda.js       — relógio dos doshas + cronobiologia TDAH
│   │   └── holistic.js       — check-in 4D + ACT/IFS + emergência + vitórias
│   ├── prompts/
│   │   ├── system.js         — system prompt da ARIA
│   │   └── holistic-context.js — contexto holístico + bloqueio para injeção
│   ├── routes/
│   │   └── telegram.js       — webhook Telegram (texto, foto, documento, PDF)
│   └── services/
│       ├── brain.js          — orquestrador: analisa → holístico → resposta
│       ├── claude.js         — client Anthropic
│       ├── fileReader.js     — download Telegram, PDF (nativo + extração), imagens
│       ├── memory.js         — memória persistente (JSON), perfil, tarefas, vitórias
│       ├── obsidian.js       — integração Obsidian Vault (logs, tarefas, diário)
│       ├── scheduler.js      — agendador: resumo diário 21h + reflexão semanal domingo 20h
│       ├── selfImprove.js    — auto-reflexão semanal, prompt evoluído, resumo diário
│       └── telegram.js       — sendTelegramMessage
├── data/
│   ├── carol-profile.json    — perfil completo da Carol (saúde, TDAH, profissional)
│   └── memory.json           — memória persistente da ARIA
├── scripts/
│   └── import-profile.js     — importa carol-profile.json para memory.json
├── vercel.json               — config de deploy Vercel
├── index.js                  — entry point Vercel (raiz)
└── .env                      — variáveis de ambiente
```

### O que foi feito

#### brain.js — Orquestrador principal
- Pipeline de 7 passos: analisa mensagem → escolhe estratégia → carrega memória → gera resposta → salva memória → ações automáticas → thinking log
- 9 intenções: dump, task, focus, emergency, report, question, chat, idea, schedule
- 7 emoções detectadas: calm, stressed, excited, overwhelmed, frustrated, happy, tired
- Emergência automática quando detecta overwhelmed/frustrated
- `thinkWithImage()` para processar fotos e PDFs via Claude vision/document
- Perfil da Carol injetado no system prompt de cada conversa
- Prompt evoluído (selfImprove) integrado ao contexto
- Compatível com ambos os formatos do carol-profile.json (antigo e novo)

#### memory.js — Memória persistente
- Histórico das últimas 30 mensagens
- Perfil adaptativo: padrões TDAH, energia, vitórias, tarefas
- `loadCarolProfile()` carrega perfil completo do JSON
- `getMemorySummary()` gera contexto com perfil + tarefas + vitórias + padrões
- Tarefas em aberto com prioridade
- Registro de vitórias (últimas 50)

#### selfImprove.js — Auto-evolução
- Reflexão semanal: analisa conversas, detecta padrões, identifica o que funcionou/não funcionou
- Gera adições ao prompt baseadas em padrões observados (prompt evoluído)
- Salva reflexão no Obsidian em pasta própria (Reflexões Semanais)
- Resumo diário às 21h com contagem de mensagens e vitórias
- `loadEvolvedPrompt()` carrega instruções aprendidas

#### scheduler.js — Agendador
- Verifica tarefas a cada 30 minutos
- Resumo diário às 21h
- Reflexão semanal todo domingo às 20h
- Controle de execução para não repetir no mesmo dia/semana

#### fileReader.js — Processamento de arquivos
- Download de arquivos do Telegram (fotos e documentos)
- Imagens → base64 para Claude vision
- PDF < 25 MB → document block nativo do Claude (preserva layout)
- PDF > 25 MB → extração de texto via pdf-parse-fork (suporta qualquer tamanho)
- Arquivos de texto (.txt, .md, .csv, .json, .js, .py, .html, .css, .ts) → leitura direta
- Formatos não suportados → mensagem amigável
- Limite real: Telegram Bot API permite download de arquivos até 20 MB

#### telegram.js (routes) — Webhook Telegram
- Recebe texto, fotos e documentos
- Logs detalhados em cada etapa (entrada, download, processamento, resposta)
- Tratamento de erro com mensagem de fallback para a Carol
- Fotos → maior resolução + Claude vision
- PDFs → processPdf (nativo ou extração)
- Documentos de texto → leitura direta

#### obsidian.js — Integração Obsidian
- Salva thinking logs diários
- Salva tarefas criadas
- Salva resumos diários
- Salva reflexões semanais em pasta dedicada

#### carol-profile.json — Perfil importado
- Nome: Carol, 33 anos, Arquiteta em transição de carreira
- Diagnósticos: TDAH, Depressão/ansiedade
- Medicação: Rexulti 1mg + Venlift 75mg + Concerta 36mg (manhã), Razapina 45mg (noite)
- Energia pico: manhã até 14h
- Psicólogo: sextas 13h
- Meta 2026: dobrar a renda
- Importado para memory.json via scripts/import-profile.js

### Módulos holísticos (2026-04-09)

#### modules/profile.js — Perfil holístico
- Dosha: vata, nascimento: null (a definir), calendar: pessoal, buffer: 20min
- Medicação, energia pico, gatilhos e hiperfoco

#### modules/ayurveda.js — Relógio dos doshas + cronobiologia TDAH
- 6 blocos de dosha (vata/kapha/pitta × dia/noite) com horários
- Estratégias TDAH por dosha do momento (riscos + ações)
- Cronobiologia por dosha constitucional (rotina, sono, alimentação, exercício)
- `getContextoAyurveda()` retorna bloco atual + estratégia + cronobiologia
- Sem API externa — tudo calculado localmente

#### modules/holistic.js — Check-in + ACT/IFS + Emergência
- `gerarCheckin()` → check-in 4 dimensões (corpo/mente/emoção/energia) 1-5
- `interpretarCheckin()` → análise com estado, recomendações, ponto forte/fraco
- Respostas ACT (overwhelmed, frustrated, paralysis)
- Respostas IFS (crítico interno, parte criança, protetor)
- `isEmergencia()` → detecta palavras de crise/emergência
- `getModoEmergencia()` → protocolo 3 passos (grounding + respiração)
- `gerarRelatorioVitorias()` → relatório celebrativo

#### integrations/astrology.js — Fase lunar
- `getFaseLunarLocal()` → cálculo local, ciclo 29.53 dias desde 2000-01-06
- `getFaseLunar()` → tenta RapidAPI se RAPIDAPI_KEY existir, senão usa local
- 8 fases com mensagem TDAH + energia + dica
- Lua Cheia = alerta de agitação/hiperfoco/impulsividade

#### prompts/holistic-context.js — Injeção no system prompt
- `buildHolisticContext({ lua, checkin, agora })` → ayurveda + lua + check-in
- `buildBloqueioContext()` → linguagem ACT/IFS para paralisia

#### brain.js — Integração holística
- Detecta "checkin" / "bom dia" → envia check-in 4 dimensões direto
- Detecta resposta de check-in (ex: "3 2 4 1") → interpreta e contextualiza
- Detecta emergência via `isEmergencia()` → protocolo 3 passos imediato
- Injeta `buildHolisticContext()` no system prompt de toda resposta
- Injeta `buildBloqueioContext()` quando overwhelmed/frustrated/emergency
- Contexto holístico dentro de try/catch — se falhar, continua sem

### Correções anteriores
- **Rota Telegram corrigida**: de `/webhook/telegram` para `/api/telegram`
- **fileReader.js**: funcionando corretamente para fotos e PDFs até 20 MB
- **ngrok**: ativo e tunelando para porta 3000
- **Webhook Telegram**: registrado com URL do ngrok apontando para `/api/telegram`

### Deploy e infraestrutura
- **Vercel**: deploy em produção em https://agente-tdah.vercel.app
- **Variáveis de ambiente**: todas configuradas na Vercel (ANTHROPIC_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, TELEGRAM_TOKEN, PORT)
- **ngrok**: túnel configurado para testes locais (porta 3000)
- **Telegram webhook**: registrado e funcionando via ngrok (`/api/telegram`)
- **WhatsApp webhook**: configurado via Vercel

### Modelo de IA
- Claude Opus 4.5 para análise de mensagens e geração de respostas
- Suporte a vision (fotos) e document (PDFs) nativos

### Limitações conhecidas
- Telegram Bot API limita download de arquivos a 20 MB
- PDFs > 25 MB usam extração de texto (perdem layout visual)
- Sem persistência de conversas entre sessões do WhatsApp (memória é local)
- ngrok URL muda a cada reinício (precisa re-registrar webhook Telegram)
