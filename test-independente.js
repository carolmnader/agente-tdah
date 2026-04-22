// test-independente.js — Bloco 2 (notificação de aprendizado)
// Testa buscarAprendizadosNaoNotificados + marcarComoNotificadas.
// Cleanup: DELETE WHERE texto LIKE 'TESTE_INDEP_%'.
//
// Rodar: node test-independente.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { buscarAprendizadosNaoNotificados, marcarComoNotificadas } = require('./src/services/hipoteses');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup() {
  await supabase.from('hipoteses').delete().like('texto', 'TESTE_INDEP_%');
}

async function inserir({ texto, status, confianca, notificado_em = null }) {
  const { data, error } = await supabase.from('hipoteses').insert({
    texto, fonte: 'reativo', confianca, status, notificado_em,
  }).select('id').single();
  if (error) throw new Error(`insert: ${error.message}`);
  return data.id;
}

// ── T1: filtro só validada + não-notificada ──
async function teste1_filtro() {
  await cleanup();
  await inserir({ texto: 'TESTE_INDEP_T1_validada_notificada', status: 'validada', confianca: 0.85, notificado_em: new Date().toISOString() });
  const idAlvo = await inserir({ texto: 'TESTE_INDEP_T1_validada_naonotif', status: 'validada', confianca: 0.85 });
  await inserir({ texto: 'TESTE_INDEP_T1_proposta_naonotif', status: 'proposta', confianca: 0.85 });

  const r = await buscarAprendizadosNaoNotificados(10);
  const meus = r.filter(h => h.texto?.startsWith('TESTE_INDEP_T1_'));
  assert(
    meus.length === 1 && meus[0].id === idAlvo,
    'T1) Filtro: só retorna validada AND notificado_em IS NULL',
    `meus=${JSON.stringify(meus.map(m => m.texto))}`
  );
}

// ── T2: ordem por confiança DESC ──
async function teste2_ordem() {
  await cleanup();
  await inserir({ texto: 'TESTE_INDEP_T2_conf07', status: 'validada', confianca: 0.7 });
  await inserir({ texto: 'TESTE_INDEP_T2_conf09', status: 'validada', confianca: 0.9 });
  await inserir({ texto: 'TESTE_INDEP_T2_conf08', status: 'validada', confianca: 0.8 });

  const r = await buscarAprendizadosNaoNotificados(10);
  const meus = r.filter(h => h.texto?.startsWith('TESTE_INDEP_T2_'));
  assert(
    meus.length === 3 &&
    meus[0].texto === 'TESTE_INDEP_T2_conf09' &&
    meus[1].texto === 'TESTE_INDEP_T2_conf08' &&
    meus[2].texto === 'TESTE_INDEP_T2_conf07',
    'T2) Ordem: por confianca DESC (0.9 → 0.8 → 0.7)',
    `ordem=${meus.map(m => m.texto).join(' | ')}`
  );
}

// ── T3: limite respeita parâmetro ──
async function teste3_limite() {
  await cleanup();
  for (let i = 1; i <= 5; i++) {
    await inserir({ texto: `TESTE_INDEP_T3_${i}`, status: 'validada', confianca: 0.85 });
  }
  const r = await buscarAprendizadosNaoNotificados(2);
  const meus = r.filter(h => h.texto?.startsWith('TESTE_INDEP_T3_'));
  assert(
    r.length === 2,
    'T3) Limite: buscarAprendizadosNaoNotificados(2) retorna exatamente 2',
    `r.length=${r.length}, meus=${meus.length}`
  );
}

// ── T4: marcarComoNotificadas atualiza timestamp ──
async function teste4_marcar() {
  await cleanup();
  const id1 = await inserir({ texto: 'TESTE_INDEP_T4_a', status: 'validada', confianca: 0.85 });
  const id2 = await inserir({ texto: 'TESTE_INDEP_T4_b', status: 'validada', confianca: 0.85 });

  const ret = await marcarComoNotificadas([id1, id2]);
  const { data } = await supabase
    .from('hipoteses').select('id, notificado_em').in('id', [id1, id2]);
  const ambasNotificadas = data?.length === 2 && data.every(h => h.notificado_em !== null);
  assert(
    ret.count === 2 && ambasNotificadas,
    'T4) marcarComoNotificadas atualiza notificado_em em ambas',
    `ret=${JSON.stringify(ret)}, dataState=${JSON.stringify(data)}`
  );
}

async function main() {
  console.log('🧪 test-independente.js — Bloco 2 (notificação aprendizado)\n');
  const testes = [teste1_filtro, teste2_ordem, teste3_limite, teste4_marcar];
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
