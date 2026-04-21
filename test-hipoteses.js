// test-hipoteses.js — memória evolutiva Fase 1
// Usa tabela real do Supabase (hipoteses). Cleanup: DELETE WHERE texto LIKE 'TESTE_%'.
//
// Rodar: node test-hipoteses.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const {
  proporHipotese, validarHipotese, refutarHipotese, recalcularConfianca,
  hipotesesParaPrompt, buscarHipotesesRelevantes,
} = require('./src/services/hipoteses');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('hipoteses').delete().like('texto', 'TESTE_%');
}
async function fetchHipotese(id) {
  const { data } = await supabase.from('hipoteses').select('*').eq('id', id).single();
  return data;
}

// ── T1: proporHipotese cria registro ──
async function teste1_propor() {
  await cleanup();
  const id = await proporHipotese({
    texto: 'TESTE_1 padrão fictício', fonte: 'reativo',
    contexto: 'contexto teste', tags: ['teste', 'fase1'],
  });
  const h = await fetchHipotese(id);
  const passou = parseFloat(h.confianca) === 0.50
    && h.status === 'proposta'
    && h.fonte === 'reativo'
    && h.texto === 'TESTE_1 padrão fictício';
  assert(passou, 'T1) proporHipotese cria com confianca 0.50 + status proposta',
    `confianca=${h.confianca}, status=${h.status}, fonte=${h.fonte}, tags=${JSON.stringify(h.tags)}`);
}

// ── T2: 3 validações explícitas → validada ──
async function teste2_validacaoPromove() {
  await cleanup();
  const id = await proporHipotese({ texto: 'TESTE_2 validada', fonte: 'reativo' });
  await validarHipotese(id, { tipo: 'explicita' });
  await validarHipotese(id, { tipo: 'explicita' });
  await validarHipotese(id, { tipo: 'explicita' });
  const h = await fetchHipotese(id);
  // Esperado: 0.50 + 3*0.15 = 0.95
  const passou = parseFloat(h.confianca) >= 0.80 && h.status === 'validada';
  assert(passou, 'T2) 3 validações explícitas → confianca >= 0.80 + status validada',
    `confianca=${h.confianca}, status=${h.status}`);
}

// ── T3: 2 refutações explícitas → refutada ──
async function teste3_refutacaoPromove() {
  await cleanup();
  const id = await proporHipotese({ texto: 'TESTE_3 refutada', fonte: 'reativo' });
  await refutarHipotese(id, { tipo: 'explicita' });
  await refutarHipotese(id, { tipo: 'explicita' });
  const h = await fetchHipotese(id);
  // Esperado: 0.50 - 2*0.25 = 0.00
  const passou = parseFloat(h.confianca) < 0.30 && h.status === 'refutada';
  assert(passou, 'T3) 2 refutações explícitas → confianca < 0.30 + status refutada',
    `confianca=${h.confianca}, status=${h.status}`);
}

// ── T4: Decaimento temporal ──
async function teste4_decaimento() {
  await cleanup();
  const id = await proporHipotese({ texto: 'TESTE_4 decai', fonte: 'reativo' });
  const passado = new Date(Date.now() - 40 * 86400000).toISOString();
  await supabase.from('hipoteses')
    .update({ criada_em: passado, ultima_validacao: null })
    .eq('id', id);
  await recalcularConfianca(id);
  const h = await fetchHipotese(id);
  // Esperado: 0.50 - 0.01 * (40/7) ≈ 0.443
  const c = parseFloat(h.confianca);
  const passou = c < 0.50 && c > 0.30;
  assert(passou, 'T4) Decaimento temporal reduz confianca (~0.44 esperado)',
    `confianca=${h.confianca}`);
}

// ── T5: hipotesesParaPrompt filtra por confianca >= 0.6 ──
async function teste5_paraPrompt() {
  await cleanup();
  const id5a = await proporHipotese({ texto: 'TESTE_5a alta', fonte: 'reativo' });
  const id5b = await proporHipotese({ texto: 'TESTE_5b media', fonte: 'reativo' });
  const id5c = await proporHipotese({ texto: 'TESTE_5c baixa', fonte: 'reativo' });
  await supabase.from('hipoteses').update({ confianca: 0.85, status: 'validada' }).eq('id', id5a);
  await supabase.from('hipoteses').update({ confianca: 0.65, status: 'proposta' }).eq('id', id5b);
  await supabase.from('hipoteses').update({ confianca: 0.45, status: 'proposta' }).eq('id', id5c);

  const lista = await hipotesesParaPrompt();
  const nossas = lista.filter(h => h.texto.startsWith('TESTE_5')).map(h => h.texto);
  const passou = nossas.length === 2
    && nossas[0] === 'TESTE_5a alta'
    && nossas[1] === 'TESTE_5b media';
  assert(passou, 'T5) hipotesesParaPrompt retorna só >= 0.6 em ordem decrescente',
    `nossas=${JSON.stringify(nossas)}`);
}

// ── T6: buscarHipotesesRelevantes usa overlap de tags ──
async function teste6_relevantes() {
  await cleanup();
  await proporHipotese({ texto: 'TESTE_6a', fonte: 'reativo', tags: ['archicad', 'ansiedade'] });
  await proporHipotese({ texto: 'TESTE_6b', fonte: 'reativo', tags: ['sono'] });
  await proporHipotese({ texto: 'TESTE_6c', fonte: 'reativo', tags: ['archicad'] });

  const lista = await buscarHipotesesRelevantes(['archicad']);
  const nossas = lista.filter(h => h.texto.startsWith('TESTE_6')).map(h => h.texto).sort();
  const passou = nossas.length === 2
    && nossas.includes('TESTE_6a')
    && nossas.includes('TESTE_6c')
    && !nossas.includes('TESTE_6b');
  assert(passou, 'T6) buscarHipotesesRelevantes filtra por overlap de tags',
    `nossas=${JSON.stringify(nossas)}`);
}

async function main() {
  console.log('🧪 test-hipoteses.js — memória evolutiva Fase 1\n');
  const testes = [
    teste1_propor, teste2_validacaoPromove, teste3_refutacaoPromove,
    teste4_decaimento, teste5_paraPrompt, teste6_relevantes,
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
