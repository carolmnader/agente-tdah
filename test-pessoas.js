// Teste isolado da Memória Social (CRM ativado).
// Mocka @anthropic-ai/sdk, googleapis e ../integrations/calendar via require.cache.
// Usa Supabase REAL para validar o fluxo completo de stub/lookup/contexto/ambiguidade.
//
// Rodar: node test-pessoas.js
require('dotenv').config();

// ────────────────────────────────────────
// MOCKS
// ────────────────────────────────────────

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

const callLog = [];
const responseQueue = [];
function pushResponse(text) { responseQueue.push(text); }
function clearLog() { callLog.length = 0; }

// Resposta default quando a fila esvazia (background fire-and-forget)
const DEFAULT_ANALYSIS = JSON.stringify({
  intent: 'chat', emotion: 'calm', urgency: 'low',
  has_task: false, task_text: null, has_victory: false, victory_text: null,
  energy_mentioned: false, energy_level: null, thinking_note: '',
  nomes_mencionados: [], pessoas_pergunta_sobre: false,
});

const AnthropicMock = function () {
  return {
    messages: {
      create: async (opts) => {
        callLog.push(opts);
        return { content: [{ text: responseQueue.shift() || DEFAULT_ANALYSIS }] };
      },
    },
  };
};
mockModule('@anthropic-ai/sdk', AnthropicMock);

mockModule('googleapis', {
  google: {
    calendar: () => ({
      events: {
        list: async () => ({ data: { items: [] } }),
        patch: async () => ({ data: { id: 'fake' } }),
      },
    }),
  },
});

mockModule('./src/integrations/calendar', {
  criarEvento: async (titulo, dh) => `✅ ${titulo} criado em ${dh.toISOString()}`,
  cancelarEvento: async (titulo) => `🗑️ ${titulo} cancelado`,
  reagendarEvento: async (titulo, novo) => `🔄 ${titulo} → ${novo}`,
  buscarEvento: async () => [],
  listarEventosHoje: async () => 'agenda vazia',
  listarEventosSemana: async () => 'semana vazia',
  proximoHorarioLivre: async () => 'amanhã 10h',
  detectarCategoria: () => 'Trabalho',
  CATEGORIAS: { Saúde: { cor: '11', emoji: '🏥' }, Trabalho: { cor: '9', emoji: '💼' } },
  getAuthClient: () => ({}),
});

// ────────────────────────────────────────
// MÓDULOS A TESTAR (após mocks)
// ────────────────────────────────────────
const { think } = require('./src/services/brain');
const { salvarOuAtualizarPessoa } = require('./src/services/crm');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEST_CHAT_ID = 999999998;
const TEST_NAMES = ['Test Marcela', 'Test Pilula', 'Test Ana', 'Test Ana Maria'];
let passed = 0, failed = 0;

