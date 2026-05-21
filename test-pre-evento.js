// test-pre-evento.js — Bug pre-evento (janela 1min, INSERT pre-envio, catch silencioso)
//
// Valida fix Commit 5:
//   - Janela alargada 25-35min (não dá pra unit testar diretamente — testes T6/T7
//     focam no comportamento de robustez por evento e por calendário)
//   - INSERT POS-envio: jaNotificado check-then-act, marcarNotificado após send OK
//   - Try interno por evento: 1 evento ruim não interrompe outros
//   - Log estruturado no catch (antes era silencioso)
//
// 7 cenários: T1-T7
//
// Rodar: node -r dotenv/config test-pre-evento.js dotenv_config_path=...

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

// ─── State controlável pelos cenários ─────────────────
let supabaseSelectData = null;       // null = não notificado
let supabaseSelectError = null;
let supabaseInsertResult = null;     // { data, error } ou null = sucesso default
let calEventsListResult = { data: { items: [] } };
let calEventsListShouldThrow = null;
let anthropicShouldThrow = null;
let sendShouldThrow = null;
let sendCallCount = 0;
let marcarNotificadoCallCount = 0;
let consoleLogs = [];
let consoleErrors = [];

function reset() {
  supabaseSelectData = null;
  supabaseSelectError = null;
  supabaseInsertResult = null;
  calEventsListResult = { data: { items: [] } };
  calEventsListShouldThrow = null;
  anthropicShouldThrow = null;
  sendShouldThrow = null;
  sendCallCount = 0;
  marcarNotificadoCallCount = 0;
  consoleLogs = [];
  consoleErrors = [];
}

// ─── Mocks (no top, antes de require do scheduler) ────

// googleapis
mockModule('googleapis', {
  google: {
    auth: { OAuth2: function () { return { setCredentials: () => {} }; } },
    calendar: () => ({
      events: {
        list: async () => {
          if (calEventsListShouldThrow) throw calEventsListShouldThrow;
          return calEventsListResult;
        },
        insert: async () => ({ data: { id: 'fake' }, status: 200 }),
        delete: async () => ({ data: {} }),
        patch: async () => ({ data: {} }),
      },
    }),
  },
});

// @supabase/supabase-js — controla jaNotificado e marcarNotificado via state vars
const supabaseStub = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: supabaseSelectData, error: supabaseSelectError }),
        }),
      }),
    }),
    insert: () => ({
      select: () => ({
        maybeSingle: async () => {
          marcarNotificadoCallCount++;
          if (supabaseInsertResult) return supabaseInsertResult;
          return { data: { evento_id: 'mock' }, error: null };
        },
      }),
    }),
    delete: () => ({ lt: async () => ({ count: 0, error: null }) }),
  }),
};
mockModule('@supabase/supabase-js', { createClient: () => supabaseStub });

// @anthropic-ai/sdk
mockModule('@anthropic-ai/sdk', function () {
  return {
    messages: {
      create: async () => {
        if (anthropicShouldThrow) throw anthropicShouldThrow;
        return { content: [{ text: 'Almoço em 28 minutos.' }] };
      },
    },
  };
});

// telegram service
mockModule('./src/services/telegram', {
  sendTelegramMessage: async () => {
    sendCallCount++;
    if (sendShouldThrow) throw sendShouldThrow;
    return;
  },
  enviarMensagemLonga: async () => {
    sendCallCount++;
    if (sendShouldThrow) throw sendShouldThrow;
    return;
  },
});

// prompts/system — gerarMensagemProativa usa normalizarTratamento e SYSTEM_PROMPT
mockModule('./src/prompts/system', {
  SYSTEM_PROMPT: 'mock system prompt',
  normalizarTratamento: (text) => text,
});

// node-cron — scheduler.js chama cron.schedule no iniciarScheduler, mas só se invocado
mockModule('node-cron', { schedule: () => ({ stop: () => {} }) });

// Dependências decorativas (não invocadas em jobPreEvento)
const noopProxy = new Proxy({}, { get: () => async () => null });
[
  './src/services/memorySupabase',
  './src/services/obsidian',
  './src/integrations/astrology',
  './src/modules/ayurveda',
  './src/services/crm',
  './src/services/analytics',
  './src/services/hipoteses',
  './src/services/analiseNoturna',
  './src/services/sugestoes',
  './src/services/oura',
  './src/services/detectarPerformaSubjetividade',
  './src/services/weeklyReview',
].forEach(p => { try { mockModule(p, noopProxy); } catch {} });

