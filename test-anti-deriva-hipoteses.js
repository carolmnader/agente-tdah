// test-anti-deriva-hipoteses.js — Commit 15 (anti-deriva, parte 1)
// Garante que (1) o prompt reativo NÃO realimenta mais hipóteses e (2) a geração
// está decomissionada (gated por env, default off).
//
// SEAM: asserção ESTRUTURAL sobre o SOURCE de brain.js via fs.readFileSync —
// não carrega o módulo (que puxaria supabase/anthropic/env), então é 100%
// offline, sem API/DB/env. Não refatora brain.js só pra testar.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/services/brain.js'), 'utf8');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// ── AÇÃO 1: wire-cut (hipóteses fora do prompt reativo) ──────────────────────
check('D1) brain.js NÃO contém o header "O QUE VOCÊ APRENDEU SOBRE CAROL"',
  !src.includes('O QUE VOCÊ APRENDEU SOBRE CAROL'));
check('D2) brain.js NÃO chama hipotesesParaPrompt(',
  !src.includes('hipotesesParaPrompt('));
check('D3) systemWithMemory não interpola ${blocoHipoteses}',
  !src.includes('${blocoHipoteses}'));

// ── AÇÃO 2: geração decomissionada (gated por env, default off) ──────────────
check('D4) gate ARIA_GERAR_HIPOTESES presente',
  src.includes("process.env.ARIA_GERAR_HIPOTESES === 'on'"));
const gateIdx = src.indexOf("ARIA_GERAR_HIPOTESES === 'on'");
const callIdx = src.indexOf('detectarEPropor(message');
check('D5) detectarEPropor(message) está logo após o gate (gated, não solto)',
  gateIdx > 0 && callIdx > gateIdx && (callIdx - gateIdx) < 200,
  `gateIdx=${gateIdx} callIdx=${callIdx}`);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
