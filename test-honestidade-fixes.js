// test-honestidade-fixes.js — testes de Bugs #11, #12, #13 (família Honestidade da ARIA).
//
// 4 cenários:
//   H1) criarEvento com mock retornando sem data.id → throw CalendarInsertError
//   H2) processarCalendar com intent consultar_evento + buscarEvento vazio → "Não achei"
//   H3) classifyBrainError tipa erros corretamente (Anthropic 400, Calendar, Supabase, genérico)
//   H4) processarCalendar propaga erro (não engole) quando fluxo interno lança
//
// Rodar: node test-honestidade-fixes.js
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

// ────────────────────────────────────────────────────────
// MOCKS — googleapis controlável + supabase no-op + anthropic controlável
// ────────────────────────────────────────────────────────
let insertReturn = { data: { id: 'fake-event-id' }, status: 200 };
let insertShouldThrow = null;
const googleapisMock = {
  google: {
    auth: { OAuth2: function () { return { setCredentials: () => {} }; } },
    calendar: () => ({
      events: {
        insert: async () => {
          if (insertShouldThrow) throw insertShouldThrow;
          return insertReturn;
        },
        list: async () => ({ data: { items: [] } }),
        patch: async () => ({ data: { id: 'fake-event-id' } }),
      },
    }),
  },
};
mockModule('googleapis', googleapisMock);

// memorySupabase noop pra não precisar de banco
mockModule('./src/services/memorySupabase', {
  salvarMemoria: async () => {},
  buscarMemoriaPorChave: async () => [],
  salvarAcaoPendente: async () => {},
  buscarAcaoPendente: async () => null,
  limparAcaoPendente: async () => {},
});

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

// ────────────────────────────────────────────────────────
// H1) criarEvento — events.insert retorna sem data.id → throw CalendarInsertError
// ────────────────────────────────────────────────────────
async function h1() {
  const { criarEvento, CalendarInsertError } = require('./src/integrations/calendar');

  // Sem data.id (200 vazio)
  insertReturn = { data: {}, status: 200 };
  insertShouldThrow = null;
  let pegou = null;
  try {
    await criarEvento('TESTE-H1', new Date('2026-05-10T14:00:00-03:00'), 60, 'Trabalho');
  } catch (e) { pegou = e; }
  assert(
    pegou && pegou instanceof CalendarInsertError,
    'H1a) sem data.id → throw CalendarInsertError',
    `pegou=${pegou?.constructor?.name}: ${pegou?.message}`
  );

  // events.insert lança erro real (ex: 401) → encapsulado em CalendarInsertError
  insertReturn = { data: { id: 'whatever' }, status: 200 };
  insertShouldThrow = Object.assign(new Error('Invalid Credentials'), { code: 401 });
  pegou = null;
  try {
    await criarEvento('TESTE-H1b', new Date('2026-05-10T14:00:00-03:00'), 60, 'Trabalho');
  } catch (e) { pegou = e; }
  assert(
    pegou && pegou instanceof CalendarInsertError && /Invalid Credentials/.test(pegou.message),
    'H1b) erro da API → encapsulado em CalendarInsertError com cause',
    `pegou=${pegou?.constructor?.name}: ${pegou?.message}, cause=${pegou?.cause?.message}`
  );

  // Path feliz: data.id presente → string de sucesso (não throw)
  insertReturn = { data: { id: 'evt-123' }, status: 200 };
  insertShouldThrow = null;
  let resp = null;
  try {
    resp = await criarEvento('TESTE-H1c', new Date('2026-05-10T14:00:00-03:00'), 60, 'Trabalho');
  } catch (e) { /* não deve cair aqui */ }
  assert(
    typeof resp === 'string' && /Agendado/i.test(resp),
    'H1c) data.id presente → mensagem de sucesso',
    `resp=${String(resp).substring(0, 100)}`
  );
}