// ─── Captura console ──────────────────────────────────
const origLog = console.log;
const origError = console.error;
console.log = (...args) => {
  consoleLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.error = (...args) => {
  consoleErrors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};

// ─── Setup env e require scheduler ────────────────────
process.env.TELEGRAM_CHAT_ID_CAROL = '999999991';
process.env.GOOGLE_CALENDAR_IDS = 'primary';

const { jobPreEvento } = require('./src/jobs/scheduler');
const { marcarNotificado } = require('./src/services/eventosNotificados');

// Helpers
function mockEvento(id, summary, minutosAtFuture = 28) {
  const start = new Date(Date.now() + minutosAtFuture * 60000);
  return {
    id,
    summary,
    start: { dateTime: start.toISOString() },
    location: 'não especificado',
  };
}

// ─── Cenários ─────────────────────────────────────────

// T1: jaNotificado=false + send sucesso → marcarNotificado é chamado, log "✅ Lembrete"
async function t1() {
  reset();
  calEventsListResult = { data: { items: [mockEvento('ev-t1', 'Almoço')] } };
  // supabaseSelectData = null → jaNotificado retorna false

  await jobPreEvento();

  assert(
    sendCallCount === 1 && marcarNotificadoCallCount === 1 &&
    consoleLogs.some(l => /Lembrete pré-evento/.test(l)) &&
    consoleErrors.length === 0,
    'T1) jaNotificado=false + send OK → marcarNotificado chamado + log Lembrete',
    `sendCallCount=${sendCallCount} marcarCount=${marcarNotificadoCallCount} logs=${consoleLogs.length} errors=${consoleErrors.length}`
  );
}

// T2: jaNotificado=true → fluxo skipa, send NÃO chamado, log "ja notificado"
async function t2() {
  reset();
  calEventsListResult = { data: { items: [mockEvento('ev-t2', 'Treino')] } };
  supabaseSelectData = { evento_id: 'ev-t2' }; // → jaNotificado retorna true

  await jobPreEvento();

  assert(
    sendCallCount === 0 && marcarNotificadoCallCount === 0 &&
    consoleLogs.some(l => /ja notificado/i.test(l)),
    'T2) jaNotificado=true → skip send + skip marcarNotificado + log "ja notificado"',
    `sendCallCount=${sendCallCount} marcarCount=${marcarNotificadoCallCount} logs=${JSON.stringify(consoleLogs)}`
  );
}

// T3: send lança erro → catch interno loga + marcarNotificado NÃO chamado
async function t3() {
  reset();
  calEventsListResult = { data: { items: [mockEvento('ev-t3', 'Reunião')] } };
  sendShouldThrow = Object.assign(new Error('Telegram 5xx'), { status: 500 });

  await jobPreEvento();

  assert(
    sendCallCount === 1 && marcarNotificadoCallCount === 0 &&
    consoleErrors.some(e => /pre-evento item/.test(e)) &&
    consoleErrors.some(e => /Telegram 5xx/.test(e)),
    'T3) send falha → marcarNotificado NÃO chamado (evento livre pro próximo cron) + log estruturado',
    `sendCallCount=${sendCallCount} marcarCount=${marcarNotificadoCallCount} errors=${JSON.stringify(consoleErrors)}`
  );
}

// T4: marcarNotificado retorna PK conflict (23505) → função retorna true (race ok)
async function t4() {
  reset();
  supabaseInsertResult = { data: null, error: { code: '23505', message: 'duplicate key' } };

  const r = await marcarNotificado('ev-t4', 'pre_evento_30min');

  assert(
    r === true && consoleErrors.length === 0,
    'T4) marcarNotificado com PK conflict (23505) → retorna true (race tratada como sucesso)',
    `r=${r} errors=${JSON.stringify(consoleErrors)}`
  );
}

// T5: gerarMensagemProativa lança → catch interno loga + loop continua
async function t5() {
  reset();
  calEventsListResult = {
    data: {
      items: [
        mockEvento('ev-t5a', 'EventoA'),
        mockEvento('ev-t5b', 'EventoB'),
      ],
    },
  };
  // 1o evento: anthropic lança, 2o segue normal
  let calls = 0;
  anthropicShouldThrow = null;
  // sobrescreve mock pra falhar só na 1a chamada
  const originalAnthropic = require.cache[require.resolve('@anthropic-ai/sdk')].exports;
  require.cache[require.resolve('@anthropic-ai/sdk')].exports = function () {
    return {
      messages: {
        create: async () => {
          calls++;
          if (calls === 1) throw Object.assign(new Error('Opus 529'), { status: 529, error: { type: 'overloaded_error' } });
          return { content: [{ text: 'EventoB em 28 minutos.' }] };
        },
      },
    };
  };
  // Re-require scheduler pra pegar Anthropic mock atualizado
  delete require.cache[require.resolve('./src/jobs/scheduler')];
  const { jobPreEvento: jobPreEvento2 } = require('./src/jobs/scheduler');

  await jobPreEvento2();

  // Restaura
  require.cache[require.resolve('@anthropic-ai/sdk')].exports = originalAnthropic;

  assert(
    sendCallCount === 1 && marcarNotificadoCallCount === 1 &&
    consoleErrors.some(e => /pre-evento item/.test(e) && /Opus 529/.test(e)),
    'T5) anthropic lança no 1o evento → catch loga + 2o evento processa normalmente',
    `sendCallCount=${sendCallCount} marcarCount=${marcarNotificadoCallCount} errors=${consoleErrors.length}`
  );
}

// T6: cal.events.list lança → catch externo loga + tenta próximo calendarId
async function t6() {
  reset();
  process.env.GOOGLE_CALENDAR_IDS = 'cal1,cal2';
  let listCalls = 0;
  calEventsListShouldThrow = null;
  // Sobrescreve googleapis pra falhar só na 1a chamada
  const origGoogleapis = require.cache[require.resolve('googleapis')].exports;
  require.cache[require.resolve('googleapis')].exports = {
    google: {
      auth: { OAuth2: function () { return { setCredentials: () => {} }; } },
      calendar: () => ({
        events: {
          list: async () => {
            listCalls++;
            if (listCalls === 1) throw Object.assign(new Error('Google 401'), { code: 401 });
            return { data: { items: [mockEvento('ev-t6', 'EventoCal2')] } };
          },
          insert: async () => ({ data: { id: 'fake' }, status: 200 }),
          delete: async () => ({ data: {} }),
          patch: async () => ({ data: {} }),
        },
      }),
    },
  };
  delete require.cache[require.resolve('./src/jobs/scheduler')];
  const { jobPreEvento: jobPreEvento3 } = require('./src/jobs/scheduler');

  await jobPreEvento3();

  // Restaura
  require.cache[require.resolve('googleapis')].exports = origGoogleapis;
  process.env.GOOGLE_CALENDAR_IDS = 'primary';

  assert(
    listCalls === 2 && sendCallCount === 1 &&
    consoleErrors.some(e => /pre-evento calendario/.test(e) && /Google 401/.test(e)),
    'T6) cal1 list lança → catch externo loga + cal2 processa normalmente',
    `listCalls=${listCalls} sendCallCount=${sendCallCount} errors=${consoleErrors.length}`
  );
}

// T7: 2 eventos na janela, 1o falha em send → 2o continua normalmente
async function t7() {
  reset();
  calEventsListResult = {
    data: {
      items: [
        mockEvento('ev-t7a', 'EventoA'),
        mockEvento('ev-t7b', 'EventoB'),
      ],
    },
  };
  // sendTelegramMessage falha só na 1a chamada
  let sendCalls = 0;
  const origTelegram = require.cache[require.resolve('./src/services/telegram')].exports;
  require.cache[require.resolve('./src/services/telegram')].exports = {
    sendTelegramMessage: async () => {
      sendCalls++;
      if (sendCalls === 1) throw new Error('Telegram timeout');
      return;
    },
    enviarMensagemLonga: async () => {},
  };
  delete require.cache[require.resolve('./src/jobs/scheduler')];
  const { jobPreEvento: jobPreEvento4 } = require('./src/jobs/scheduler');

  await jobPreEvento4();

  // Restaura
  require.cache[require.resolve('./src/services/telegram')].exports = origTelegram;

  assert(
    sendCalls === 2 && marcarNotificadoCallCount === 1 &&
    consoleErrors.some(e => /pre-evento item/.test(e) && /Telegram timeout/.test(e)) &&
    consoleLogs.some(l => /Lembrete pré-evento/.test(l)),
    'T7) 2 eventos, 1o send falha → 2o processa normalmente (catch é por-evento)',
    `sendCalls=${sendCalls} marcarCount=${marcarNotificadoCallCount} errors=${consoleErrors.length}`
  );
}

// ─── Runner ───────────────────────────────────────────
(async () => {
  try {
    await t1();
    await t2();
    await t3();
    await t4();
    await t5();
    await t6();
    await t7();

    // Restaura console
    console.log = origLog;
    console.error = origError;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.log = origLog;
    console.error = origError;
    console.error('💥 erro fatal:', e);
    process.exit(1);
  }
})();
