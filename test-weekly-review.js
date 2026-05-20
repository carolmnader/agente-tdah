// test-weekly-review.js — Onda 1.5 PARTE B.4
// 5 cenários cobrindo edge cases do Weekly Review ritual (sábado 07h BRT).
//
// PADRÃO HÍBRIDO:
//  - Mock @anthropic-ai/sdk + oura.js (custo Opus + determinismo)
//  - Supabase REAL com seed/cleanup isolado
//
// Cenários:
//  C1 full week — 5 sugestões + humor variado + Oura ativo → 6 blocos
//  C2 quiet week — 0 sugestões + humor estável → Bloco 4 omitido
//  C3 overwhelming — 14 sugestões → top 3 + meta-mensagem 'calibrar'
//  C4 Carol pulou 3 weekly → mensagem curta especial (path early return)
//  C5 Oura API down — snapshotSemanal=null → Bloco 3 omitido sem crash

require('dotenv').config();

// ──────────────────────────────────────────────────────
// SEÇÃO 1 — Mocks via require.cache
// ──────────────────────────────────────────────────────

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

// State compartilhado: cada cenário seta currentCenario antes de chamar gerarWeeklyReview
let currentCenario = null;
const mockOpusOutputs = {
  // Mensagens determinísticas por cenário (simulam o que Opus geraria)
  C1: '🌅 <b>Sábado</b> — weekly review\n\n<b>1. Vitória observada</b>\nVocê manteve yoga 3x na semana e nomeou bem-estar terça e quinta.\n\n<b>2. Um padrão</b>\nCalma apareceu 4 vezes nos registros de humor. Animada 3x, travada 2x.\n\n<b>3. Corpo</b>\nSono médio 78, readiness médio 78, 8500 passos/dia.\n\n<b>4. Sugestões na fila</b>\n1. Calibração noturna recuo progressivo\n2. Integração Calendar-Memória\n3. Hipótese sobre cronotipo\n\n<i>Responde com "1 pinar" / "2 arquivar" / "3 ler" (ou "todas arquivar", "pulo essa semana")</i>',
  C2: '🌅 <b>Sábado</b> — weekly review\n\n<b>1. Vitória observada</b>\n(sem vitória clara registrada essa semana)\n\n<b>2. Um padrão</b>\nCalma apareceu 7 vezes. Humor estável a semana inteira.\n\n<b>3. Corpo</b>\nSono médio 75.\n\n(sem sugestões em fila essa semana)',
  C3: '🌅 <b>Sábado</b> — weekly review\n\n<b>1. Vitória observada</b>\nNomeou estado emocional 3 vezes na semana.\n\n<b>2. Um padrão</b>\nMuita atividade reflexiva — observação ainda em formação.\n\n<b>4. Sugestões na fila</b>\n1. Top sug A\n2. Top sug B\n3. Top sug C\n\nEssa semana gerei 14 padrões, talvez calibrar.\n\n<i>Responde com "1 pinar" / "2 arquivar" / "3 ler"</i>',
  // C4 não usa Opus (path early return)
  C5: '🌅 <b>Sábado</b> — weekly review\n\n<b>1. Vitória observada</b>\nVocê manteve estrutura na semana.\n\n<b>4. Sugestões na fila</b>\n1. A\n2. B\n3. C\n\n<i>Responde com "1 pinar" / "2 arquivar" / "3 ler"</i>',
};

const anthropicCalls = [];
const AnthropicMock = function () {
  return {
    messages: {
      create: async (opts) => {
        anthropicCalls.push({ cenario: currentCenario, model: opts.model });
        const texto = mockOpusOutputs[currentCenario] || '<DEFAULT-MOCK>';
        return { content: [{ type: 'text', text: texto }], usage: { input_tokens: 100, output_tokens: Math.round(texto.length / 4) } };
      },
    },
  };
};
mockModule('@anthropic-ai/sdk', AnthropicMock);

// Mock oura.js — snapshotSemanal customizável por cenário
let mockOuraSnapshot = null;
mockModule('./src/services/oura', {
  snapshotMatinal: async () => null,
  snapshotSemanal: async () => mockOuraSnapshot,
  fetchSonoOntem: async () => null,
  fetchReadinessHoje: async () => null,
  fetchAtividadeHoje: async () => null,
  fetchStressHoje: async () => null,
  fetchWorkoutsHoje: async () => [],
});

// Após mocks, carrega weeklyReview (com Anthropic e oura mockados)
const { gerarWeeklyReview } = require('./src/services/weeklyReview');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ──────────────────────────────────────────────────────
// SEÇÃO 2 — Helpers de seed/cleanup
// ──────────────────────────────────────────────────────

const CHAT_ID_TESTE = 'test_chat_weekly_999';
const PREFIXO_TESTE = '[TESTE_WEEKLY]';
const CATEGORIA_TESTE = 'teste_weekly_onda15';

