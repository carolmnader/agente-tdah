# Agente TDAH (ARIA)

Bot Telegram pessoal — copiloto cognitivo para TDAH. Stack: Node.js / Express / 
Vercel Fluid Compute / Supabase / Anthropic Claude (Opus 4.7 + Haiku 4.5) / 
Google Calendar / Groq Whisper / Oura.

> **Documentação canônica vive no Notion** — contexto, decisões, diário e 
> spec de features. Links em `CLAUDE.md`. Este README só carrega lições 
> arquiteturais técnicas que ficam relevantes para quem lê o código direto.

---

## 🐛 Padrões evitados

### "Bug G família" — CHECK constraint em strings/enums

**Sintoma:** INSERT/UPDATE falha silenciosamente em produção, catch da 
camada de persistência engole o erro, bug fica invisível em logs.

**Causa raiz:** CHECK constraint no Postgres com lista fixa de valores 
string/enum (ex: `CHECK (tipo IN ('a', 'b'))`). Quando o código adiciona 
um valor novo (`'c'`) sem migration acompanhar, INSERT falha com violation 
silenciosa.

**Princípio:**
- Validação de **número/range** → fica no banco (CHECK válido — range não 
  muda com features)
- Validação de **string/enum** → fica no código (TS/JS) — banco com 
  comentário documentando valores esperados, sem CHECK

**Diagnóstico empírico (19/05/2026):** 5 instâncias descobertas e 
removidas em sequência:
- `acoes_pendentes.tipo` (Bug G original — `'cancelar_selecao'` omitido)
- `sugestoes_arquiteturais.status` + `.categoria`
- `hipoteses.fonte` + `.status`

**Exceção válida:** `mensagens.role` (CHECK em `'user'/'assistant'`) — 
convenção LLM universal, valores não crescem com features.
