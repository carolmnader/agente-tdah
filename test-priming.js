// test-priming.js — Priming de Estado MVP (cena #1). PURO: importa só o builder.
// Sem cadeia Supabase, sem rede, sem relógio → entra no gate determinístico.

const { montarDiretrizPriming } = require('./src/services/priming');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// T1: readiness presente (62) → linha-âncora com o número + ritual
{
  const out = montarDiretrizPriming({ readiness: { score: 62 }, stress: { stress_high_seconds: 0 } });
  check('T1a) contém "Readiness de hoje: 62"', out.includes('Readiness de hoje: 62'), out);
  check('T1b) contém o ritual (3 respirações + UMA linha + primeiro gesto)',
    /respira/i.test(out) && /UMA linha/.test(out) && /primeiro gesto/i.test(out), out);
}

// T2: oura_corpo null → SEM linha-âncora "Readiness de hoje:", com "NÃO invente", com ritual
{
  const out = montarDiretrizPriming(null);
  check('T2a) NÃO contém "Readiness de hoje:"', !out.includes('Readiness de hoje:'), out);
  check('T2b) contém "NÃO invente" (sem número)', /NÃO invente/.test(out), out);
  check('T2c) ritual presente mesmo sem readiness', /respira/i.test(out) && /UMA linha/.test(out), out);
}

// T3: readiness alto (88) → NÃO emite linguagem de "modo expansão"
{
  const out = montarDiretrizPriming({ readiness: { score: 88 } });
  check('T3) sem linguagem de expansão ("morder algo grande" / "te assusta")',
    !/morder algo grande/i.test(out) && !/te assusta/i.test(out), out);
}

// T4: anti-manifestação PRESENTE como proibição explícita
{
  const out = montarDiretrizPriming({ readiness: { score: 70 } });
  check('T4) nomeia a proibição (manifestação / campo quântico)',
    /manifesta/i.test(out) && /campo quântico/i.test(out), out);
}

// T5: sem o pronome "tu/teu/tua/contigo" (boundaries — bare /tu/i casaria "ritual")
{
  const outA = montarDiretrizPriming({ readiness: { score: 62 } });
  const outB = montarDiretrizPriming(null);
  const re = /\b(tu|teu|tua|contigo)\b/i;
  check('T5) sem pronome "tu" (com readiness)', !re.test(outA), outA);
  check('T5b) sem pronome "tu" (sem readiness)', !re.test(outB), outB);
}

// T6: anti-clichê presente (nomeia os clichês vetados)
{
  const out = montarDiretrizPriming(null);
  check('T6) veta clichê motivacional ("uma coisa de cada vez" / "ferrari")',
    /uma coisa de cada vez/i.test(out) && /ferrari/i.test(out), out);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