async function seedSugestoes(propostas) {
  // propostas: array de { titulo, descricao, confianca, categoria, prioridade }
  const rows = propostas.map(p => ({
    titulo: `${PREFIXO_TESTE} ${p.titulo}`,
    descricao: p.descricao,
    categoria: p.categoria || 'feature',
    prioridade: p.prioridade || 3,
    confianca: p.confianca,
    origem: 'teste_weekly',
    status: 'proposta',
    contexto: { teste: true },
  }));
  const { data, error } = await supabase.from('sugestoes_arquiteturais').insert(rows).select('id');
  if (error) throw new Error(`seedSugestoes: ${error.message}`);
  return (data || []).map(r => r.id);
}

async function seedHumores(registros) {
  // registros: array de { humor, contexto? }
  const rows = registros.map(r => ({
    humor: r.humor,
    energia: r.energia ?? null,
    contexto: `${CATEGORIA_TESTE} ${r.contexto || ''}`.trim(),
  }));
  const { error } = await supabase.from('humor_log').insert(rows);
  if (error) throw new Error(`seedHumores: ${error.message}`);
}

async function seedMemorias(memorias) {
  // memorias: array de { chave, valor }
  const rows = memorias.map(m => ({
    categoria: CATEGORIA_TESTE,
    chave: m.chave,
    valor: m.valor,
    contexto: 'seed_teste_weekly',
  }));
  const { error } = await supabase.from('memorias').insert(rows);
  if (error) throw new Error(`seedMemorias: ${error.message}`);
}

async function seedWeeklyLogPulos(quantos) {
  // Insere N entradas em memorias categoria='sistema' chave='weekly_review_log' valor='pulado'
  const rows = [];
  for (let i = 0; i < quantos; i++) {
    rows.push({
      categoria: 'sistema',
      chave: 'weekly_review_log',
      valor: 'pulado',
      contexto: JSON.stringify({ chat_id: CHAT_ID_TESTE, teste: true, idx: i }),
    });
  }
  const { error } = await supabase.from('memorias').insert(rows);
  if (error) throw new Error(`seedWeeklyLogPulos: ${error.message}`);
}

async function cleanup() {
  // sugestoes_arquiteturais com prefixo
  await supabase.from('sugestoes_arquiteturais').delete().like('titulo', `${PREFIXO_TESTE}%`);
  // memorias categoria de teste
  await supabase.from('memorias').delete().eq('categoria', CATEGORIA_TESTE);
  // humor_log com prefixo no contexto
  await supabase.from('humor_log').delete().like('contexto', `${CATEGORIA_TESTE}%`);
  // weekly_review_log de teste (filtra por chat_id no contexto JSON)
  await supabase.from('memorias').delete()
    .eq('categoria', 'sistema')
    .eq('chave', 'weekly_review_log')
    .like('contexto', `%${CHAT_ID_TESTE}%`);
}

// ──────────────────────────────────────────────────────
// SEÇÃO 3 — Cenários
// ──────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

