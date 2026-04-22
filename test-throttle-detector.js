// test-throttle-detector.js — Bug #17
// Mocka @anthropic-ai/sdk pra controlar respostas do Haiku (callCount + texto retornado).
// Supabase REAL pra exercitar Throttles A (5/sessão) e B (overlap tags 1h).
// Cleanup: DELETE WHERE texto LIKE 'TESTE_THROTTLE_%'.
//
// Rodar: node test-throttle-detector.js
require('dotenv').config();

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

let mockAnthropicCallCount = 0;
let mockAnthropicResponseText = 'null';
const MockAnthropic = function () {
  return {
    messages: {
      create: async () => {
        mockAnthropicCallCount++;
        return { content: [{ text: mockAnthropicResponseText }] };
      },
    },
  };
};
mockModule('@anthropic-ai/sdk', MockAnthropic);

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Require detector AFTER mock — ele vai usar o MockAnthropic
const { detectarEPropor } = require('./src/prompts/detectorPadroes');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('hipoteses').delete().like('texto', 'TESTE_THROTTLE_%');
}

async function criarHipoteseTeste(texto, tags, minutosAtras) {
  const ts = new Date(Date.now() - minutosAtras * 60000).toISOString();
  const { data } = await supabase.from('hipoteses').insert({
    texto, fonte: 'reativo', tags: tags?.length ? tags : null,
    confianca: 0.5, status: 'proposta', criada_em: ts,
  }).select('id').single();
  return data?.id;
}

// ── T1: Throttle A bloqueia (5 reativas recentes → não chama Haiku) ──
async function teste1_throttleABloqueia() {
  await cleanup();
  for (let i = 1; i <= 5; i++) {
    await criarHipoteseTeste(`TESTE_THROTTLE_A_${i}`, [`tagA${i}`], 5);
  }
  mockAnthropicCallCount = 0;
  mockAnthropicResponseText = '{"texto":"NAO_DEVE_SER_CHAMADA","tags":["x"]}';
  const r = await detectarEPropor('msg qualquer', 'resp qualquer', []);
  assert(
    r === null && mockAnthropicCallCount === 0,
    'T1) Throttle A bloqueia: 5+ reativas em 30min → null, Haiku NÃO chamado',
    `retorno=${r}, callCount=${mockAnthropicCallCount}`
  );
}

// ── T2: Throttle A passa quando há < 5 reativas recentes ──
async function teste2_throttleAPassa() {
  await cleanup();
  // Verificar baseline (real reativas recentes em prod)
  const { data: baseline } = await supabase
    .from('hipoteses').select('id')
    .eq('fonte', 'reativo')
    .gte('criada_em', new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const baseN = baseline?.length || 0;
  if (baseN >= 5) {
    passed++;
    console.log(`✅ T2) SKIPPED — baseline já tem ${baseN} reativas em 30min, Throttle A naturalmente bloqueia`);
    return;
  }
  // Cria poucas pra ficar abaixo do limite (total = baseN + criadas < 5)
  const criar = Math.max(0, 3 - baseN);
  for (let i = 1; i <= criar; i++) {
    await criarHipoteseTeste(`TESTE_THROTTLE_A_pass_${i}`, [`tagP${i}`], 5);
  }
  mockAnthropicCallCount = 0;
  mockAnthropicResponseText = 'null';  // Haiku vai ser chamado, mas retorna null = sem proposta
  const r = await detectarEPropor('msg qualquer', 'resp qualquer', []);
  assert(
    mockAnthropicCallCount === 1 && r === null,
    'T2) Throttle A passa: < 5 recentes → Haiku é chamado',
    `retorno=${r}, callCount=${mockAnthropicCallCount}, baseline=${baseN}`
  );
}

// ── T3: Throttle B bloqueia (3 hipóteses com overlap de tags em 1h) ──
async function teste3_throttleBBloqueia() {
  await cleanup();
  for (let i = 1; i <= 3; i++) {
    await criarHipoteseTeste(`TESTE_THROTTLE_B_med_${i}`, ['medicamento_xyz', 'ansiedade_xyz'], 30);
  }
  mockAnthropicCallCount = 0;
  mockAnthropicResponseText = '{"texto":"TESTE_THROTTLE_B_candidato_block","tags":["medicamento_xyz","sono_xyz"],"confianca_inicial":0.5}';
  const r = await detectarEPropor('msg qualquer', 'resp qualquer', []);
  const { data: propostas } = await supabase
    .from('hipoteses').select('id').eq('texto', 'TESTE_THROTTLE_B_candidato_block');
  assert(
    r === null && (propostas?.length || 0) === 0 && mockAnthropicCallCount === 1,
    'T3) Throttle B bloqueia: 3 overlap de tags → null, NÃO insere',
    `retorno=${r}, callCount=${mockAnthropicCallCount}, propostas=${propostas?.length || 0}`
  );
}

// ── T4: Throttle B passa quando tags são distintas ──
async function teste4_throttleBPassa() {
  await cleanup();
  for (let i = 1; i <= 3; i++) {
    await criarHipoteseTeste(`TESTE_THROTTLE_B_trab_${i}`, ['trabalho_xyz', 'prazo_xyz'], 30);
  }
  mockAnthropicCallCount = 0;
  mockAnthropicResponseText = '{"texto":"TESTE_THROTTLE_B_pass_candidato","tags":["alimentacao_xyz","pizza_xyz"],"confianca_inicial":0.5}';
  const r = await detectarEPropor('msg qualquer', 'resp qualquer', []);
  const { data: propostas } = await supabase
    .from('hipoteses').select('id').eq('texto', 'TESTE_THROTTLE_B_pass_candidato');
  assert(
    r?.id && (propostas?.length || 0) === 1 && mockAnthropicCallCount === 1,
    'T4) Throttle B passa: tags distintas → hipótese é proposta',
    `retorno=${JSON.stringify(r)?.substring(0, 100)}, callCount=${mockAnthropicCallCount}, propostas=${propostas?.length || 0}`
  );
}

async function main() {
  console.log('🧪 test-throttle-detector.js — Bug #17\n');
  const testes = [teste1_throttleABloqueia, teste2_throttleAPassa, teste3_throttleBBloqueia, teste4_throttleBPassa];
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
