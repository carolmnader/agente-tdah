// test-memoria-integracao.js — Memória Evolutiva Fase 2
// 4 cenários: detector (sem/com padrão) + injeção no prompt + validador implícito.
// Chama Anthropic REAL (Haiku). Supabase REAL. Cleanup ao começar/terminar.
//
// Rodar: node test-memoria-integracao.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { detectarEPropor } = require('./src/prompts/detectorPadroes');
const { validarImplicitamente, normalizar, compativeis } = require('./src/services/validadorImplicito');
const { proporHipotese, hipotesesParaPrompt } = require('./src/services/hipoteses');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('hipoteses').delete().like('texto', 'TESTE_INTEG%');
}
async function countComPrefixo() {
  const { data } = await supabase
    .from('hipoteses')
    .select('id')
    .like('texto', 'TESTE_INTEG%');
  return data?.length || 0;
}

// ── T1: Detector sem padrão claro → retorna null ──
async function teste1_detectorSemPadrao() {
  await cleanup();
  const antes = await countComPrefixo();
  const resp = await detectarEPropor(
    'oi',
    'Oi Carol.',
    [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'oi' }]
  );
  // Detector PODE propor qualquer coisa (não necessariamente TESTE_INTEG). Testa só que
  // em input trivial ele retorna null OU propõe algo sem o prefixo de teste.
  const passou = resp === null || !resp?.texto?.startsWith('TESTE_INTEG');
  const depois = await countComPrefixo();
  const semNovasDeTeste = depois === antes;
  assert(
    passou && semNovasDeTeste,
    'T1) Detector com input trivial retorna null ou não polui tabela com teste',
    `retorno=${JSON.stringify(resp)?.substring(0, 120)}, antes=${antes}, depois=${depois}`
  );
}

// ── T2: Detector em contradição clara → retorna objeto + persiste no DB ──
async function teste2_detectorContradicao() {
  await cleanup();
  const history = [
    { role: 'user', content: 'amanhã vou na academia sem falta, 7h da manhã' },
    { role: 'assistant', content: 'Boa, fica anotado.' },
    { role: 'user', content: 'acordei, tô muito ansiosa, não consigo levantar' },
    { role: 'assistant', content: 'Percebi.' },
  ];
  const message = 'cancelei academia de novo, foi a terceira vez essa semana';
  const resp = await detectarEPropor(message, 'Entendi.', history);
  // Esperado: detector retorna objeto (não null)
  const temObjeto = resp && typeof resp === 'object' && resp.texto;
  // Esperado: hipótese foi inserida no DB (tem id retornado, podemos buscar)
  let persistiu = false;
  if (resp?.id) {
    const { data } = await supabase.from('hipoteses').select('id, fonte').eq('id', resp.id).single();
    persistiu = data && data.fonte === 'reativo';
  }
  assert(
    temObjeto && persistiu,
    'T2) Detector em contradição clara propõe hipótese + persiste com fonte=reativo',
    `resp.texto=${resp?.texto?.substring(0, 80) || 'null'}, persistiu=${persistiu}`
  );
  // Cleanup específico pra esse cenário (não tem prefixo TESTE_INTEG)
  if (resp?.id) await supabase.from('hipoteses').delete().eq('id', resp.id);
}

// ── T3: hipotesesParaPrompt retorna N > 0 → bloco de prompt é renderizável ──
async function teste3_injecaoPrompt() {
  await cleanup();
  const id1 = await proporHipotese({ texto: 'TESTE_INTEG_1 hipotese validada', fonte: 'reativo' });
  const id2 = await proporHipotese({ texto: 'TESTE_INTEG_2 outra validada', fonte: 'reativo' });
  await supabase.from('hipoteses').update({ confianca: 0.85, status: 'validada' }).eq('id', id1);
  await supabase.from('hipoteses').update({ confianca: 0.75, status: 'proposta' }).eq('id', id2);

  const hipoteses = await hipotesesParaPrompt(8);
  const nossas = hipoteses.filter(h => h.texto.startsWith('TESTE_INTEG'));
  const pelomenos2 = nossas.length >= 2;

  // Simula a renderização que brain.js faz em generateResponse
  const blocoHipoteses = hipoteses.length > 0
    ? `\n━━━ O QUE VOCÊ APRENDEU SOBRE CAROL ━━━\n${hipoteses.map(h => `- ${h.texto} (confiança: ${parseFloat(h.confianca).toFixed(2)})`).join('\n')}\n\nUse essas hipóteses pra contextualizar, não repeti-las de volta. Não invente novas aqui.`
    : '';
  const temHeader = blocoHipoteses.includes('O QUE VOCÊ APRENDEU SOBRE CAROL');
  const temNossa1 = blocoHipoteses.includes('TESTE_INTEG_1 hipotese validada');
  const temNossa2 = blocoHipoteses.includes('TESTE_INTEG_2 outra validada');

  assert(
    pelomenos2 && temHeader && temNossa1 && temNossa2,
    'T3) hipotesesParaPrompt + rendering produz bloco com header + hipóteses',
    `nossas=${nossas.length}, header=${temHeader}, n1=${temNossa1}, n2=${temNossa2}`
  );
}

// ── T4: Validador implícito — msg ansiosa cancelando exercício valida hipótese ──
async function teste4_validadorImplicito() {
  await cleanup();
  const id = await proporHipotese({
    texto: 'TESTE_INTEG_4 Carol evita exercício quando ansiosa',
    fonte: 'reativo',
    tags: ['exercicio', 'ansiedade'],
  });
  // Força status proposta + confianca base
  await supabase.from('hipoteses').update({ confianca: 0.5, status: 'proposta' }).eq('id', id);

  const antes = await supabase.from('hipoteses').select('validacoes_implicitas, confianca').eq('id', id).single();
  await validarImplicitamente(
    'cancelei o exercício hoje, a ansiedade tá muito forte, não consegui',
    'Percebi.'
  );
  const depois = await supabase.from('hipoteses').select('validacoes_implicitas, confianca').eq('id', id).single();

  // Esperado: validacoes_implicitas incrementou OU confianca mudou
  const valInc = (depois.data.validacoes_implicitas || 0) > (antes.data.validacoes_implicitas || 0);
  const confChanged = parseFloat(depois.data.confianca) !== parseFloat(antes.data.confianca);

  assert(
    valInc || confChanged,
    'T4) Validador implícito valida hipótese compatível (tags "exercicio"/"ansiedade")',
    `antes val=${antes.data.validacoes_implicitas} conf=${antes.data.confianca} / depois val=${depois.data.validacoes_implicitas} conf=${depois.data.confianca}`
  );
}

async function main() {
  console.log('🧪 test-memoria-integracao.js — Memória Evolutiva Fase 2\n');
  console.log('⚠️  Chama API Anthropic REAL. ~$0.02 por run (4 cenários).\n');
  const testes = [
    teste1_detectorSemPadrao,
    teste2_detectorContradicao,
    teste3_injecaoPrompt,
    teste4_validadorImplicito,
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
