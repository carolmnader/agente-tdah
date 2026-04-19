// Teste isolado do guard de confirmação para Calendar.
// Mocka @anthropic-ai/sdk, googleapis e ../integrations/calendar via require.cache.
// Usa Supabase REAL para validar o fluxo completo de salvar/buscar/limpar acoes_pendentes.
//
// Rodar: node test-guard.js
require('dotenv').config();

// ────────────────────────────────────────
// MOCKS — populamos require.cache ANTES de carregar calendarBrain.js
// ────────────────────────────────────────

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

// 1) Mock @anthropic-ai/sdk: constructor → { messages.create() } retorna intent JSON
let nextIntent = { acao: 'nao_e_calendar' };
function setNextIntent(i) { nextIntent = i; }

const AnthropicMock = function () {
  return {
    messages: {
      create: async () => ({ content: [{ text: JSON.stringify(nextIntent) }] }),
    },
  };
};
mockModule('@anthropic-ai/sdk', AnthropicMock);

// 2) Mock googleapis (cal.events.list/patch)
const googleapisMock = {
  google: {
    calendar: () => ({
      events: {
        list: async () => ({ data: { items: [] } }),
        patch: async () => ({ data: { id: 'fake-event-id' } }),
      },
    }),
  },
};
mockModule('googleapis', googleapisMock);

// 3) Mock ../integrations/calendar (criarEvento, cancelarEvento, etc.)
const calendarIntegrationMock = {
  criarEvento: async (titulo, dh) => `✅ <b>${titulo}</b> criado em ${dh.toISOString()}`,
  cancelarEvento: async (titulo) => `🗑️ Evento "${titulo}" cancelado`,
  reagendarEvento: async (titulo, novo) => `🔄 "${titulo}" → ${novo}`,
  buscarEvento: async (termo) => [{
    id: 'fake-event-id',
    summary: `🧠 ${termo}`,
    start: { dateTime: '2026-04-22T14:00:00-03:00' },
    organizer: { email: 'primary' },
  }],
  listarEventosHoje: async () => 'agenda vazia',
  listarEventosSemana: async () => 'semana vazia',
  proximoHorarioLivre: async () => 'amanhã 10h',
  detectarCategoria: () => 'Saúde',
  CATEGORIAS: {
    Saúde:    { cor: '11', emoji: '🏥' },
    Trabalho: { cor: '9',  emoji: '💼' },
    Selfcare: { cor: '4',  emoji: '💚' },
    Eventos:  { cor: '5',  emoji: '🎉' },
  },
  getAuthClient: () => ({}),
};
mockModule('./src/integrations/calendar', calendarIntegrationMock);

// ────────────────────────────────────────
// AGORA carrega o módulo a ser testado (após os mocks)
// ────────────────────────────────────────
const { processarCalendar } = require('./src/services/calendarBrain');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_CHAT_ID = 999999999;
let passed = 0, failed = 0;

function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   resp: ${String(info || '').substring(0, 250)}`); }
}

async function cleanupRow() {
  await supabase.from('acoes_pendentes').delete().eq('chat_id', TEST_CHAT_ID);
}

async function run() {
  try {
    await cleanupRow();

    // A) criar 1 evento → cria direto sem confirmar
    setNextIntent({ acao: 'criar', titulo: 'Almoço', data: 'amanha', hora: '13:00', duracao_minutos: 60, calendario: 'Eventos' });
    let resp = await processarCalendar('agenda almoço amanhã às 13h', [], TEST_CHAT_ID);
    assert(
      /criado/i.test(resp || '') && !/Confirma/i.test(resp || ''),
      'A) criar 1 evento → cria direto sem confirmar', resp
    );

    // B) pedir cancelar → pede confirmação
    setNextIntent({ acao: 'cancelar', evento_original: 'psicólogo' });
    resp = await processarCalendar('cancela o psicólogo', [], TEST_CHAT_ID);
    assert(
      /Confirma cancelar/i.test(resp || '') && /sim.*n[aã]o/i.test(resp || ''),
      'B) cancelar → pede confirmação', resp
    );

    // C) responder "sim" → executa cancelamento (mock)
    setNextIntent({ acao: 'nao_e_calendar' });
    resp = await processarCalendar('sim', [], TEST_CHAT_ID);
    assert(
      /cancelado/i.test(resp || ''),
      'C) sim após cancelar → executa cancelamento', resp
    );

    // D) pedir reagendar → pede confirmação
    setNextIntent({ acao: 'reagendar', evento_original: 'salão', nova_hora: '16:00', data: 'hoje' });
    resp = await processarCalendar('muda o salão pra 16h', [], TEST_CHAT_ID);
    assert(
      /Confirma mover/i.test(resp || '') && /sim.*n[aã]o/i.test(resp || ''),
      'D) reagendar → pede confirmação', resp
    );

    // E) responder "não" → "ok, não mexi em nada"
    setNextIntent({ acao: 'nao_e_calendar' });
    resp = await processarCalendar('não', [], TEST_CHAT_ID);
    assert(
      /n[aã]o mexi/i.test(resp || ''),
      'E) não → "ok, não mexi em nada"', resp
    );

    // F.1) mudar_calendario → pede confirmação
    setNextIntent({ acao: 'mudar_calendario', evento_original: 'treino', calendario: 'Saúde' });
    resp = await processarCalendar('muda categoria do treino pra Saúde', [], TEST_CHAT_ID);
    assert(
      /Confirma mover/i.test(resp || '') && /Sa[úu]de/i.test(resp || '') && /sim.*n[aã]o/i.test(resp || ''),
      'F.1) mudar_categoria → pede confirmação', resp
    );

    // F.2) força criada_em pra 6 min atrás → "sim" deve ser ignorado
    await supabase
      .from('acoes_pendentes')
      .update({ criada_em: new Date(Date.now() - 6 * 60 * 1000).toISOString() })
      .eq('chat_id', TEST_CHAT_ID);
    setNextIntent({ acao: 'nao_e_calendar' });
    resp = await processarCalendar('sim', [], TEST_CHAT_ID);
    assert(
      resp === null && !/agora está em/i.test(resp || ''),
      'F.2) sim após timeout (>5min) → ignorado, ação NÃO executa', resp
    );

  } finally {
    await cleanupRow();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('💥 erro fatal:', e);
  console.log(`\n✅ ${passed} | ❌ ${failed} (interrompido)`);
  process.exit(1);
});
