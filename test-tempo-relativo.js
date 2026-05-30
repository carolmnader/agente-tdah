// test-tempo-relativo.js — fix #2 (consciência de evento passado no caminho de agenda)
// PURO: importa só formatarTempoRelativo de utils/time. Sem rede, sem Supabase, sem
// relógio (o "agora" é injetado) → entra no gate determinístico.

const assert = require('assert');
const { formatarTempoRelativo } = require('./src/utils/time');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-tempo-relativo');

const AGORA = '2026-05-30T13:45:00-03:00'; // tarde BRT

// FUTURO
t('futuro 25 min → "em 25 min"', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T14:10:00-03:00', AGORA), 'em 25 min');
});
t('futuro exato 1h → "em 1h"', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T14:45:00-03:00', AGORA), 'em 1h');
});

// AGORA (delta 0)
t('mesmo instante → "agora"', () => {
  assert.strictEqual(formatarTempoRelativo(AGORA, AGORA), 'agora');
});

// PASSADO — o caso do workshop 13:15 às 13:45
t('passado 30 min → "há 30 min · já passou" (caso workshop)', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T13:15:00-03:00', AGORA), 'há 30 min · já passou');
});
t('passado 1h30 → "há 1h30 · já passou"', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T12:15:00-03:00', AGORA), 'há 1h30 · já passou');
});

// VIRADA DE HORA
t('futuro 70 min → "em 1h10" (virada de hora)', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T14:55:00-03:00', AGORA), 'em 1h10');
});
t('futuro 65 min → "em 1h05" (zero-pad minutos)', () => {
  assert.strictEqual(formatarTempoRelativo('2026-05-30T14:50:00-03:00', AGORA), 'em 1h05');
});

// MULTI-DIA (consultar_evento pode mirar outro dia)
t('futuro 2d3h → "em 2d3h"', () => {
  assert.strictEqual(formatarTempoRelativo('2026-06-01T16:45:00-03:00', AGORA), 'em 2d3h');
});

// MEIA-NOITE (atravessa o dia)
t('meia-noite: evento ontem 23:30 vs agora 00:10 → "há 40 min · já passou"', () => {
  assert.strictEqual(
    formatarTempoRelativo('2026-05-30T23:30:00-03:00', '2026-05-31T00:10:00-03:00'),
    'há 40 min · já passou'
  );
});
t('meia-noite: evento hoje 00:10 vs agora 23:50 ontem → "em 20 min"', () => {
  assert.strictEqual(
    formatarTempoRelativo('2026-05-31T00:10:00-03:00', '2026-05-30T23:50:00-03:00'),
    'em 20 min'
  );
});

// ROBUSTEZ — data inválida → '' (aditivo-seguro)
t('data inválida → "" (não quebra o caller)', () => {
  assert.strictEqual(formatarTempoRelativo('lixo', AGORA), '');
  assert.strictEqual(formatarTempoRelativo(AGORA, undefined), '');
});

// PUREZA — determinístico, aceita Date além de string
t('puro: aceita Date e é determinístico', () => {
  const a = formatarTempoRelativo(new Date('2026-05-30T13:15:00-03:00'), new Date(AGORA));
  const b = formatarTempoRelativo(new Date('2026-05-30T13:15:00-03:00'), new Date(AGORA));
  assert.strictEqual(a, 'há 30 min · já passou');
  assert.strictEqual(a, b);
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
