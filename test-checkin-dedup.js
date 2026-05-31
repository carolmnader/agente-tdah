// test-checkin-dedup.js — #29: dedup por evento no jobCheckinTarde (helper PURO).
// Env dummy só pra carregar scheduler.js (módulos importados criam client no load). Sem rede.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'dummy';

const assert = require('assert');
const { filtrarEventosNaoNotificados } = require('./src/jobs/scheduler');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-checkin-dedup');

const A = { id: 'ev_a', titulo: '🧘 Yoga', hora: '07:00' };
const B = { id: 'ev_b', titulo: '💼 Reunião', hora: '10:00' };
const C = { id: 'ev_c', titulo: '🍽️ Almoço', hora: '12:30' };

t('remove o evento já notificado, mantém os novos', () => {
  const out = filtrarEventosNaoNotificados([A, B, C], new Set(['ev_a']));
  assert.deepStrictEqual(out.map(e => e.id), ['ev_b', 'ev_c']);
});

t('evento novo permanece (set vazio → todos passam)', () => {
  const out = filtrarEventosNaoNotificados([A, B], new Set());
  assert.deepStrictEqual(out.map(e => e.id), ['ev_a', 'ev_b']);
});

t('lista toda notificada → vazio (early-return dispara)', () => {
  const out = filtrarEventosNaoNotificados([A, B], new Set(['ev_a', 'ev_b']));
  assert.strictEqual(out.length, 0);
});

t('lista de eventos vazia → vazio', () => {
  assert.strictEqual(filtrarEventosNaoNotificados([], new Set(['ev_a'])).length, 0);
});

t('aceita Array além de Set como segundo arg (robustez)', () => {
  const out = filtrarEventosNaoNotificados([A, B, C], ['ev_b']);
  assert.deepStrictEqual(out.map(e => e.id), ['ev_a', 'ev_c']);
});

t('entradas inválidas não quebram (eventos null / sem id)', () => {
  assert.strictEqual(filtrarEventosNaoNotificados(null, new Set()).length, 0);
  const out = filtrarEventosNaoNotificados([A, null, { titulo: 'sem id' }], new Set(['ev_a']));
  assert.deepStrictEqual(out.map(e => e.id), [undefined], 'mantém o sem-id (id undefined ∉ set), descarta null e o já-notificado');
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
