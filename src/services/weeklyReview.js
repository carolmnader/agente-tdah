// src/services/weeklyReview.js
// Onda 1.5 — Weekly Review ritual (sábado 07h BRT, primeiro disparo 23/05/2026).
//
// Orquestra 6 fontes em paralelo, monta dados factuais, chama Opus pra gerar
// mensagem dos 6 blocos. Helpers internos pra marcar disparo / resposta no
// log (memorias categoria='sistema', chave='weekly_review_log').
//
// Edge cases: Oura null, 0 sugestoes, overwhelming (>10), Carol pulou 3.

const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT, normalizarTratamento } = require('../prompts/system');
const {
  detectarPerformaSubjetividade,
  buscarSubjetividadeLog7d
} = require('./detectarPerformaSubjetividade');
const { buscarPropostaJanela, buscarPinadas } = require('./sugestoes');
const { buscarHipotesesValidadasJanela } = require('./hipoteses');
const { snapshotSemanal } = require('./oura');
const {
  buscarHumorRecente,
  buscarMemoriasCanonicasNovas,
  buscarCancelamentosCount,
  buscarWeeklyLog,
  salvarMemoria,
} = require('./memorySupabase');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detecta se Carol pulou os últimos 3 weekly review (nenhum respondido).
 */
function pulou3Seguidos(weeklyLog) {
  if (!weeklyLog || weeklyLog.length < 3) return false;
  return weeklyLog.slice(0, 3).every(w => !w.respondida_em);
}

/**
 * D3: Calibração mensal — a cada 4 weekly disparados, fazer pergunta.
 * Conta o disparo atual: se já existem 3 (este será o 4º), entra calibração.
 */
function eMomentoCalibracaoMensal(weeklyLog) {
  return weeklyLog.length > 0 && (weeklyLog.length % 4 === 3);
}

/**
 * D2 adaptativo: 0→[], 1-2→enumera disponíveis, 3+→top 3 por confiança.
 */
function selecionarTopSugestoes(sugestoes) {
  if (!sugestoes || sugestoes.length === 0) return [];
  return sugestoes.slice(0, 3);
}

// ─── Marcar disparo / resposta no weekly_review_log ──────────────────────────

/**
 * Grava disparo do weekly em memorias (categoria='sistema', chave='weekly_review_log').
 * Valor inicial = 'pulado' (vira 'respondida' se Carol interagir).
 * Bug G família OK: memorias não tem CHECK em categoria/chave.
 * @param {string} chatId
 * @param {Date} dataHora
 * @param {'cron'|'manual'} trigger
 * @param {Array<number>} sugestoesIds - IDs das sugestões enviadas no top 3
 */
async function marcarWeeklyDisparo(chatId, dataHora, trigger = 'cron', sugestoesIds = []) {
  const contexto = JSON.stringify({
    disparo: dataHora.toISOString(),
    trigger,
    sugestoes: sugestoesIds,
    chat_id: chatId,
  });
  await salvarMemoria('sistema', 'weekly_review_log', 'pulado', contexto);
}

/**
 * Marca o último weekly como respondido (atualiza valor='respondida' + contexto).
 * Chamado pelo handler 0f-weekly em brain.js quando Carol responde "1 pinar" etc.
 */
async function marcarWeeklyRespondida(chatId, comando) {
  await salvarMemoria(
    'sistema',
    'weekly_review_log',
    'respondida',
    JSON.stringify({ comando, respondida_em: new Date().toISOString(), chat_id: chatId })
  );
}

// ─── Função principal ────────────────────────────────────────────────────────

/**
 * Gera Weekly Review pra Carol.
 * @param {string} chatId - Telegram chat ID
 * @param {Object} [opts]
 * @param {'cron'|'manual'} [opts.trigger='cron']
 * @param {boolean} [opts.dryRun=false] - se true, não grava weekly_log
 * @returns {Promise<{ mensagem: string, sugestoesIds: Array<number>, deveSalvarPendente: boolean }>}
 */
