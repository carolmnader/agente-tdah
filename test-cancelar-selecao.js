// test-cancelar-selecao.js — Bug L (cancelar_selecao aceita negação ampla)
//
// Valida handler cancelar_selecao após Onda 1.5 Fase A + fix Bug L:
//   - NEG_FLUXO ampliado (Eu não quero cancelar, Percebi que..., Me confundi, etc)
//   - reordenado ANTES de matchHoje (causa-raiz primária do Bug L)
//   - Proteção & !RE_VERBO_IMPERATIVO_CALENDAR pra preservar comandos compostos
//
// 11 cenários: 7 negação (incl. 2 reais), 3 seleção legítima, 1 oposto composto.
//
// Rodar: node test-cancelar-selecao.js

require('dotenv').config();

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// ─── Mocks ────────────────────────────────────────────
const hoje = new Date();
const amanha = new Date(hoje.getTime() + 24 * 60 * 60 * 1000);
const depois = new Date(hoje.getTime() + 2 * 24 * 60 * 60 * 1000);

const EVENTOS_MOCK = [
  { id: 'ev1', calendarId: 'cal1', summary: 'Almoço com Ana', startISO: hoje.toISOString() },
  { id: 'ev2', calendarId: 'cal2', summary: 'Treino',          startISO: amanha.toISOString() },
  { id: 'ev3', calendarId: 'cal3', summary: 'Reunião',         startISO: depois.toISOString() },
];

let limpouPendente = false;
let deletouEvento = null;

function resetMocks() {
  limpouPendente = false;
  deletouEvento = null;
}

mockModule('./src/services/memorySupabase', {
  salvarMemoria: async () => {},
  buscarMemoriaPorChave: async () => [],
  salvarAcaoPendente: async () => {},
  buscarAcaoPendente: async () => ({
    tipo: 'cancelar_selecao',
    params: { eventos: EVENTOS_MOCK },
  }),
  limparAcaoPendente: async () => { limpouPendente = true; },
});

const googleapisMock = {
  google: {
    auth: { OAuth2: function () { return { setCredentials: () => {} }; } },
    calendar: () => ({
      events: {
        delete: async ({ calendarId, eventId }) => {
          deletouEvento = { calendarId, eventId };
          return { data: {} };
        },
        list: async () => ({ data: { items: [] } }),
        insert: async () => ({ data: { id: 'fake' }, status: 200 }),
        patch: async () => ({ data: { id: 'fake' } }),
      },
    }),
  },
};
mockModule('googleapis', googleapisMock);

// Anthropic mock: se algum cenário escapar pro Opus, devolve nao_e_calendar
// (em vez de throw — assim test detecta pelo limpouPendente=false sem crash).
const AnthropicMock = function () {
  return {
    messages: {
      create: async () => ({ content: [{ text: JSON.stringify({ acao: 'nao_e_calendar', raciocinio: 'mock' }) }] }),
    },
  };
};
mockModule('@anthropic-ai/sdk', AnthropicMock);

const { processarCalendar } = require('./src/services/calendarBrain');

const CHAT_ID = 999999990;

async function rodar(msg) {
  resetMocks();
  const resp = await processarCalendar(msg, [], CHAT_ID);
  return { resp, limpouPendente, deletouEvento };
}

// ─── Cenários ─────────────────────────────────────────
(async () => {
  try {
    // C1: caso real Bug L — sujeito explícito + composta + "hoje" no meio
    let r = await rodar('Eu não quero cancelar, quero dizer que eu não fiz exercício hoje');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C1) "Eu não quero cancelar, quero dizer..." → limpa + "não cancelei nada" (Bug L real)',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C2: caso real Bug L — "Percebi que hoje..."
    r = await rodar('Percebi que hoje não fiz exercício');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C2) "Percebi que hoje não fiz exercício" → limpa (Bug L real)',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C3
    r = await rodar('Não queria cancelar');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C3) "Não queria cancelar" → limpa',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C4
    r = await rodar('Não era pra cancelar');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C4) "Não era pra cancelar" → limpa',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C5
    r = await rodar('Me confundi');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C5) "Me confundi" → limpa',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C6
    r = await rodar('Pra você saber apenas');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C6) "Pra você saber apenas" → limpa (sinal informacional)',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C7: regressão zero do neg simples
    r = await rodar('Esquece isso');
    assert(
      r.limpouPendente && /n[aã]o cancelei nada/i.test(r.resp || ''),
      'C7) "Esquece isso" → limpa (regressão zero do neg simples)',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C8: matchNum legítimo — deleta evento 1
    r = await rodar('1');
    assert(
      r.limpouPendente && r.deletouEvento?.eventId === 'ev1' && /removido/i.test(r.resp || ''),
      'C8) "1" → matchNum deleta evento 1 (regressão zero matchNum)',
      `resp=${r.resp} deletou=${JSON.stringify(r.deletouEvento)}`
    );

    // C9: matchHoje legítimo — ev1 é o de hoje no mock
    r = await rodar('o de hoje');
    assert(
      r.limpouPendente && r.deletouEvento?.eventId === 'ev1' && /removido/i.test(r.resp || ''),
      'C9) "o de hoje" → matchHoje deleta evento de hoje (regressão zero matchHoje)',
      `resp=${r.resp} deletou=${JSON.stringify(r.deletouEvento)}`
    );

    // C10: matchNum fora de range — NÃO limpa, mensagem "entre 1 e N"
    r = await rodar('4');
    assert(
      !r.limpouPendente && /entre 1 e 3/i.test(r.resp || ''),
      'C10) "4" (eventos=3, fora de range) → NÃO limpa + "entre 1 e N"',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    // C11 (bônus): "Percebi que tem 3, cancela o 2" — verbo imperativo "cancela"
    // protege NEG_FLUXO. Mensagem não bate matchNum, matchHoje, nem neg simples.
    // Cai no fallback "Manda o número...". Importante: NÃO limpa pendente.
    r = await rodar('Percebi que tem 3 com almoço, cancela o 2');
    assert(
      !r.limpouPendente,
      'C11) "Percebi que..., cancela o 2" → RE_VERBO_IMPERATIVO_CALENDAR protege (NÃO limpa)',
      `resp=${r.resp} limpou=${r.limpouPendente}`
    );

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error('💥 erro fatal:', e);
    process.exit(1);
  }
})();
