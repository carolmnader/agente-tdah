// test-micropraticas.js — Commit 3 (biblioteca curada de micro-práticas)
// Determinístico, sem Supabase nem Anthropic.
//
// Rodar: node test-micropraticas.js
const { MICROPRATICAS } = require('./src/data/micropraticas');
const { listarMicropraticas, sugerirMicropratica, formatarMicropratica } = require('./src/services/micropraticas');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// T1) Sem filtro retorna a biblioteca inteira (~18)
function teste1_listarSemFiltro() {
  const r = listarMicropraticas();
  assert(
    r.length === MICROPRATICAS.length && r.length >= 18,
    'T1) listarMicropraticas() sem filtro retorna a biblioteca inteira',
    `length=${r.length} (esperado ${MICROPRATICAS.length})`
  );
}

// T2) Filtro por categoria 'luz' retorna apenas práticas de luz
function teste2_filtroCategoria() {
  const r = listarMicropraticas({ categoria: 'luz' });
  const esperadas = MICROPRATICAS.filter(p => p.categoria === 'luz').length;
  assert(
    r.length === esperadas && r.every(p => p.categoria === 'luz') && r.length >= 2,
    'T2) listarMicropraticas({categoria:luz}) retorna só categoria luz',
    `length=${r.length}, esperado=${esperadas}`
  );
}

// T3) sugerirMicropratica({hora:8}) retorna prática com tag 'manha'
function teste3_horaManha() {
  const r = sugerirMicropratica({ hora: 8 });
  assert(
    r && r.tags.includes('manha'),
    'T3) sugerirMicropratica({hora:8}) tem tag manha',
    `r=${r ? r.id : 'null'}, tags=${r?.tags?.join(',')}`
  );
}

// T4) sugerirMicropratica({hora:23}) NÃO retorna luz natural manhã
function teste4_horaNoiteSemLuzManha() {
  // Roda várias vezes pra garantir (seed diário pode dar mesmo resultado)
  for (let i = 0; i < 5; i++) {
    const r = sugerirMicropratica({ hora: 23 });
    if (r && r.id === 'luz-natural-manha') {
      failed++;
      console.log(`❌ T4) hora 23h retornou luz-natural-manha (não tem tag noite)`);
      return;
    }
  }
  passed++;
  console.log(`✅ T4) sugerirMicropratica({hora:23}) nunca retorna luz-natural-manha`);
}

// T5) Excluir todos ids do horário tarde retorna null
function teste5_ultimasUsadasEsgotam() {
  const todasTarde = MICROPRATICAS.filter(p => p.tags.includes('tarde')).map(p => p.id);
  const r = sugerirMicropratica({ hora: 14, ultimasUsadas: todasTarde });
  assert(
    r === null,
    'T5) ultimasUsadas com TODOS ids de tarde → retorna null',
    `r=${r ? r.id : 'null'} (esperado null), todasTarde.length=${todasTarde.length}`
  );
}

// T6) formatarMicropratica retorna string com nome, descricao, duracao e fonte
function teste6_formatar() {
  const p = MICROPRATICAS[0]; // luz-natural-manha
  const s = formatarMicropratica(p);
  assert(
    s.includes(p.nome) && s.includes(p.descricao) && s.includes(String(p.duracao_min)) && s.includes(p.fonte) && s.startsWith('🌱'),
    'T6) formatarMicropratica inclui nome, descricao, duracao, fonte e marcador 🌱',
    `s="${s.substring(0, 200)}"`
  );
}

function main() {
  console.log('🧪 test-micropraticas.js — Commit 3 (biblioteca curada)\n');
  const testes = [teste1_listarSemFiltro, teste2_filtroCategoria, teste3_horaManha, teste4_horaNoiteSemLuzManha, teste5_ultimasUsadasEsgotam, teste6_formatar];
  for (const t of testes) {
    try { t(); }
    catch (e) { failed++; console.log(`❌ ${t.name} — erro: ${e.message}`); }
  }
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
