// test-addmessage-humor-guard.js — Bug B (humor de role=assistant)
// Mock supabase via require.cache (padrão test-substituicao.js).
// Valida que addMessage não infere humor pra role=assistant mesmo
// quando o texto casa a regex permissiva de detectarHumor.

require('dotenv').config();

// ────────────────────────────────────────
// MOCKS via require.cache
// ────────────────────────────────────────

const insertLog = [];

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

// Mock @supabase/supabase-js — createClient retorna stub com .from().insert()
const supabaseStub = {
  from(table) {
    return {
      insert: async (payload) => {
        insertLog.push({ table, payload });
        return { error: null };
      },
      delete: () => ({ eq: () => ({ select: () => ({ then: () => Promise.resolve({ data: [], error: null }) }) }) }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }), limit: () => Promise.resolve({ data: [], error: null }) }) }),
      upsert: async () => ({ error: null }),
    };
  },
};

mockModule('@supabase/supabase-js', {
  createClient: () => supabaseStub,
});

// Mock @anthropic-ai/sdk — não chamado em addMessage mas memorySupabase importa
mockModule('@anthropic-ai/sdk', function () {
  return { messages: { create: async () => ({ content: [{ text: '{}' }] }) } };
});

// ────────────────────────────────────────
// Carrega memorySupabase APÓS mocks
// ────────────────────────────────────────

const { addMessage } = require('./src/services/memorySupabase');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

function clearLog() { insertLog.length = 0; }

async function run() {
  // ══════════════════════════════════════════════════════════════════
  // T1) addMessage('user', "tô ansiosa") → humor='ansiosa'
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  await addMessage('user', 'tô ansiosa');
  const t1Insert = insertLog.find(e => e.table === 'mensagens');
  assert(t1Insert, 'T1) insert em mensagens chamado');
  assert(t1Insert?.payload?.role === 'user', 'T1) role=user', `role=${t1Insert?.payload?.role}`);
  assert(t1Insert?.payload?.humor === 'ansiosa', 'T1) humor=ansiosa (regex casou)', `humor=${t1Insert?.payload?.humor}`);

  // ══════════════════════════════════════════════════════════════════
  // T2) addMessage('assistant', "vamos com calma e tudo bem") → humor=null
  //     (mesmo regex casando "calma" e "bem", guard bloqueia)
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  await addMessage('assistant', 'Vamos com calma e tudo bem, respira fundo');
  const t2Insert = insertLog.find(e => e.table === 'mensagens');
  assert(t2Insert, 'T2) insert em mensagens chamado');
  assert(t2Insert?.payload?.role === 'assistant', 'T2) role=assistant', `role=${t2Insert?.payload?.role}`);
  assert(t2Insert?.payload?.humor === null, 'T2) humor=null (regex bloqueada por role)', `humor=${t2Insert?.payload?.humor}`);

  // ══════════════════════════════════════════════════════════════════
  // T3) addMessage('assistant', "Você tá ansiosa") → humor=null
  //     (mesmo "ansiosa" casando, role assistant bloqueia)
  // ══════════════════════════════════════════════════════════════════
  clearLog();
  await addMessage('assistant', 'Você tá ansiosa');
  const t3Insert = insertLog.find(e => e.table === 'mensagens');
  assert(t3Insert, 'T3) insert em mensagens chamado');
  assert(t3Insert?.payload?.role === 'assistant', 'T3) role=assistant', `role=${t3Insert?.payload?.role}`);
  assert(t3Insert?.payload?.humor === null, 'T3) humor=null mesmo com regex casando', `humor=${t3Insert?.payload?.humor}`);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('💥 erro fatal:', e);
  process.exit(1);
});
