// test-antiinversao-negativa.js — #19 Commit B (anti-inversão de negativa na conversa geral)
// PURO: testa a FIAÇÃO do gatilho (o LLM não é testável aqui). Usa os regexes REAIS
// exportados e o MESMO predicado de brain.js L633. Sem rede/Supabase/relógio próprio →
// (importa calendarBrain → memorySupabase cria client no load; roda no gate com .env do pai).

const assert = require('assert');
const { RE_FATO_PASSADO, RE_VERBO_IMPERATIVO_CALENDAR } = require('./src/services/calendarBrain');

// Espelho EXATO do predicado em brain.js (Passo 4): injeta diretriz anti-inversão sse
// é relato-negativo SEM verbo imperativo de Calendar.
function injetaDiretrizNegativa(message) {
  return RE_FATO_PASSADO.test(message) && !RE_VERBO_IMPERATIVO_CALENDAR.test(message);
}

let passed = 0, failed = 0;
function t(nome, ok, info = '') {
  if (ok) { passed++; console.log(`  ✅ ${nome}`); }
  else { failed++; console.error(`  ❌ ${nome}${info ? ' — ' + info : ''}`); }
}

console.log('test-antiinversao-negativa');

// TRUE — relato negativo → injeta diretriz anti-inversão
for (const m of ['não fiz', 'não fiz yoga hoje', 'não treinei', 'yoga não rolou', 'Não fiz', 'academia não fui', 'faltei o pilates']) {
  t(`injeta (negativa): "${m}"`, injetaDiretrizNegativa(m) === true, `real=${injetaDiretrizNegativa(m)}`);
}

// FALSE — imperativo de Calendar → NÃO injeta (deixa o fluxo Calendar/comando)
for (const m of ['cancela a yoga', 'remarca', 'desmarca o almoço', 'não rolou ontem, cancela o de amanhã']) {
  t(`não injeta (imperativo): "${m}"`, injetaDiretrizNegativa(m) === false, `real=${injetaDiretrizNegativa(m)}`);
}

// FALSE — não é relato negativo (futuro / consulta / afirmativo)
for (const m of ['vou fazer yoga amanhã', 'que horas tem yoga', 'fiz yoga hoje', 'tô cansada']) {
  t(`não injeta (não-relato-negativo): "${m}"`, injetaDiretrizNegativa(m) === false, `real=${injetaDiretrizNegativa(m)}`);
}

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