// ────────────────────────────────────────────────────────
// H2) processarCalendar com consultar_evento + buscarEvento vazio → "Não achei"
// ────────────────────────────────────────────────────────
async function h2() {
  // Mock buscarEvento vazio (apaga o cache atual e re-mocka)
  delete require.cache[require.resolve('./src/integrations/calendar')];
  delete require.cache[require.resolve('./src/services/calendarBrain')];

  // Re-mocka googleapis com events.list vazio (buscarEvento retorna [])
  insertReturn = { data: { id: 'fake' }, status: 200 };
  insertShouldThrow = null;

  const { processarCalendar } = require('./src/services/calendarBrain');

  setNextIntent({ acao: 'consultar_evento', evento_original: 'reuniao-fake-zzz', sinonimos_busca: [] });
  const resp = await processarCalendar('que horas é a reuniao-fake-zzz?', [], 999999998);

  assert(
    typeof resp === 'string' && /n[aã]o achei/i.test(resp) && !/\d{1,2}[:h]\d{0,2}/.test(resp),
    'H2) consultar_evento sem hit → "Não achei", sem horário inferido',
    `resp=${String(resp).substring(0, 200)}`
  );
}

// ────────────────────────────────────────────────────────
// H3) classifyBrainError — roteador puro de erro
// ────────────────────────────────────────────────────────
function h3() {
  // brain.js importa muita coisa pesada (analytics, holistic, hipoteses…). Isolar via mock
  // dos módulos de domínio que não usamos pro teste de classifyBrainError.
  const noop = () => ({});
  const noopAsync = async () => null;
  ['./src/services/memorySupabase', './src/services/obsidian', './src/services/selfImprove',
   './src/modules/holistic', './src/integrations/astrology', './src/modules/ayurveda',
   './src/prompts/holistic-context', './src/services/crm', './src/services/analytics',
   './src/services/hipoteses', './src/services/sugestoes', './src/prompts/detectorPadroes',
   './src/services/validadorImplicito']
    .forEach(p => { try { mockModule(p, new Proxy({}, { get: () => noopAsync })); } catch {} });

  delete require.cache[require.resolve('./src/services/brain')];
  const { classifyBrainError } = require('./src/services/brain');

  // Anthropic invalid_request_error (saldo zerado, etc)
  const e1 = Object.assign(new Error('400'), { status: 400, error: { type: 'invalid_request_error' } });
  assert(/invalid_request_error/.test(classifyBrainError(e1)), 'H3a) Anthropic invalid_request → menciona tipo', classifyBrainError(e1));

  // Anthropic auth
  const e2 = Object.assign(new Error('401'), { status: 401, error: { type: 'authentication_error' } });
  assert(/ANTHROPIC_API_KEY/.test(classifyBrainError(e2)), 'H3b) Anthropic auth → menciona env var', classifyBrainError(e2));

  // Anthropic rate limit
  const e3 = Object.assign(new Error('429'), { status: 429, error: { type: 'rate_limit_error' } });
  assert(/rate limit/i.test(classifyBrainError(e3)), 'H3c) Anthropic rate_limit → menciona "rate limit"', classifyBrainError(e3));

  // Anthropic overloaded
  const e4 = Object.assign(new Error('529'), { status: 529, error: { type: 'overloaded_error' } });
  assert(/sobrecarregad/i.test(classifyBrainError(e4)), 'H3d) Anthropic overloaded → menciona sobrecarregada', classifyBrainError(e4));

  // CalendarOperationError
  const e5 = Object.assign(new Error('falha calendar'), { name: 'CalendarOperationError' });
  assert(/Calendar n[aã]o respondeu/i.test(classifyBrainError(e5)), 'H3e) CalendarOperationError → "Calendar não respondeu"', classifyBrainError(e5));

  // CalendarInsertError
  const e5b = Object.assign(new Error('falha insert'), { name: 'CalendarInsertError' });
  assert(/Calendar n[aã]o respondeu/i.test(classifyBrainError(e5b)), 'H3f) CalendarInsertError → "Calendar não respondeu"', classifyBrainError(e5b));

  // Supabase / PostgREST
  const e6 = Object.assign(new Error('PGRST116'), { code: 'PGRST116' });
  assert(/Banco fora/i.test(classifyBrainError(e6)), 'H3g) PGRST → "Banco fora do ar"', classifyBrainError(e6));

  // Genérico desconhecido (TypeError) → fallback original
  const e7 = new TypeError('cannot read prop of undefined');
  assert(/probleminha t[ée]cnico/i.test(classifyBrainError(e7)), 'H3h) erro desconhecido → fallback genérico preservado', classifyBrainError(e7));
}

