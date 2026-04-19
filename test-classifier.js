// Teste isolado do pré-classificador dicaIntent (Bug #1: categoria × horário).
// Puro JS, zero custo de API, determinístico.
//
// Rodar: node test-classifier.js
const { dicaIntent } = require('./src/services/calendarBrain');

const cenarios = [
  // ── Os 10 cenários originais da tabela ──
  { msg: 'muda categoria do almoço pra Saúde',         esperado: 'mudar_calendario' },
  { msg: 'muda almoço pra Saúde',                      esperado: 'mudar_calendario' },
  { msg: 'passa o almoço pra Saúde',                   esperado: 'mudar_calendario' },
  { msg: 'joga o almoço pra Selfcare',                 esperado: 'mudar_calendario' },
  { msg: 'move o psicólogo pra Selfcare',              esperado: 'mudar_calendario' }, // crítico: move + calendário
  { msg: 'muda almoço para 15h',                       esperado: 'reagendar' },
  { msg: 'muda almoço de 12h pra 13h',                 esperado: 'reagendar' },
  { msg: 'puxa o almoço pra 13h',                      esperado: null },              // "puxa" fora do regex; defere ao Opus
  { msg: 'muda almoço de Trabalho pra Saúde',          esperado: 'mudar_calendario' }, // 2 calendários, sem hora
  { msg: 'move o almoço de 12h pra 13h',               esperado: 'reagendar' },

  // ── 2 edge cases pedidos pelo usuário ──
  { msg: 'muda Trabalho pra Saúde',                    esperado: 'mudar_calendario' }, // hint correto; "qual evento?" é downstream
  { msg: 'move o almoço pra categoria Lazer',          esperado: 'mudar_calendario' }, // verbo de horário + calendário → calendário ganha

  // ── Negativos / sanity checks ──
  { msg: 'reagenda o almoço',                          esperado: null },              // sem destino claro
  { msg: 'passa um arquivo pra mim',                   esperado: null },              // verbo "passa" mas sem destino
];

let passed = 0, failed = 0;

cenarios.forEach(({ msg, esperado }, idx) => {
  const real = dicaIntent(msg);
  const ok = real === esperado;
  const tag = (idx + 1).toString().padStart(2, '0');
  if (ok) {
    passed++;
    console.log(`✅ ${tag}) "${msg}" → ${real ?? 'null'}`);
  } else {
    failed++;
    console.log(`❌ ${tag}) "${msg}"`);
    console.log(`     esperado: ${esperado ?? 'null'}`);
    console.log(`     recebido: ${real ?? 'null'}`);
  }
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${cenarios.length})`);
process.exit(failed > 0 ? 1 : 0);
