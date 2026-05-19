// test-substituicao.js — Onda 1.8 (Bug F + cinema composto)
// Mocka googleapis + Anthropic + integrations/calendar + memorySupabase
// via require.cache (padrão do test-pessoas.js) antes de carregar calendarBrain.
//
// 5 cenários:
//  C1) Conflito 1 evento único, "substitui"
//  C2) Conflito 1 evento RECORRENTE (instance ID), "substitui"
//  C3) Conflito 2 eventos, "substitui"
//  C4) Conflito + frase composta "Sim. Coloca cinema 19h tambem"
//  C5) Conflito + "pula"

require('dotenv').config();

// ────────────────────────────────────────
// MOCKS via require.cache (mesma técnica do test-pessoas.js)
// ────────────────────────────────────────

const callLog = [];
function clearLog() { callLog.length = 0; }

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

// 1) Anthropic SDK — boot do calendarBrain instancia `new Anthropic({...})`.
//    Recursão em C4 chama anthropic.messages.create → mock retorna nao_e_calendar.
const AnthropicMock = function () {
  return {
    messages: {
      create: async (opts) => {
        callLog.push({ tipo: 'anthropic', model: opts.model });
        return { content: [{ text: JSON.stringify({ acao: 'nao_e_calendar', raciocinio: 'mock' }) }] };
      },
    },
  };
};
mockModule('@anthropic-ai/sdk', AnthropicMock);

// 2) googleapis — handler "substitui" faz require inline, então mockar globalmente.
mockModule('googleapis', {
  google: {
    calendar: () => ({
      events: {
        delete: async (params) => {
          callLog.push({ tipo: 'delete', calendarId: params.calendarId, eventId: params.eventId });
          return { data: {} };
        },
        list: async () => ({ data: { items: [] } }),
        patch: async () => ({ data: { id: 'fake' } }),
      },
    }),
  },
});

// 3) integrations/calendar — handler usa criarEvento; cancelarEvento NUNCA deve ser chamado.
mockModule('./src/integrations/calendar', {
  listarEventosHoje: async () => 'agenda vazia',
  listarEventosSemana: async () => '',
  criarEvento: async (titulo, dh, duracao, calendario) => {
    callLog.push({ tipo: 'criarEvento', titulo, hora: dh.toISOString?.(), calendario });
    return '✅ criado mock';
  },
  reagendarEvento: async () => '✅',
  cancelarEvento: async (termo) => {
    callLog.push({ tipo: 'cancelarEvento_LEGACY', termo });
    return 'NÃO DEVERIA SER CHAMADO';
  },
  proximoHorarioLivre: async () => '',
  buscarEvento: async () => [],
  buscarEventosTodos: async () => [],
  detectarCategoria: () => 'Trabalho',
  getAuthClient: () => ({}),
  getCalendar: () => ({}),
  CATEGORIAS: { Trabalho: { cor: '9', emoji: '💼' } },
  CALENDARIOS: {},
  CALENDARIO_POR_NOME: {},
  construirRRULE: () => 'RRULE',
  CAP_PADRAO_RECORRENCIA: { daily: 90, weekly: 26, monthly: 12 },
  normalizarBusca: (s) => s,
  CalendarOperationError: class extends Error {},
  CalendarInsertError: class extends Error {},
});

// 4) memorySupabase — handler usa buscarAcaoPendente (retorna null no teste —
//    forçamos via global.ariaMemoria.conflitosCalendarPendentes).
mockModule('./src/services/memorySupabase', {
  buscarMemoriaPorChave: async () => [],
  salvarAcaoPendente: async () => {},
  buscarAcaoPendente: async () => null,
  limparAcaoPendente: async () => {},
});

// ────────────────────────────────────────
// AGORA carrega calendarBrain (depois dos mocks)
// ────────────────────────────────────────

const { processarCalendar } = require('./src/services/calendarBrain');

const CHAT_ID = 999999;
let passed = 0, failed = 0;

function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

function setConflitos(conflitos) {
  global.ariaMemoria = global.ariaMemoria || {};
  global.ariaMemoria.conflitosCalendarPendentes = conflitos;
  global.ariaMemoria.apelidos = global.ariaMemoria.apelidos || {};
}

