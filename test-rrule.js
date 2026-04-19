// Teste isolado do Bug #6 (recorrências).
// 12 cenários: 7 do helper construirRRULE (incluindo throw) + 5 do dicaIntent estendido.
// Puro JS, zero custo de API, determinístico.
//
// Rodar: node test-rrule.js
require('dotenv').config();
const { construirRRULE } = require('./src/integrations/calendar');
const { dicaIntent } = require('./src/services/calendarBrain');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${String(info).substring(0, 250)}`); }
}

// ── construirRRULE: 6 happy paths + 1 throw ──
const rruleScenarios = [
  { input: { frequencia: 'daily' },                                                   esperado: 'RRULE:FREQ=DAILY;COUNT=90' },
  { input: { frequencia: 'weekly', dias_semana: ['MO'] },                             esperado: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=26' },
  { input: { frequencia: 'weekly', dias_semana: ['MO','TU','WE','TH','FR'] },         esperado: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=26' },
  { input: { frequencia: 'weekly', dias_semana: ['WE'], ate_data: '2026-12-31' },     esperado: 'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z' },
  { input: { frequencia: 'monthly' },                                                 esperado: 'RRULE:FREQ=MONTHLY;COUNT=12' },
  { input: { frequencia: 'daily', contagem: 7 },                                      esperado: 'RRULE:FREQ=DAILY;COUNT=7' },
];

rruleScenarios.forEach(({ input, esperado }, idx) => {
  const real = construirRRULE(input);
  assert(
    real === esperado,
    `R.${idx + 1}) ${JSON.stringify(input)} → ${real}`,
    `esperado: ${esperado}\n   recebido: ${real}`
  );
});

// R.7: throw em frequencia inválida
let lancou = false, errMsg = '';
try { construirRRULE({ frequencia: 'foo' }); }
catch (e) { lancou = true; errMsg = e.message; }
assert(
  lancou && errMsg.includes('inválida'),
  `R.7) {frequencia:"foo"} → throw com mensagem "inválida"`,
  `lancou=${lancou}, msg=${errMsg}`
);

// ── dicaIntent: 5 cenários (3 positivos + 1 negativo + 1 exceção "essa semana") ──
const dicaScenarios = [
  { msg: 'almoço todos os dias às 13h',          esperado: 'criar_recorrente' },
  { msg: 'reunião toda segunda',                  esperado: 'criar_recorrente' },
  { msg: 'almoço amanhã às 13h',                  esperado: null },
  { msg: 'almoço de segunda a sexta',             esperado: 'criar_recorrente' },
  { msg: 'almoço todos os dias essa semana',      esperado: null }, // exceção: padrão + essa semana
];

dicaScenarios.forEach(({ msg, esperado }, idx) => {
  const real = dicaIntent(msg);
  assert(
    real === esperado,
    `D.${idx + 1}) "${msg}" → ${real ?? 'null'}`,
    `esperado: ${esperado ?? 'null'}, recebido: ${real ?? 'null'}`
  );
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
