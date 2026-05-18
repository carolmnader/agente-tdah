// Teste do Bug #22 (deduplicação de notificações pré-evento).
// Valida tentarMarcarNotificado: 1ª chamada true, 2ª false (PK conflict),
// tipos diferentes do mesmo evento são independentes.
//
// Rodar: node test-eventos-notificados.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { tentarMarcarNotificado } = require('./src/services/eventosNotificados');

const TEST_IDS = ['TESTE_DEDUP_1', 'TESTE_DEDUP_2', 'TESTE_DEDUP_3'];

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

async function cleanup(eventoId) {
  await supabase.from('eventos_notificados').delete().eq('evento_id', eventoId);
}

async function run() {
  for (const id of TEST_IDS) await cleanup(id);

  try {
    // ── C1: 1ª chamada retorna true ──
    const r1 = await tentarMarcarNotificado('TESTE_DEDUP_1');
    assert(r1 === true, 'C1) 1ª chamada retorna true (deve notificar)', `r1=${r1}`);
    await cleanup('TESTE_DEDUP_1');

    // ── C2: 2ª chamada retorna false (PK conflict) ──
    const r2a = await tentarMarcarNotificado('TESTE_DEDUP_2');
    const r2b = await tentarMarcarNotificado('TESTE_DEDUP_2');
    assert(
      r2a === true && r2b === false,
      'C2) 2ª chamada retorna false (já notificado, PK conflict)',
      `r2a=${r2a}, r2b=${r2b}`
    );
    await cleanup('TESTE_DEDUP_2');

    // ── C3: tipos diferentes do mesmo evento são independentes ──
    const r3a = await tentarMarcarNotificado('TESTE_DEDUP_3', 'pre_evento_30min');
    const r3b = await tentarMarcarNotificado('TESTE_DEDUP_3', 'pre_evento_5min');
    const r3c = await tentarMarcarNotificado('TESTE_DEDUP_3', 'pre_evento_30min');
    assert(
      r3a === true && r3b === true && r3c === false,
      'C3) Tipos diferentes do mesmo evento_id são independentes',
      `r3a=${r3a} (30min novo), r3b=${r3b} (5min novo), r3c=${r3c} (30min repetido)`
    );
    await cleanup('TESTE_DEDUP_3');

  } finally {
    for (const id of TEST_IDS) await cleanup(id);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async e => {
  console.error('💥 erro fatal:', e);
  for (const id of TEST_IDS) await cleanup(id).catch(() => {});
  process.exit(1);
});
