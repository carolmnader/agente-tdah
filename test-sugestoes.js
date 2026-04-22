// test-sugestoes.js — Bloco 3 (Auto-aperfeiçoamento Nível 2)
// Testa proporSugestao + listarSugestoesAbertas + marcarStatus.
// Cleanup: DELETE WHERE titulo LIKE 'TESTE_SUG_%'.
//
// Rodar: node test-sugestoes.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { proporSugestao, listarSugestoesAbertas, marcarStatus } = require('./src/services/sugestoes');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('sugestoes_arquiteturais').delete().like('titulo', 'TESTE_SUG_%');
}

// ── T1: proporSugestao cria registro válido ──
async function teste1_criar() {
  await cleanup();
  const s = await proporSugestao({
    titulo: 'TESTE_SUG_T1',
    descricao: 'descrição qualquer',
    categoria: 'feature',
    prioridade: 3,
    confianca: 0.6,
    origem: 'teste',
  });
  const { data } = await supabase
    .from('sugestoes_arquiteturais').select('status').eq('id', s.id).single();
  assert(
    s?.id && data?.status === 'proposta',
    'T1) proporSugestao cria registro com status default proposta',
    `s=${JSON.stringify(s)}, status=${data?.status}`
  );
}

// ── T2: categoria inválida → erro ──
async function teste2_categoriaInvalida() {
  await cleanup();
  let erro = null;
  try {
    await proporSugestao({
      titulo: 'TESTE_SUG_T2',
      descricao: 'x',
      categoria: 'inventada',
      origem: 'teste',
    });
  } catch (e) { erro = e; }
  assert(
    erro !== null,
    'T2) proporSugestao rejeita categoria inválida (CHECK)',
    `erro=${erro?.message || 'nenhum'}`
  );
}

// ── T3: prioridade fora de range → erro ──
async function teste3_prioridadeRange() {
  await cleanup();
  let erro = null;
  try {
    await proporSugestao({
      titulo: 'TESTE_SUG_T3',
      descricao: 'x',
      categoria: 'bug',
      prioridade: 10,
      origem: 'teste',
    });
  } catch (e) { erro = e; }
  assert(
    erro !== null,
    'T3) proporSugestao rejeita prioridade fora de 1-5 (CHECK)',
    `erro=${erro?.message || 'nenhum'}`
  );
}

// ── T4: listarSugestoesAbertas filtra e ordena ──
async function teste4_listar() {
  await cleanup();
  const s1 = await proporSugestao({ titulo: 'TESTE_SUG_T4_a', descricao: 'x', categoria: 'feature', origem: 'teste' });
  await new Promise(r => setTimeout(r, 50));
  const s2 = await proporSugestao({ titulo: 'TESTE_SUG_T4_b', descricao: 'x', categoria: 'feature', origem: 'teste' });
  await new Promise(r => setTimeout(r, 50));
  const s3 = await proporSugestao({ titulo: 'TESTE_SUG_T4_c', descricao: 'x', categoria: 'feature', origem: 'teste' });
  const sRej = await proporSugestao({ titulo: 'TESTE_SUG_T4_rej', descricao: 'x', categoria: 'feature', origem: 'teste' });
  await marcarStatus(sRej.id, 'rejeitada');

  const r = await listarSugestoesAbertas(50);
  const meus = r.filter(s => s.titulo?.startsWith('TESTE_SUG_T4_'));
  assert(
    meus.length === 3 &&
    meus[0].id === s3.id &&
    meus[1].id === s2.id &&
    meus[2].id === s1.id,
    'T4) listarSugestoesAbertas retorna só proposta, mais nova primeiro',
    `meus.length=${meus.length}, ordem=${meus.map(m => m.titulo).join(' | ')}`
  );
}

// ── T5: marcarStatus sucesso + erro ──
async function teste5_marcarStatus() {
  await cleanup();
  const s = await proporSugestao({
    titulo: 'TESTE_SUG_T5', descricao: 'x', categoria: 'refactor', origem: 'teste',
  });
  const up = await marcarStatus(s.id, 'aceita');
  let erro = null;
  try {
    await marcarStatus(s.id, 'lixo');
  } catch (e) { erro = e; }
  assert(
    up?.status === 'aceita' && erro !== null,
    'T5) marcarStatus atualiza válido e rejeita inválido',
    `up=${JSON.stringify(up)}, erro=${erro?.message || 'nenhum'}`
  );
}

async function main() {
  console.log('🧪 test-sugestoes.js — Bloco 3 (Auto-aperfeiçoamento)\n');
  const testes = [teste1_criar, teste2_categoriaInvalida, teste3_prioridadeRange, teste4_listar, teste5_marcarStatus];
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
