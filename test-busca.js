// Teste isolado do Bug #7 (busca robusta com normalização + fallback).
// 5 cenários de normalização (puro JS) + 2 cenários de fallback (mock do Google Calendar API).
//
// Rodar: node test-busca.js
require('dotenv').config();

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

// Contadores + respostas configuráveis por cenário
let qCallCount = 0, fallbackCallCount = 0;
let qReturns = [], fallbackReturns = [];

const googleapisMock = {
  google: {
    auth: { OAuth2: function () { return { setCredentials: () => {} }; } },
    calendar: () => ({
      events: {
        list: async (opts) => {
          if (opts.q) { qCallCount++;        return { data: { items: qReturns } }; }
          else        { fallbackCallCount++; return { data: { items: fallbackReturns } }; }
        },
      },
    }),
  },
};
mockModule('googleapis', googleapisMock);

const { normalizarBusca, buscarEvento } = require('./src/integrations/calendar');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// ── N.1-N.5: normalização ──
const normCases = [
  { input: '🍽️ Almoço',    esperado: 'almoco' },
  { input: 'ALMOÇO',          esperado: 'almoco' },
  { input: '  Almoço  ',      esperado: 'almoco' },
  { input: 'salão da Ana',    esperado: 'salao da ana' },
  { input: null,              esperado: '' },
];
normCases.forEach(({ input, esperado }, idx) => {
  const real = normalizarBusca(input);
  assert(
    real === esperado,
    `N.${idx + 1}) normalizarBusca(${JSON.stringify(input)}) → ${JSON.stringify(real)}`,
    `esperado: ${JSON.stringify(esperado)}`
  );
});

// ── F.1: q-path vazio, fallback retorna match (simula race H3) ──
async function f1() {
  qCallCount = 0; fallbackCallCount = 0;
  qReturns = []; // q-path sempre empty — simula Google search index com lag
  fallbackReturns = [
    { summary: '🍽️ Almoço',              start: { dateTime: '2026-04-20T13:00:00-03:00' } },
    { summary: '🌿 Buffer / Transição',   start: { dateTime: '2026-04-20T14:00:00-03:00' } },
  ];
  const res = await buscarEvento('almoço');
  assert(
    qCallCount > 0 && fallbackCallCount > 0 && res.length > 0,
    'F.1) q-path vazio + fallback encontra "🍽️ Almoço" via match normalizado',
    `qCalls=${qCallCount}, fallbackCalls=${fallbackCallCount}, res.length=${res.length}`
  );
  assert(
    res.every(ev => !ev.summary?.includes('Buffer')),
    'F.1b) Filtro de Buffer aplicado no fallback',
    res.map(r => r.summary).join(', ')
  );
}

// ── F.2: q-path retorna hit → fallback NÃO é chamado ──
async function f2() {
  qCallCount = 0; fallbackCallCount = 0;
  qReturns = [{ summary: '🍽️ Almoço hit', start: { dateTime: '2026-04-20T13:00:00-03:00' } }];
  fallbackReturns = []; // não deveria ser consultado
  const res = await buscarEvento('almoço');
  assert(
    res.length > 0 && fallbackCallCount === 0,
    'F.2) q-path retorna hit → fallback NÃO é chamado (contador=0)',
    `qCalls=${qCallCount}, fallbackCalls=${fallbackCallCount}, res.length=${res.length}`
  );
}

(async () => {
  await f1();
  await f2();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('💥 erro fatal:', e);
  process.exit(1);
});
