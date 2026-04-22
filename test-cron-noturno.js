// test-cron-noturno.js — Memória Evolutiva Fase 3
// 5 cenários: decaimento global, análise real, dia vazio, hipóteses no prompt, erro Haiku.
// T2/T3 chamam Anthropic REAL. T5 mocka anthropic via require.cache.
//
// Rodar: node test-cron-noturno.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('hipoteses').delete().like('texto', 'TESTE_CRON_%');
}

// ── T1: aplicarDecaimentoGlobal recalcula >=3 hipóteses ──
async function teste1_decaimentoGlobal() {
  await cleanup();
  const { proporHipotese, aplicarDecaimentoGlobal } = require('./src/services/hipoteses');
  await proporHipotese({ texto: 'TESTE_CRON_1', fonte: 'reativo' });
  await proporHipotese({ texto: 'TESTE_CRON_2', fonte: 'reativo' });
  await proporHipotese({ texto: 'TESTE_CRON_3', fonte: 'reativo' });
  const count = await aplicarDecaimentoGlobal();
  assert(count >= 3,
    'T1) aplicarDecaimentoGlobal recalcula >= 3 hipóteses ativas',
    `count=${count} (esperado >= 3)`);
}

// ── T2: chamarAnaliseNoturna com dados reais retorna estrutura válida ──
async function teste2_analiseRealData() {
  const { chamarAnaliseNoturna } = require('./src/prompts/analiseNoturna');
  const r = await chamarAnaliseNoturna({
    mensagens: '[user] tô cansada\n[assistant] Percebi.\n[user] cancelei a reunião de novo',
    humor: '2026-04-21 cansada\n2026-04-22 cansada',
    eventos: 'sem eventos hoje',
    hipotesesExistentes: '(nenhuma)',
  });
  assert(
    r && Array.isArray(r.hipoteses_novas) && r.hipoteses_novas.length <= 3,
    'T2) chamarAnaliseNoturna com dados reais retorna estrutura válida (array com <=3)',
    `retorno=${JSON.stringify(r)?.substring(0, 200)}`
  );
}

// ── T3: dia vazio → retorna {hipoteses_novas: []} (ou pelo menos array) ──
async function teste3_diaVazio() {
  const { chamarAnaliseNoturna } = require('./src/prompts/analiseNoturna');
  const r = await chamarAnaliseNoturna({
    mensagens: null, humor: null, eventos: null, hipotesesExistentes: null,
  });
  assert(
    r && Array.isArray(r.hipoteses_novas),
    'T3) Dia vazio retorna estrutura válida (hipoteses_novas é array)',
    `retorno=${JSON.stringify(r)?.substring(0, 200)}`
  );
}

// ── T4: Hipóteses cadastradas entram na string que vai pro prompt ──
async function teste4_hipotesesNoPrompt() {
  await cleanup();
  const { proporHipotese } = require('./src/services/hipoteses');
  const { buscarHipotesesCadastradas } = require('./src/services/analiseNoturna');
  const id = await proporHipotese({ texto: 'TESTE_CRON_HIP_NO_PROMPT', fonte: 'reativo' });
  // Força confianca=0.99 pra garantir que aparece no top 20 (DB já tem várias hipóteses reais)
  await supabase.from('hipoteses').update({ confianca: 0.99 }).eq('id', id);
  const hipsStr = await buscarHipotesesCadastradas();
  assert(
    hipsStr && hipsStr.includes('TESTE_CRON_HIP_NO_PROMPT'),
    'T4) buscarHipotesesCadastradas inclui a hipótese recém-criada',
    `hipsStr (preview)=${(hipsStr || '').substring(0, 300)}`
  );
}

// ── T5: Erro do Haiku é silenciado, retorna {hipoteses_novas: []} ──
// Usa require.cache pra mockar @anthropic-ai/sdk DEPOIS dos outros testes.
async function teste5_erroHaiku() {
  // Limpar cache do prompt + sdk pra forçar reload com mock
  delete require.cache[require.resolve('@anthropic-ai/sdk')];
  delete require.cache[require.resolve('./src/prompts/analiseNoturna')];

  // Mock que sempre lança erro
  const FailingAnthropic = function () {
    return { messages: { create: async () => { throw new Error('forced error for test'); } } };
  };
  const resolved = require.resolve('@anthropic-ai/sdk');
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: FailingAnthropic, children: [], paths: [] };

  const { chamarAnaliseNoturna: chamarComMock } = require('./src/prompts/analiseNoturna');
  const r = await chamarComMock({ mensagens: 'x', humor: null, eventos: null, hipotesesExistentes: null });
  assert(
    r && Array.isArray(r.hipoteses_novas) && r.hipoteses_novas.length === 0,
    'T5) Erro do Haiku silenciado, retorna {hipoteses_novas: []}',
    `retorno=${JSON.stringify(r)}`
  );
}

async function main() {
  console.log('🧪 test-cron-noturno.js — Memória Evolutiva Fase 3\n');
  console.log('⚠️  T2/T3 chamam API Anthropic REAL. ~$0.01 por run.\n');
  // IMPORTANTE: T5 mocka anthropic — deve ser ÚLTIMO.
  const testes = [
    teste1_decaimentoGlobal,
    teste2_analiseRealData,
    teste3_diaVazio,
    teste4_hipotesesNoPrompt,
    teste5_erroHaiku,
  ];
  for (const t of testes) {
    try { await t(); }
    catch (e) { failed++; console.log(`❌ ${t.name} — erro: ${e.message}`); }
  }
  await cleanup();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async e => {
  console.error('💥 erro fatal:', e);
  await cleanup();
  process.exit(1);
});
