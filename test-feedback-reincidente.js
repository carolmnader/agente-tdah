// test-feedback-reincidente.js — (C) Commit 1
// Helper PURO de bookkeeping de feedbacks reincidentes da ARIA.
// Sem cadeia Supabase, sem rede, sem relógio → entra no gate determinístico.
// Importa SÓ ./src/services/feedbackReincidente (zero IO).

const assert = require('assert');
const { planejarUpsertFeedback } = require('./src/services/feedbackReincidente');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-feedback-reincidente');

// 1. Insert novo: sem memória existente → acao insert, count=1, valor literal.
t('insert novo: acao=insert, contexto reincidencia:1, valor literal', () => {
  const r = planejarUpsertFeedback({
    item: { instrucao_canonica: 'não use emojis comigo', chave_sugerida: 'emojis', match_chave: null },
    memoriaExistente: null,
  });
  assert.strictEqual(r.acao, 'insert');
  assert.strictEqual(r.chave, 'emojis');
  assert.strictEqual(r.valor, 'não use emojis comigo');
  assert.strictEqual(r.contexto, 'reincidencia:1');
});

// 2. Match incrementa: count anterior 1 → 2, contexto reflete.
t('match incrementa: acao=increment, contexto reincidencia:2', () => {
  const r = planejarUpsertFeedback({
    item: { instrucao_canonica: 'de novo: nada de emoji', chave_sugerida: 'emojis_v2', match_chave: 'emojis' },
    memoriaExistente: { chave: 'emojis', valor: 'não use emojis comigo', contexto: 'reincidencia:1' },
  });
  assert.strictEqual(r.acao, 'increment');
  assert.strictEqual(r.contexto, 'reincidencia:2');
});

// 3. Preserva instrução LITERAL no increment (não reescreve com a fala nova).
t('increment preserva o valor literal já registrado', () => {
  const r = planejarUpsertFeedback({
    item: { instrucao_canonica: 'PARA com os emojis!!!', chave_sugerida: 'x', match_chave: 'emojis' },
    memoriaExistente: { chave: 'emojis', valor: 'não use emojis comigo', contexto: 'reincidencia:1' },
  });
  assert.strictEqual(r.valor, 'não use emojis comigo');
});

// 4. Chave estável = a existente (ignora chave_sugerida do turno novo).
t('chave estável no increment (= a existente)', () => {
  const r = planejarUpsertFeedback({
    item: { instrucao_canonica: 'nada de emoji', chave_sugerida: 'chave_diferente', match_chave: 'emojis' },
    memoriaExistente: { chave: 'emojis', valor: 'não use emojis comigo', contexto: 'reincidencia:2' },
  });
  assert.strictEqual(r.chave, 'emojis');
  assert.strictEqual(r.contexto, 'reincidencia:3');
});

// 5. Contexto ausente/malformado → trata count anterior como 1 → 2.
t('contexto null/malformado defaulta para reincidencia:2 no increment', () => {
  const r1 = planejarUpsertFeedback({
    item: { instrucao_canonica: 'x', chave_sugerida: 'k', match_chave: 'tom' },
    memoriaExistente: { chave: 'tom', valor: 'seja mais seca', contexto: null },
  });
  assert.strictEqual(r1.contexto, 'reincidencia:2');
  const r2 = planejarUpsertFeedback({
    item: { instrucao_canonica: 'x', chave_sugerida: 'k', match_chave: 'tom' },
    memoriaExistente: { chave: 'tom', valor: 'seja mais seca', contexto: 'lixo sem numero' },
  });
  assert.strictEqual(r2.contexto, 'reincidencia:2');
});

// 6. Pureza: não muta inputs e é determinístico (mesma entrada → mesma saída).
t('puro: não muta inputs e é determinístico', () => {
  const item = { instrucao_canonica: 'não me chame de querida', chave_sugerida: 'tratamento', match_chave: null };
  const itemSnapshot = JSON.stringify(item);
  const a = planejarUpsertFeedback({ item, memoriaExistente: null });
  const b = planejarUpsertFeedback({ item, memoriaExistente: null });
  assert.strictEqual(JSON.stringify(item), itemSnapshot, 'item de entrada não pode ser mutado');
  assert.deepStrictEqual(a, b, 'mesma entrada deve produzir mesma saída');
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
