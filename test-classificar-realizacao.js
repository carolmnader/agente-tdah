// test-classificar-realizacao.js — Loop Fogg Commit 2 (persistência do realizado)
// PURO: importa só classificarRealizacao. Sem rede/Supabase/relógio → gate determinístico.

const assert = require('assert');
const { classificarRealizacao } = require('./src/services/celebracaoPosEvento');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-classificar-realizacao');

// TRUE — afirmação clara
for (const s of ['fui sim', 'fiz yoga hoje', 'consegui terminar', 'deu certo!', 'foi ótimo', 'rolou sim', 'amei demais', 'fui e foi bom']) {
  t(`true: "${s}"`, () => assert.strictEqual(classificarRealizacao(s), true));
}

// FALSE — negação clara
for (const s of ['não fui', 'nao fiz', 'não deu', 'não rolou', 'faltei', 'pulei hoje', 'não consegui ir', 'não fui hoje']) {
  t(`false: "${s}"`, () => assert.strictEqual(classificarRealizacao(s), false));
}

// NULL — ambíguo / neutro / vazio
for (const s of ['mais ou menos', 'sei lá', 'normal', 'foi corrido', '', '   ']) {
  t(`null: "${s}"`, () => assert.strictEqual(classificarRealizacao(s), null));
}

// Robustez
t('null para entrada não-string (null/undefined)', () => {
  assert.strictEqual(classificarRealizacao(null), null);
  assert.strictEqual(classificarRealizacao(undefined), null);
});
t('negação vence afirmação na mesma frase ("não consegui ir")', () => {
  assert.strictEqual(classificarRealizacao('não consegui ir dessa vez'), false);
});
t('determinístico', () => {
  assert.strictEqual(classificarRealizacao('fui sim'), classificarRealizacao('fui sim'));
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
