// test-saudacao.js — Bug M (saudacao + currentTimeBRT)
//
// Valida helper src/utils/time.js getBrtNow():
//   - Buckets de periodo corretos (manhã/tarde/noite/noite tardia/madrugada)
//   - Boundaries exatos (11:59 vs 12:00, 17:59 vs 18:00, etc)
//   - Formato hora HH:MM e dataBR DD/MM/YYYY
//   - diaSemana em pt-BR extenso
//   - Aceita Date custom no parametro pra testabilidade
//
// Rodar: node test-saudacao.js
//
// Importante: usa Date em UTC e deixa timeZone:'America/Sao_Paulo' converter.
// Pra simular hora BRT X, criamos new Date('YYYY-MM-DDTHH:MM:00-03:00').

const { getBrtNow } = require('./src/utils/time');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// Helper: cria Date pra hora BRT (offset -03:00 fixo — Sao_Paulo nao tem DST hoje)
function brt(hh, mm = 0) {
  const pad = n => String(n).padStart(2, '0');
  // Usa data fixa pra simplificar (15/05/2026 = sexta-feira em pt-BR)
  return new Date(`2026-05-15T${pad(hh)}:${pad(mm)}:00-03:00`);
}

// ─── T1-T5: cada periodo principal ────────────────────
const t1 = getBrtNow(brt(10, 30));
assert(t1.periodo === 'manhã', 'T1) 10:30 BRT → periodo="manhã"', `periodo=${t1.periodo}`);

const t2 = getBrtNow(brt(14, 0));
assert(t2.periodo === 'tarde', 'T2) 14:00 BRT → periodo="tarde"', `periodo=${t2.periodo}`);

const t3 = getBrtNow(brt(19, 0));
assert(t3.periodo === 'noite', 'T3) 19:00 BRT → periodo="noite"', `periodo=${t3.periodo}`);

const t4 = getBrtNow(brt(22, 0));
assert(t4.periodo === 'noite tardia', 'T4) 22:00 BRT → periodo="noite tardia"', `periodo=${t4.periodo}`);

const t5 = getBrtNow(brt(2, 0));
assert(t5.periodo === 'madrugada', 'T5) 02:00 BRT → periodo="madrugada"', `periodo=${t5.periodo}`);

// ─── T6: boundaries exatos ────────────────────────────
const b1 = getBrtNow(brt(11, 59));
assert(b1.periodo === 'manhã', 'T6a) 11:59 → "manhã"', `periodo=${b1.periodo}`);

const b2 = getBrtNow(brt(12, 0));
assert(b2.periodo === 'tarde', 'T6b) 12:00 → "tarde"', `periodo=${b2.periodo}`);

const b3 = getBrtNow(brt(17, 59));
assert(b3.periodo === 'tarde', 'T6c) 17:59 → "tarde"', `periodo=${b3.periodo}`);

const b4 = getBrtNow(brt(18, 0));
assert(b4.periodo === 'noite', 'T6d) 18:00 → "noite"', `periodo=${b4.periodo}`);

const b5 = getBrtNow(brt(20, 59));
assert(b5.periodo === 'noite', 'T6e) 20:59 → "noite"', `periodo=${b5.periodo}`);

const b6 = getBrtNow(brt(21, 0));
assert(b6.periodo === 'noite tardia', 'T6f) 21:00 → "noite tardia"', `periodo=${b6.periodo}`);

const b7 = getBrtNow(brt(23, 59));
assert(b7.periodo === 'noite tardia', 'T6g) 23:59 → "noite tardia"', `periodo=${b7.periodo}`);

const b8 = getBrtNow(brt(0, 0));
assert(b8.periodo === 'madrugada', 'T6h) 00:00 → "madrugada"', `periodo=${b8.periodo}`);

const b9 = getBrtNow(brt(4, 59));
assert(b9.periodo === 'madrugada', 'T6i) 04:59 → "madrugada"', `periodo=${b9.periodo}`);

const b10 = getBrtNow(brt(5, 0));
assert(b10.periodo === 'manhã', 'T6j) 05:00 → "manhã"', `periodo=${b10.periodo}`);

// ─── T7: formato hora HH:MM ───────────────────────────
const t7 = getBrtNow(brt(14, 5));
assert(/^\d{2}:\d{2}$/.test(t7.hora), 'T7) hora bate regex ^\\d{2}:\\d{2}$', `hora="${t7.hora}"`);
assert(t7.hora === '14:05', 'T7b) hora=14:05 (zero-pad em minutos)', `hora="${t7.hora}"`);

// ─── T8: diaSemana em pt-BR extenso ───────────────────
// 2026-05-15 = sexta-feira
const t8 = getBrtNow(brt(10, 0));
const diasValidos = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
assert(
  diasValidos.includes(t8.diaSemana),
  'T8) diaSemana esta na lista pt-BR extenso',
  `diaSemana="${t8.diaSemana}"`
);
assert(t8.diaSemana === 'sexta-feira', 'T8b) 2026-05-15 → "sexta-feira"', `diaSemana="${t8.diaSemana}"`);

// ─── T9: dataBR formato DD/MM/YYYY ────────────────────
const t9 = getBrtNow(brt(14, 0));
assert(/^\d{2}\/\d{2}\/\d{4}$/.test(t9.dataBR), 'T9) dataBR bate regex ^\\d{2}/\\d{2}/\\d{4}$', `dataBR="${t9.dataBR}"`);
assert(t9.dataBR === '15/05/2026', 'T9b) dataBR=15/05/2026', `dataBR="${t9.dataBR}"`);

// ─── T10: aceita parametro Date opcional ──────────────
const dateCustom = new Date('2026-12-25T08:00:00-03:00'); // 25/12 = sexta
const t10 = getBrtNow(dateCustom);
assert(
  t10.dataBR === '25/12/2026' &&
  t10.hora === '08:00' &&
  t10.periodo === 'manhã' &&
  t10.horaNum === 8,
  'T10) aceita Date custom — 25/12 08:00 BRT → manhã, hora=08:00, dataBR=25/12/2026',
  `hora=${t10.hora} dataBR=${t10.dataBR} periodo=${t10.periodo} horaNum=${t10.horaNum}`
);

// ─── Summary ──────────────────────────────────────────
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
