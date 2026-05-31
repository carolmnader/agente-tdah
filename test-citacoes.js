// test-citacoes.js — Citação do dia (seleção no-repeat + apresentação NUNCA-MENTE).
// PURO na prática: só exercita escolherCitacao e montarBlocoCitacao (sem rede).
// Seta env dummy ANTES do require (citacoes.js cria o client Supabase no load).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const assert = require('assert');
const { escolherCitacao, montarBlocoCitacao, BLOCO_FALLBACK } = require('./src/services/citacoes');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-citacoes');

// ── escolherCitacao ──────────────────────────────────────────────
t('escolhe entre as disponíveis (usada_em null), respeitando rng', () => {
  const rows = [
    { id: 1, ativa: true, usada_em: null },
    { id: 2, ativa: true, usada_em: null },
    { id: 9, ativa: true, usada_em: '2026-01-01T00:00:00Z' }, // já usada → fora do pool disponível
  ];
  assert.strictEqual(escolherCitacao(rows, () => 0).id, 1, 'rng=0 → primeira disponível');
  assert.strictEqual(escolherCitacao(rows, () => 0.99).id, 2, 'rng≈1 → última disponível (sem estourar índice)');
});

t('ignora ativa=false (nunca escolhe inativa)', () => {
  const rows = [
    { id: 5, ativa: false, usada_em: null }, // disponível-mas-inativa → ignorar
    { id: 6, ativa: true, usada_em: null },
  ];
  for (let i = 0; i < 20; i++) {
    const c = escolherCitacao(rows, Math.random);
    assert.strictEqual(c.id, 6, 'só a ativa pode ser escolhida');
    assert.strictEqual(c.ativa, true);
  }
});

t('pool esgotado → recicla a ativa com usada_em MAIS ANTIGO', () => {
  const rows = [
    { id: 10, ativa: true, usada_em: '2026-05-10T00:00:00Z' },
    { id: 11, ativa: true, usada_em: '2026-05-01T00:00:00Z' }, // mais antiga
    { id: 12, ativa: true, usada_em: '2026-05-20T00:00:00Z' },
    { id: 13, ativa: false, usada_em: '2026-01-01T00:00:00Z' }, // inativa, ignorar mesmo sendo a + antiga
  ];
  // rng nunca deve importar aqui (sem disponíveis) — é determinístico
  assert.strictEqual(escolherCitacao(rows, () => 0.5).id, 11);
});

t('rows vazio / inválido → null', () => {
  assert.strictEqual(escolherCitacao([]), null);
  assert.strictEqual(escolherCitacao(undefined), null);
  assert.strictEqual(escolherCitacao([{ id: 1, ativa: false, usada_em: null }]), null, 'só inativas → null');
});

// ── montarBlocoCitacao ───────────────────────────────────────────
const VERIF = {
  id: 100, frase: 'A casa é o nosso canto no mundo.', autor: 'Gaston Bachelard',
  obra: 'A Poética do Espaço', localizacao: 'cap. 1', por_que_importa: 'sobre abrigo e devaneio',
  verificacao: '✓ Verificada',
};
const PARAF = {
  id: 101, frase: 'o tempo lento revela o que a pressa esconde', autor: 'Byung-Chul Han',
  obra: 'O Aroma do Tempo', verificacao: '≈ Paráfrase', por_que_importa: 'crítica à aceleração',
};

t("✓ → aspas + atribuição + instrução de verbatim", () => {
  const out = montarBlocoCitacao(VERIF);
  assert.ok(out.includes(`"${VERIF.frase}"`), 'frase entre aspas');
  assert.ok(out.includes('Gaston Bachelard'), 'autor atribuído');
  assert.ok(/LITERALMENTE/.test(out) && /intocável/.test(out), 'instrução de verbatim');
  assert.ok(out.includes('A Poética do Espaço'), 'obra presente');
});

t("≈ → ideia atribuída, SEM instrução de verbatim", () => {
  const out = montarBlocoCitacao(PARAF);
  assert.ok(/ideia atribuída/i.test(out), 'apresenta como ideia atribuída');
  assert.ok(/NÃO são as palavras exatas/i.test(out), 'avisa que não é verbatim');
  assert.ok(!/LITERALMENTE/.test(out), 'NÃO instrui verbatim');
  assert.ok(!out.includes(`"${PARAF.frase}"`), 'frase NÃO vai entre aspas de citação literal');
});

t('null/sem frase → BLOCO_FALLBACK (texto antigo preservado)', () => {
  assert.strictEqual(montarBlocoCitacao(null), BLOCO_FALLBACK);
  assert.strictEqual(montarBlocoCitacao({ verificacao: '✓', frase: '' }), BLOCO_FALLBACK, 'frase vazia → fallback');
  assert.ok(BLOCO_FALLBACK.includes('Curadoria') && BLOCO_FALLBACK.includes('Pallasmaa'), 'fallback é o bloco dos ~70 nomes');
});

t('verificação desconhecida → trata como paráfrase (nunca verbatim)', () => {
  const out = montarBlocoCitacao({ id: 7, frase: 'x', autor: 'Y', verificacao: '' });
  assert.ok(!/LITERALMENTE/.test(out), 'sem instrução verbatim por segurança');
  assert.ok(/ideia atribuída/i.test(out));
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