// ────────────────────────────────────────────────────────
// H4) processarCalendar propaga (não engole) quando fluxo lança
// ────────────────────────────────────────────────────────
async function h4() {
  // Reseta caches pra usar o mock de Anthropic que vai lançar
  delete require.cache[require.resolve('./src/services/calendarBrain')];

  // Faz Anthropic mock retornar JSON inválido → JSON.parse lança → outer catch deve THROW (não engolir)
  const AnthropicThrowMock = function () {
    return {
      messages: {
        create: async () => ({ content: [{ text: 'isso não é json válido {{{' }] }),
      },
    };
  };
  mockModule('@anthropic-ai/sdk', AnthropicThrowMock);

  const { processarCalendar } = require('./src/services/calendarBrain');
  const { CalendarOperationError } = require('./src/integrations/calendar');

  let pegou = null;
  try {
    await processarCalendar('agenda almoço amanhã às 13h', [], 999999997);
  } catch (e) { pegou = e; }
  assert(
    pegou && pegou instanceof CalendarOperationError,
    'H4) JSON inválido do Opus → throw CalendarOperationError (não null silencioso)',
    `pegou=${pegou?.constructor?.name}: ${pegou?.message}`
  );
}

// ────────────────────────────────────────────────────────
// H5) preClassificarConsulta — pega perguntas claras, ignora falsos positivos
// ────────────────────────────────────────────────────────
function h5() {
  delete require.cache[require.resolve('./src/services/calendarBrain')];
  const { preClassificarConsulta } = require('./src/services/calendarBrain');

  // Verdadeiros positivos
  const positivos = [
    ['que horas é o almoço?', 'almoço'],
    ['Que horas é o almoço hoje?', 'almoço'],
    ['quando é a reunião com Ana?', 'reunião com Ana'],
    ['a que horas é meu treino amanhã?', 'treino'],
    ['tem psicólogo amanhã?', 'psicólogo'],
    ['tenho almoço com Marcela hoje?', 'almoço com Marcela'],
  ];
  positivos.forEach(([msg, termoEsperado]) => {
    const r = preClassificarConsulta(msg);
    assert(
      r?.acao === 'consultar_evento' && r.evento_original?.toLowerCase().includes(termoEsperado.toLowerCase()),
      `H5+) "${msg}" → consultar_evento "${termoEsperado}"`,
      `result=${JSON.stringify(r)}`
    );
  });

  // Falsos positivos (NÃO devem virar consultar_evento)
  const negativos = [
    'tenho que fazer mil coisas hoje',
    'tenho de comprar pão',
    'tem comida na geladeira?',
    'tem alguém aí?',
    'tem certeza?',
    'agenda almoço amanhã às 13h',
    'muda o almoço pra 14h',
    'cancela o psicólogo',
    'tenho ideia de fazer um projeto',
  ];
  negativos.forEach(msg => {
    const r = preClassificarConsulta(msg);
    assert(r === null, `H5-) "${msg}" → NÃO bypassa Opus (null)`, `result=${JSON.stringify(r)}`);
  });
}

// ────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────
(async () => {
  try {
    await h1();
    await h2();
    h3();
    await h4();
    h5();
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error('💥 erro fatal:', e);
    process.exit(1);
  }
})();
