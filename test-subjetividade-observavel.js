// test-subjetividade-observavel.js — Commit 16 (anti-deriva, parte 2/3)
// Prova que o detector de subjetividade ficou OBSERVÁVEL: persiste TODA avaliação
// (sem gate severidade<3) e o catch loga com contexto.
//
// SEAM: asserção ESTRUTURAL sobre o SOURCE via fs.readFileSync — não carrega o
// módulo (que puxaria anthropic/supabase/env), então 100% offline, sem API/DB/env.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/services/detectarPerformaSubjetividade.js'), 'utf8');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// (a) Gate de persistência por severidade baixa REMOVIDO — não há mais early-return
check('O1) gate "parsed.severidade < 3" REMOVIDO (não bloqueia mais o insert)',
  !src.includes('parsed.severidade < 3'));
check('O2) severidade real é computada sempre (sem gate)',
  src.includes("typeof parsed.severidade === 'number' ? parsed.severidade : -1"));
check('O3) insert de subjetividade_log mantém o campo severidade',
  /\.from\('subjetividade_log'\)\.insert\(\{[\s\S]*severidade[\s\S]*\}\)/.test(src));

// (b) Catch NÃO-silencioso (loga com caminho)
check('O4) catch loga erro com contexto (caminho)',
  src.includes('erro (caminho=${caminho})'));

// (c) Guard de texto curto preservado
check('O5) guard length<20 preservado (texto curto não é avaliável)',
  src.includes('respostaAria.length < 20'));

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