function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${String(info || '').substring(0, 300)}`); }
}

async function cleanupTestData() {
  for (const nome of TEST_NAMES) {
    await supabase.from('pessoas').delete().eq('nome', nome);
  }
  await supabase.from('mensagens').delete().like('content', '%Test %');
  await supabase.from('acoes_pendentes').delete().eq('chat_id', TEST_CHAT_ID);
}

async function findPessoa(nome) {
  const { data } = await supabase.from('pessoas').select('*').eq('nome', nome).limit(1);
  return data?.[0] || null;
}

function lastSystemPrompt() {
  for (let i = callLog.length - 1; i >= 0; i--) {
    if (callLog[i].system) return callLog[i].system;
  }
  return '';
}

async function safetyCheck() {
  const { data } = await supabase.from('pessoas').select('nome').like('nome', 'Test %');
  if (data?.length > 0) {
    console.warn(`⚠️  Tabela pessoas já tem ${data.length} linha(s) com prefixo "Test ". Limpando antes de começar.`);
  }
}

async function run() {
  await safetyCheck();
  await cleanupTestData();

  try {
    // ═══════════════════════════════════════════════════
    // CENÁRIO A — Pessoa nova detectada
    // ═══════════════════════════════════════════════════
    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'schedule', emotion: 'calm', urgency: 'low',
      has_task: false, task_text: null, has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Marcela'], pessoas_pergunta_sobre: false,
    }));
    pushResponse('Beleza! 13h amanhã então. 💭 Quem é Test Marcela?');
    pushResponse(JSON.stringify({ fatos: [] }));

    const respA = await think('almoço com Test Marcela amanhã às 13h', TEST_CHAT_ID);

    const marcela = await findPessoa('Test Marcela');
    assert(marcela !== null, 'A.1) Test Marcela salva como stub no DB');
    assert(marcela?.relacionamento == null, 'A.2) Stub tem relacionamento null', marcela?.relacionamento);
    assert(/Test Marcela|almoço/i.test(marcela?.notas || ''), 'A.3) Notas contém trecho da mensagem original', marcela?.notas);
    assert(/PESSOAS NOVAS DETECTADAS/i.test(lastSystemPrompt()), 'A.4) System prompt instruiu pergunta no final');
    assert(/Test Marcela/i.test(respA || ''), 'A.5) Resposta menciona Test Marcela', respA);

    // ═══════════════════════════════════════════════════
    // CENÁRIO B — Pessoa conhecida
    // ═══════════════════════════════════════════════════
    await salvarOuAtualizarPessoa({ nome: 'Test Marcela', relacionamento: 'prima', notas: 'mora SP' });
    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'chat', emotion: 'calm', urgency: 'low',
      has_task: false, task_text: null, has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Marcela'], pessoas_pergunta_sobre: false,
    }));
    pushResponse('Que legal almoçar com sua prima!');
    pushResponse(JSON.stringify({ fatos: [] }));

    await think('vou almoçar com Test Marcela hoje', TEST_CHAT_ID);

    const sysB = lastSystemPrompt();
    assert(/PESSOAS NESTA CONVERSA/i.test(sysB), 'B.1) Bloco contextual de pessoas injetado no prompt');
    assert(/Test Marcela/.test(sysB) && /prima/i.test(sysB), 'B.2) Contexto inclui nome + relacionamento');
    assert(!/PESSOAS NOVAS DETECTADAS/i.test(sysB), 'B.3) NÃO instruiu pergunta (já é conhecida)');

    // ═══════════════════════════════════════════════════
    // CENÁRIO C — Falso positivo "Test Pilula"
    // ═══════════════════════════════════════════════════
    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'task', emotion: 'calm', urgency: 'low',
      has_task: true, task_text: 'tomar Test Pilula', has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Pilula'], pessoas_pergunta_sobre: false,
    }));
    pushResponse('Anotei a tarefa! 💭 Quem é Test Pilula?');
    pushResponse(JSON.stringify({ fatos: [] }));

    await think('preciso tomar Test Pilula às 8h', TEST_CHAT_ID);

    const pilula = await findPessoa('Test Pilula');
    assert(pilula !== null, 'C.1) Falso positivo salvo como stub (comportamento esperado, sem dano)');

    // ═══════════════════════════════════════════════════
    // CENÁRIO D — Test Ana ambígua, sem contexto recente
    // ═══════════════════════════════════════════════════
    await salvarOuAtualizarPessoa({ nome: 'Test Ana', relacionamento: 'irmã', notas: 'mora RJ' });
    await new Promise(r => setTimeout(r, 30));
    await salvarOuAtualizarPessoa({ nome: 'Test Ana Maria', relacionamento: 'colega trabalho', notas: 'designer' });

    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'chat', emotion: 'calm', urgency: 'low',
      has_task: false, task_text: null, has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Ana'], pessoas_pergunta_sobre: false,
    }));
    // (não enfileira generateResponse: esperamos short-circuit)

    const respD = await think('vou ligar pra Test Ana', TEST_CHAT_ID);

    assert(/qual/i.test(respD || '') && /Test Ana/i.test(respD || ''), 'D.1) ARIA pergunta "qual Test Ana?" (ambiguidade)', respD);
    assert(/irm[aã]/i.test(respD || '') && /trabalho/i.test(respD || ''), 'D.2) Pergunta lista as 2 opções (irmã + trabalho)', respD);
    const generateResponseFoi = callLog.some(c => c.system); // só generateResponse passa system
    assert(!generateResponseFoi, 'D.3) Short-circuit ANTES de generateResponse (não consumiu LLM principal)');

    // ═══════════════════════════════════════════════════
    // CENÁRIO E — Test Ana ambígua, MAS Test Ana Maria nos últimos 3 turnos
    // ═══════════════════════════════════════════════════
    // Insere mensagem prévia mencionando Test Ana Maria no histórico
    await supabase.from('mensagens').insert({
      role: 'user',
      content: 'Test Ana Maria me mandou um arquivo de design',
    });

    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'chat', emotion: 'calm', urgency: 'low',
      has_task: false, task_text: null, has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Ana'], pessoas_pergunta_sobre: false,
    }));
    pushResponse('Beleza, e a Test Ana respondeu sobre o projeto?');
    pushResponse(JSON.stringify({ fatos: [] }));

    const respE = await think('vou ligar pra Test Ana', TEST_CHAT_ID);

    assert(!/qual.*Test Ana/i.test(respE || ''), 'E.1) NÃO pergunta "qual Test Ana" (Test Ana Maria estava nos últimos 3 turnos)', respE);
    const sysE = lastSystemPrompt();
    assert(/Test Ana Maria/.test(sysE), 'E.2) Contexto injetou Test Ana Maria (a vencedora)', sysE.substring(0, 500));

    // ═══════════════════════════════════════════════════
    // CENÁRIO F — Carol ignora pergunta sobre pessoa nova (Test Pilula ainda existe)
    // ═══════════════════════════════════════════════════
    clearLog();
    pushResponse(JSON.stringify({ acao: 'nao_e_calendar' }));
    pushResponse(JSON.stringify({
      intent: 'chat', emotion: 'calm', urgency: 'low',
      has_task: false, task_text: null, has_victory: false, victory_text: null,
      energy_mentioned: false, energy_level: null, thinking_note: '',
      nomes_mencionados: ['Test Pilula'], pessoas_pergunta_sobre: false,
    }));
    pushResponse('Beleza, anotei.');
    pushResponse(JSON.stringify({ fatos: [] }));

    await think('vou tomar Test Pilula de novo agora', TEST_CHAT_ID);

    assert(!/PESSOAS NOVAS DETECTADAS/i.test(lastSystemPrompt()), 'F.1) NÃO instruiu pergunta de novo (Test Pilula já está no DB)');
    const pilulaDepois = await findPessoa('Test Pilula');
    assert(pilulaDepois?.relacionamento == null, 'F.2) Relacionamento permanece null (Carol ignorou pergunta anterior)');

  } finally {
    await cleanupTestData();
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
