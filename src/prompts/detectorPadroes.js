// Memória Evolutiva Fase 2 — Detector Reativo de Padrões
// Usado em brain.js como fire-and-forget pós-resposta. Custo: 1 chamada Haiku.

const Anthropic = require('@anthropic-ai/sdk');
const { proporHipotese, hipotesesParaPrompt } = require('../services/hipoteses');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function detectarEPropor(message, ariaResponse, history = []) {
  try {
    // Pega TODAS as hipóteses não-arquivadas (confianca >= 0) pra evitar duplicar
    const todas = await hipotesesParaPrompt(20, 0).catch(() => []);
    const jaCadastradas = todas.length
      ? `\n\nHipóteses já cadastradas sobre Carol (não duplique nem proponha variação superficial):\n${todas.map(h => `- ${h.texto}`).join('\n')}`
      : '';

    const recentes = history.slice(-10)
      .map(m => `[${m.role}] ${(m.content || '').substring(0, 200)}`)
      .join('\n');

    const prompt = `Você é o detector de padrões da ARIA, assistente pessoal da Carol (TDAH).

Observando o histórico recente E a interação mais recente, identifique UM padrão novo e não-óbvio sobre Carol. Critérios:
- Pode ser: contradição entre intenção dita e ação, repetição de tema/sintoma, coerência com lentes (médica/psicológica/ayurvédica/arquiteta).
- NÃO proponha o óbvio ("Carol tem TDAH", "Carol é arquiteta").
- NÃO proponha variação superficial de hipóteses já cadastradas.
- NÃO invente. Se não tiver padrão claro, retorne null.

HISTÓRICO RECENTE:
${recentes || '(vazio)'}

ÚLTIMA MENSAGEM DA CAROL:
${message}

RESPOSTA DA ARIA:
${(ariaResponse || '').substring(0, 500)}
${jaCadastradas}

Responda APENAS JSON, sem markdown:
- Se detectou padrão: {"texto": "frase curta observacional", "tags": ["tag1", "tag2"], "confianca_inicial": 0.5}
- Se não: null`;

    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const texto = r.content[0].text.trim().replace(/```json|```/g, '').trim();
    if (!texto || texto === 'null' || !texto.startsWith('{')) return null;

    const hip = JSON.parse(texto);
    if (!hip?.texto || !Array.isArray(hip.tags)) return null;

    const id = await proporHipotese({
      texto: hip.texto,
      fonte: 'reativo',
      contexto: `msg: "${(message || '').substring(0, 120)}"`,
      tags: hip.tags,
    });
    console.log(`🧠 [Detector] nova hipótese: "${hip.texto}" (id: ${id})`);
    return { id, ...hip };
  } catch (e) {
    console.log('🧠 [Detector] erro silenciado:', e.message);
    return null;
  }
}

module.exports = { detectarEPropor };
