// src/services/detectorContradicao.js
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT_DETECTOR = `Você é um detector CONSERVADOR de contradições factuais sobre Carol.

Tarefa: dado um FATO NOVO sobre Carol e uma lista de MEMÓRIAS ANTIGAS ativas na mesma categoria, identificar quais memórias antigas são DIRETAMENTE CONTRADITAS pelo fato novo.

REGRAS DE CONSERVADORISMO:
1. Em dúvida, NÃO marca. Falso negativo é melhor que falso positivo.
2. Só marca contradição se for CLARA, DIRETA e sobre o MESMO aspecto da realidade.

CONTRADIÇÃO (marcar):
- "Carol vai fazer exercício hoje" + "Carol não fez exercício hoje" → CONTRADIÇÃO
- "Carol mora em Recife" + "Carol mudou pra SP" → CONTRADIÇÃO
- "Carol está bem agora" + "Carol está mal agora" (mesmo timing) → CONTRADIÇÃO
- "Carol não está fazendo exercício" + "Carol voltou a fazer yoga" → CONTRADIÇÃO

NÃO-CONTRADIÇÃO (não marcar):
- "Carol gosta de yoga" + "Carol às vezes prefere pilates" → nuance
- "Carol cansada manhã" + "Carol animada à tarde" → contextos temporais diferentes
- "Carol tem TDAH" + "Carol toma Concerta" → complementar
- "Carol cancelou reunião X" + "Carol faltou ao psicólogo" → eventos diferentes

FATO NOVO:
- Categoria: {categoria}
- Chave: {chave}
- Valor: {valor}
- Contexto: {contexto}

MEMÓRIAS ANTIGAS ATIVAS NA MESMA CATEGORIA:
{lista}

Responda APENAS com JSON válido (sem markdown, sem texto extra):
{"contradicoes": [{"id": "uuid-da-antiga", "razao": "breve frase"}]}

Se nenhuma contradição clara: {"contradicoes": []}`;

/**
 * Detecta quais memórias antigas são contraditas por um fato novo.
 * Conservador: retorna lista vazia se duvidoso ou em erro.
 * @returns {Promise<string[]>} IDs das memórias antigas a marcar como superseded
 */
async function detectarContradicao(novoFato, candidatasAntigas) {
  if (!candidatasAntigas || candidatasAntigas.length === 0) return [];

  const listaJson = JSON.stringify(
    candidatasAntigas.map(m => ({
      id: m.id,
      chave: m.chave,
      valor: m.valor,
      contexto: m.contexto,
      criada_em: m.created_at
    })),
    null, 2
  );

  const prompt = PROMPT_DETECTOR
    .replace('{categoria}', novoFato.categoria)
    .replace('{chave}', novoFato.chave)
    .replace('{valor}', novoFato.valor)
    .replace('{contexto}', novoFato.contexto || '(sem contexto)')
    .replace('{lista}', listaJson);

  try {
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const texto = result.content[0].text.trim().replace(/```json|```/g, '').trim();
    const dados = JSON.parse(texto);

    if (!Array.isArray(dados.contradicoes)) return [];

    const ids = dados.contradicoes.map(c => c.id).filter(Boolean);
    if (ids.length > 0) {
      const detalhe = dados.contradicoes.map(c => `${c.id.slice(0,8)}: ${c.razao}`).join(' | ');
      console.log(`🔄 [Contradição] ${ids.length} marcada(s) como superseded → ${detalhe}`);
    }
    return ids;

  } catch (e) {
    console.log('🔄 [Contradição] Detecção falhou (conservador, nada marcado):', e.message);
    return [];
  }
}

module.exports = { detectarContradicao };