async function run() {
  // ══════════════════════════════════════════════════════════════════
  // C1) Conflito 1 evento único, "substitui"
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  setConflitos([{
    novo: { titulo: '🧘 Banho e Preparação', data: 'hoje', hora: '17:00', duracao_minutos: 60, calendario: 'Selfcare' },
    existente: { id: 'evt_1', calendarId: 'primary', summary: 'Desenvolvimento Pessoal', startISO: '2026-05-19T17:00:00-03:00' },
  }]);

  const resp1 = await processarCalendar('substitui', [], CHAT_ID);
  const deletes1 = callLog.filter(c => c.tipo === 'delete');
  const cria1 = callLog.filter(c => c.tipo === 'criarEvento');
  const cancLegacy1 = callLog.filter(c => c.tipo === 'cancelarEvento_LEGACY');

  assert(deletes1.length === 1, 'C1) cal.events.delete chamado 1x', `count=${deletes1.length}`);
  assert(deletes1[0]?.calendarId === 'primary' && deletes1[0]?.eventId === 'evt_1', 'C1) delete com calendarId+eventId corretos', JSON.stringify(deletes1[0]));
  assert(cria1.length === 1, 'C1) criarEvento chamado 1x', `count=${cria1.length}`);
  assert(cancLegacy1.length === 0, 'C1) cancelarEvento_LEGACY NÃO chamado (bug F)', `chamadas: ${cancLegacy1.length}`);
  assert(/✅/.test(resp1), 'C1) resp contém ✅', resp1.substring(0, 100));

  // ══════════════════════════════════════════════════════════════════
  // C2) Conflito 1 RECORRENTE (instance ID com timestamp), "substitui"
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  setConflitos([{
    novo: { titulo: '🧘 Banho', data: 'hoje', hora: '17:00', duracao_minutos: 60 },
    existente: { id: 'evt_recorr_20260519T170000', calendarId: 'primary', summary: 'Desenvolvimento Pessoal', startISO: '2026-05-19T17:00:00-03:00' },
  }]);

  const resp2 = await processarCalendar('substitui', [], CHAT_ID);
  const deletes2 = callLog.filter(c => c.tipo === 'delete');

  assert(deletes2.length === 1, 'C2) delete 1x em recorrente', `count=${deletes2.length}`);
  assert(deletes2[0]?.eventId === 'evt_recorr_20260519T170000', 'C2) eventId é INSTANCE (com timestamp), não série', JSON.stringify(deletes2[0]));

  // ══════════════════════════════════════════════════════════════════
  // C3) Conflito 2 eventos, "substitui"
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  setConflitos([
    { novo: { titulo: '🧘 Banho', data: 'hoje', hora: '17:00', duracao_minutos: 60 }, existente: { id: 'evt_A', calendarId: 'primary', summary: 'Desenvolvimento Pessoal', startISO: '2026-05-19T17:00:00-03:00' } },
    { novo: { titulo: '🍽️ Jantar', data: 'hoje', hora: '19:00', duracao_minutos: 60 }, existente: { id: 'evt_B', calendarId: 'primary', summary: 'Reunião X', startISO: '2026-05-19T19:00:00-03:00' } },
  ]);

  const resp3 = await processarCalendar('substitui', [], CHAT_ID);
  const deletes3 = callLog.filter(c => c.tipo === 'delete');
  const cria3 = callLog.filter(c => c.tipo === 'criarEvento');

  assert(deletes3.length === 2, 'C3) delete 2x', `count=${deletes3.length}`);
  assert(cria3.length === 2, 'C3) criarEvento 2x', `count=${cria3.length}`);
  assert((resp3.match(/✅/g) || []).length === 2, 'C3) resp tem 2 ✅', resp3.substring(0, 200));

  // ══════════════════════════════════════════════════════════════════
  // C4) Conflito + frase composta "Sim. Coloca cinema 19h tambem"
  //     → substitui Banho + chama processarCalendar recursivo
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  setConflitos([{
    novo: { titulo: '🧘 Banho', data: 'hoje', hora: '17:00', duracao_minutos: 60 },
    existente: { id: 'evt_1', calendarId: 'primary', summary: 'Desenvolvimento Pessoal', startISO: '2026-05-19T17:00:00-03:00' },
  }]);

  const resp4 = await processarCalendar('Sim. Coloca cinema 19h tambem', [], CHAT_ID);
  const deletes4 = callLog.filter(c => c.tipo === 'delete');
  const anthropicCalls4 = callLog.filter(c => c.tipo === 'anthropic');

  assert(deletes4.length === 1, 'C4) delete da substituição 1x', `count=${deletes4.length}`);
  assert(anthropicCalls4.length >= 1, 'C4) Anthropic chamado em re-roteamento (≥1)', `count=${anthropicCalls4.length}`);
  assert(resp4.includes('✅'), 'C4) resp contém ✅ da substituição', resp4.substring(0, 200));

  // ══════════════════════════════════════════════════════════════════
  // C5) Conflito + "pula"
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  setConflitos([{
    novo: { titulo: '🧘 Banho', data: 'hoje', hora: '17:00', duracao_minutos: 60 },
    existente: { id: 'evt_1', calendarId: 'primary', summary: 'Desenvolvimento Pessoal', startISO: '2026-05-19T17:00:00-03:00' },
  }]);

  const resp5 = await processarCalendar('pula', [], CHAT_ID);
  const deletes5 = callLog.filter(c => c.tipo === 'delete');
  const cria5 = callLog.filter(c => c.tipo === 'criarEvento');

  assert(deletes5.length === 0, 'C5) cal.events.delete NÃO chamado em pula', `count=${deletes5.length}`);
  assert(cria5.length === 0, 'C5) criarEvento NÃO chamado em pula', `count=${cria5.length}`);
  assert(/Mantive|conflito/i.test(resp5), 'C5) resp confirma "mantive"', resp5.substring(0, 100));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('💥 erro fatal:', e);
  console.log(`\n✅ ${passed} | ❌ ${failed} (interrompido)`);
  process.exit(1);
});
