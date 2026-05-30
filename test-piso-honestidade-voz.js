// test-piso-honestidade-voz.js — Commit 17 (anti-deriva, parte 3a/3)
// Garante que o PISO DE HONESTIDADE DE VÍNCULO está no system prompt e que os
// blocos vizinhos (calor-primeiro, Registro B) não foram clobberados.
//
// SEAM: asserção ESTRUTURAL sobre o SOURCE via fs.readFileSync (mesmo idioma dos
// commits 15/16) — não carrega o módulo; 100% offline, sem API/DB/env.
// (Validação comportamental real vem do detector observável + observação em prod.)

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/prompts/system.js'), 'utf8');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// Piso presente + frases-chave
check('V1) bloco "PISO DE HONESTIDADE DE VÍNCULO" presente',
  src.includes('PISO DE HONESTIDADE DE VÍNCULO (inegociável — vale antes de qualquer calor):'));
check('V2) piso reforça "sabe mais, não sente mais"',
  src.includes('sabe mais, não sente mais'));
check('V3) piso proíbe a "PERFORMANCE de relação"',
  src.includes('PERFORMANCE de relação'));

// Não-regressão: blocos vizinhos intactos (não clobberados)
check('V4) calor-primeiro (commit 10) preservado',
  src.includes('QUANDO A CAROL COMPARTILHA UM ESTADO EMOCIONAL'));
check('V5) Registro B (calorosa-íntima) preservado',
  src.includes('Registro B — calorosa-íntima'));

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