async function gerarWeeklyReview(chatId, opts = {}) {
  const trigger = opts.trigger || 'cron';
  const dryRun = !!opts.dryRun;

  // PASSO 1: orquestra 6 fontes em paralelo (tudo .catch graceful)
  const [
    sugestoesProposta,
    sugestoesPinadas,
    hipotesesValidadas,
    humoresSemana,
    memoriasNovas,
    cancelamentosCount,
    subjetividadeLog,
    weeklyLog,
    ouraSnap,
  ] = await Promise.all([
    buscarPropostaJanela(7).catch(() => []),
    buscarPinadas().catch(() => []),
    buscarHipotesesValidadasJanela(7).catch(() => []),
    buscarHumorRecente(168).catch(() => []),
    buscarMemoriasCanonicasNovas(7).catch(() => []),
    buscarCancelamentosCount(7).catch(() => 0),
    buscarSubjetividadeLog7d(7).catch(() => []),
    buscarWeeklyLog(4).catch(() => []),
    snapshotSemanal().catch(() => null),
  ]);

  // PASSO 2: decisões de apresentação
  const topSugestoes = selecionarTopSugestoes(sugestoesProposta);
  const overwhelming = sugestoesProposta.length > 10;
  const sugestoesIds = topSugestoes.map(s => s.id);

  // PASSO 3: edge cases
  const carolPulou3 = pulou3Seguidos(weeklyLog);
  const calibracaoMensal = eMomentoCalibracaoMensal(weeklyLog);

  // Status especial: Carol pulou 3 seguidos → mensagem curta
  if (carolPulou3) {
    const msgCurta = `🌅 <b>Sábado</b>\n\nPulei os últimos 3 weekly. Esse ritual ainda faz sentido pra você? Me diz "mantém" ou "pausa".`;
    if (trigger === 'cron' && !dryRun) {
      await marcarWeeklyDisparo(chatId, new Date(), trigger, []);
    }
    return { mensagem: msgCurta, sugestoesIds: [], deveSalvarPendente: false };
  }

  // PASSO 4: prompt Opus pros 6 blocos
  const dadosWeekly = {
    sugestoes: {
      total: sugestoesProposta.length,
      top: topSugestoes,
      overwhelming,
    },
    pinadas: sugestoesPinadas,
    hipoteses_validadas: hipotesesValidadas,
    humores_semana: humoresSemana,
    memorias_novas: memoriasNovas,
    cancelamentos_count: cancelamentosCount,
    subjetividade_log: subjetividadeLog,
    oura: ouraSnap,
    calibracao_mensal: calibracaoMensal,
  };

  const userPrompt = `Você está enviando o RITUAL WEEKLY REVIEW pra Carol no Telegram (proativo, sábado 07h BRT).

DADOS DOS ÚLTIMOS 7 DIAS:
${JSON.stringify(dadosWeekly, null, 2)}

ESTRUTURA — 6 BLOCOS (omitir bloco se dados vazios, mas manter ordem):

1. VITÓRIA OBSERVADA
   Uma coisa concreta que Carol FEZ esta semana (de memorias_novas, humores_semana ou hipoteses_validadas). Cite com especificidade, sem bajulação.
   Se nada concreto, escreva "(sem vitória clara registrada essa semana)" e siga.

2. UM PADRÃO (exige 3+ observações)
   Olhe humores_semana, hipoteses_validadas. Se algo apareceu 3+ vezes, nomeie. Senão diga "observação ainda em formação". NUNCA invente padrão de 1-2 ocorrências.

3. CORPO (OURA semanal)
   Se oura.sleep / readiness / activity tem dados, cite números literais ("sono médio 71, 3 noites <70"). NÃO atribua causalidade ("dormiu mal POR causa de X"). Só observação factual.
   Se oura=null, OMITA bloco 3 inteiramente (não diga "Oura indisponível").

4. SUGESTÕES NA FILA (adaptativo)
   - 0 sugestões → omita bloco completamente
   - 1-2 → enumere "1. ..." / "2. ..." com título + descrição curta
   - 3+ → mostre top 3 enumeradas
   - overwhelming=true → adicione linha curta: "essa semana gerei ${sugestoesProposta.length} padrões, talvez calibrar"
   FIM do bloco SEMPRE com: <i>Responde com "1 pinar" / "2 arquivar" / "3 ler" (ou "todas arquivar", "pulo essa semana")</i>

5. PIN BOARD
   Se pinadas tiver itens, liste com título. Se weeks_since_pinned >= 6 em alguma, marque com "(há N semanas — ainda faz sentido?)" UMA vez, sem cobrar.
   Se pinadas vazio, omita bloco 5.

6. CALIBRAÇÃO MENSAL (só se calibracao_mensal=true)
   UMA pergunta de calibração (ex: "Esses weekly review estão te ajudando? Quer ajustar formato?").
   Se calibracao_mensal=false, omita bloco 6.

REGRAS DE VOZ:
- HTML Telegram: <b>negrito</b>, <i>itálico</i>
- Máximo 30 linhas total
- Tom Registro C (editorial-observadora). NÃO maternal, NÃO cheerleader.
- ZERO bajulação. ZERO clichês TDAH.
- Pin 3 (bem-estar validado): NÃO ofereça validação Oura/métrica como prova de "bem-estar". Aqui você nomeia FATOS, Carol interpreta.
- subjetividade_log: se 3+ entradas, encerre com nota humilde ("registrei algumas performances minhas essa semana — vou calibrar"). 1-2 entradas: omita.
- cancelamentos_count: cite como fato neutro se relevante ("3 coisas marcadas e não feitas essa semana"). Nunca julgue.

Inicie SEMPRE com: 🌅 <b>Sábado</b> — weekly review

Gere APENAS o texto da mensagem, sem explicações extras.`;

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // PASSO 5: pós-processar
  const textoBruto = resp.content[0]?.text || '';
  const mensagem = normalizarTratamento(textoBruto);

  // Onda 1.9 Layer 2: detector fire-and-forget de performance de subjetividade
  detectarPerformaSubjetividade(
    mensagem,
    null,
    'weeklyReview.gerarWeeklyReview',
    { trigger, sugestoes_total: sugestoesProposta.length }
  ).catch(() => {});

  // PASSO 6: trigger='cron' marca disparo; 'manual' não conta (refinamento D)
  if (trigger === 'cron' && !dryRun) {
    await marcarWeeklyDisparo(chatId, new Date(), trigger, sugestoesIds);
  }

  return {
    mensagem,
    sugestoesIds,
    deveSalvarPendente: topSugestoes.length > 0,
  };
}

module.exports = {
  gerarWeeklyReview,
  marcarWeeklyDisparo,
  marcarWeeklyRespondida,
};
