// test-clientes-service-role.js — Commit 18 (segurança)
// Garante que os 10 clientes Supabase usam SUPABASE_SERVICE_ROLE_KEY (server-side)
// e NÃO usam mais SUPABASE_ANON_KEY. Pré-requisito pra ligar RLS sem quebrar o bot.
//
// SEAM: asserção ESTRUTURAL sobre o SOURCE via fs.readFileSync (mesmo idioma dos
// commits 15/16/17a) — não carrega os módulos (que puxariam supabase/anthropic/env),
// então 100% offline, sem API/DB/env.

const fs = require('fs');
const path = require('path');

const ARQUIVOS = [
  'src/prompts/detectorPadroes.js',
  'src/services/analiseNoturna.js',
  'src/services/analytics.js',
  'src/services/crm.js',
  'src/services/detectarPerformaSubjetividade.js',
  'src/services/eventosNotificados.js',
  'src/services/hipoteses.js',
  'src/services/memorySupabase.js',
  'src/services/sugestoes.js',
  'src/services/validadorImplicito.js',
];

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

for (const rel of ARQUIVOS) {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  check(`${rel} usa SUPABASE_SERVICE_ROLE_KEY`, src.includes('process.env.SUPABASE_SERVICE_ROLE_KEY'), rel);
  check(`${rel} NÃO usa mais SUPABASE_ANON_KEY`, !src.includes('SUPABASE_ANON_KEY'), rel);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
