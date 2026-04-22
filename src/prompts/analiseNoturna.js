// Memória Evolutiva Fase 3 — Prompt da análise noturna (cron 02h)
// Recebe contexto agregado das últimas 24h, retorna 0-3 hipóteses novas via Haiku.

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `Você é o analisador noturno da ARIA, assistente pessoal da Carol (TDAH).

Às 2h da manhã você relê os últimos turnos da Carol, o humor dela e o que ela fez no calendário hoje. Procure padrões NOVOS, NÃO-ÓBVIOS, que ainda não estão na lista de hipóteses cadastradas. Critérios:

- Priorize:
  • CONTRADIÇÕES entre intenção dita e ação executada
  • PADRÕES TEMPORAIS (algum comportamento sempre num horário específico)
  • CROSS-DOMAIN (humor × agenda × tipo de mensagem)

- NÃO proponha:
  • O óbvio ("Carol tem TDAH", "Carol é arquiteta")
  • Variação superficial de hipóteses já cadastradas
  • Algo que o detector reativo já capturou hoje (assume-se já registrado)

- MÁXIMO 3 hipóteses novas por noite
- Se nada significativo, retorne {"hipoteses_novas": []}

DADOS DO DIA:

== Mensagens últimas 24h ==
{MENSAGENS}

== Humor registrado últimos 3 dias ==
{HUMOR}

== Eventos Calendar criados/executados hoje ==
{EVENTOS}

== Hipóteses já cadastradas (NÃO duplique) ==
{HIPOTESES_EXISTENTES}

Ao final da análise, se você detectar padrão claro que sugere melhoria ARQUITETURAL da própria ARIA (sistema, voz, features), retorne também o campo opcional:

sugestoes_arquiteturais: [
  {
    titulo: string curta,
    descricao: string explicativa, máx 2 frases,
    categoria: feature | bug | refactor | voice_calibration,
    prioridade: 1-5 (5 = crítico),
    confianca: 0-1
  }
]

Campo é OPCIONAL. Se não detectar nada claro, omita ou retorne array vazio. NÃO force sugestões se a noite não revelou nada arquitetural.

Responda APENAS JSON válido (sem markdown, sem prefixo):
{
  "hipoteses_novas": [
    { "texto": "frase observacional curta", "tags": ["tag1", "tag2"], "confianca_inicial": 0.50 }
  ],
  "sugestoes_arquiteturais": [
    { "titulo": "...", "descricao": "...", "categoria": "feature", "prioridade": 3, "confianca": 0.5 }
  ]
}`;

async function chamarAnaliseNoturna({ mensagens, humor, eventos, hipotesesExistentes }) {
  const prompt = PROMPT
    .replace('{MENSAGENS}', mensagens || '(nenhuma mensagem nas últimas 24h)')
    .replace('{HUMOR}', humor || '(sem registro)')
    .replace('{EVENTOS}', eventos || '(sem eventos)')
    .replace('{HIPOTESES_EXISTENTES}', hipotesesExistentes || '(nenhuma)');

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });
    const texto = r.content[0].text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(texto);
    if (!parsed?.hipoteses_novas || !Array.isArray(parsed.hipoteses_novas)) {
      return { hipoteses_novas: [] };
    }
    // Sanity cap em 3 (mesmo se Haiku desobedecer)
    parsed.hipoteses_novas = parsed.hipoteses_novas.slice(0, 3);
    return parsed;
  } catch (e) {
    console.log('🌙 [analiseNoturna] erro silenciado:', e.message);
    return { hipoteses_novas: [] };
  }
}

module.exports = { chamarAnaliseNoturna, PROMPT };