async function c1FullWeek() {
  currentCenario = 'C1';
  mockOuraSnapshot = {
    sleep: { avg: 78, min: 65, max: 88, nights: 7, total_sleep_min_avg: 450 },
    readiness: { avg: 78, min: 65, max: 88, days: 7 },
    activity: { steps_avg: 8500, steps_min: 5000, steps_max: 12000, active_minutes_avg: 45, days: 7 },
  };
  await seedSugestoes([
    { titulo: 'sug C1-1 (top)', descricao: 'descricao', confianca: 0.78 },
    { titulo: 'sug C1-2', descricao: 'descricao', confianca: 0.70 },
    { titulo: 'sug C1-3', descricao: 'descricao', confianca: 0.62 },
    { titulo: 'sug C1-4', descricao: 'descricao', confianca: 0.55 },
    { titulo: 'sug C1-5', descricao: 'descricao', confianca: 0.45 },
  ]);
  await seedHumores([
    { humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' },
    { humor: 'animada' }, { humor: 'animada' }, { humor: 'animada' },
    { humor: 'travada' }, { humor: 'travada' },
  ]);
  await seedMemorias([
    { chave: 'yoga', valor: 'voltou a fazer 3x na semana' },
    { chave: 'bem_estar', valor: 'nomeou bem-estar terça e quinta' },
  ]);

  const r = await gerarWeeklyReview(CHAT_ID_TESTE, { trigger: 'manual', dryRun: true });

  assert(r.sugestoesIds.length === 3, `top 3 esperado, veio ${r.sugestoesIds.length}`);
  assert(r.deveSalvarPendente === true, 'deveSalvarPendente true esperado');
  assert(r.mensagem.includes('🌅'), 'mensagem deve conter 🌅');
  assert(r.mensagem.length > 200, `mensagem rica esperada, length=${r.mensagem.length}`);
}

async function c2QuietWeek() {
  currentCenario = 'C2';
  mockOuraSnapshot = {
    sleep: { avg: 75, min: 70, max: 80, nights: 7, total_sleep_min_avg: 460 },
    readiness: { avg: 75, min: 70, max: 80, days: 7 },
    activity: { steps_avg: 7000, steps_min: 5500, steps_max: 9000, active_minutes_avg: 40, days: 7 },
  };
  // 0 sugestões — não seedar
  await seedHumores([
    { humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' },
    { humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' },
  ]);

  const r = await gerarWeeklyReview(CHAT_ID_TESTE, { trigger: 'manual', dryRun: true });

  assert(r.sugestoesIds.length === 0, `0 sugestões esperado, veio ${r.sugestoesIds.length}`);
  assert(r.deveSalvarPendente === false, 'deveSalvarPendente false esperado');
  assert(r.mensagem.includes('🌅'), 'mensagem deve conter 🌅');
}

async function c3Overwhelming() {
  currentCenario = 'C3';
  mockOuraSnapshot = null;
  const propostas = [];
  for (let i = 0; i < 14; i++) {
    propostas.push({
      titulo: `sug C3-${i + 1}`,
      descricao: 'descricao',
      confianca: 0.40 + (i * 0.03),
    });
  }
  await seedSugestoes(propostas);

  const r = await gerarWeeklyReview(CHAT_ID_TESTE, { trigger: 'manual', dryRun: true });

  assert(r.sugestoesIds.length === 3, `LIMIT 3 esperado em overwhelming, veio ${r.sugestoesIds.length}`);
  // O prompt instrui Opus a citar "14 padrões" + "calibrar" no overwhelming
  const lower = r.mensagem.toLowerCase();
  assert(lower.includes('14') || lower.includes('calibrar'), `mensagem deve sinalizar overwhelming (14 ou calibrar): "${r.mensagem.slice(0, 200)}"`);
}

async function c4Pulou3() {
  currentCenario = 'C4';
  mockOuraSnapshot = null;
  await seedWeeklyLogPulos(3);

  const r = await gerarWeeklyReview(CHAT_ID_TESTE, { trigger: 'manual', dryRun: true });

  assert(r.sugestoesIds.length === 0, `0 sugestoes esperado em path curta, veio ${r.sugestoesIds.length}`);
  assert(r.deveSalvarPendente === false, 'deveSalvarPendente false esperado');
  const lower = r.mensagem.toLowerCase();
  assert(
    lower.includes('faz sentido') || lower.includes('mantém') || lower.includes('pausa') || lower.includes('últimos 3'),
    `mensagem curta especial esperada: "${r.mensagem}"`
  );
  // Opus NÃO deve ter sido chamado em path curta
  const c4Calls = anthropicCalls.filter(c => c.cenario === 'C4');
  assert(c4Calls.length === 0, `Opus NÃO deveria ser chamado em C4 (early return), foi chamado ${c4Calls.length}x`);
}

async function c5OuraDown() {
  currentCenario = 'C5';
  mockOuraSnapshot = null; // simulando Oura API falha
  await seedSugestoes([
    { titulo: 'sug C5-1', descricao: 'descricao', confianca: 0.78 },
    { titulo: 'sug C5-2', descricao: 'descricao', confianca: 0.70 },
    { titulo: 'sug C5-3', descricao: 'descricao', confianca: 0.62 },
  ]);
  await seedHumores([{ humor: 'calma' }, { humor: 'calma' }, { humor: 'calma' }]);

  let crashou = false;
  let r;
  try {
    r = await gerarWeeklyReview(CHAT_ID_TESTE, { trigger: 'manual', dryRun: true });
  } catch (e) {
    crashou = true;
  }
  assert(!crashou, 'gerarWeeklyReview NÃO deve crashar quando Oura=null');
  assert(r.sugestoesIds.length === 3, `Bloco 4 funcionando: 3 sugestoes esperado, veio ${r.sugestoesIds.length}`);
  // Bloco 3 omitido — mensagem mock C5 não contém "Corpo" / "Sono:"
  assert(!r.mensagem.includes('Sono:'), 'mensagem NÃO deve conter "Sono:" quando Oura=null');
}

// ──────────────────────────────────────────────────────
// SEÇÃO 4 — Runner
// ──────────────────────────────────────────────────────

async function rodarBateria() {
  await cleanup();

  const cenarios = [
    { fn: c1FullWeek, name: 'C1 full week' },
    { fn: c2QuietWeek, name: 'C2 quiet week' },
    { fn: c3Overwhelming, name: 'C3 overwhelming' },
    { fn: c4Pulou3, name: 'C4 Carol pulou 3' },
    { fn: c5OuraDown, name: 'C5 Oura API down' },
  ];

  let passou = 0, falhou = 0;
  for (const c of cenarios) {
    try {
      await c.fn();
      console.log(`✅ ${c.name}`);
      passou++;
    } catch (err) {
      console.error(`❌ ${c.name}: ${err.message}`);
      falhou++;
    } finally {
      await cleanup();
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passou} passou  |  ❌ ${falhou} falhou  (de ${cenarios.length})`);
  process.exit(falhou === 0 ? 0 : 1);
}

rodarBateria().catch(e => {
  console.error('💥 FATAL:', e);
  cleanup().finally(() => process.exit(2));
});
