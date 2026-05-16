// test-superseded.js — Onda 1.3 Fase D
// Testa salvarMemoriaComHistorico, detectorContradicao (mockado), filtro Fase B
// Mock retorna lista controlada de IDs contraditos sem chamar Haiku real.

require('dotenv').config();

const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_ANON_KEY ausente do .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Mock injetado ANTES do require de memorySupabase
const detectorMock = { fakeContradicoes: [] };

require.cache[require.resolve('./src/services/detectorContradicao.js')] = {
  exports: {
    detectarContradicao: async () => detectorMock.fakeContradicoes
  }
};

const { salvarMemoriaComHistorico, buscarMemorias } = require('./src/services/memorySupabase.js');

const TEST_CATEGORIA = 'teste_superseded';

async function cleanup() {
  await supabase.from('memorias').delete().eq('categoria', TEST_CATEGORIA);
}

async function inserirAntigos() {
  await supabase.from('memorias').insert([
    { categoria: TEST_CATEGORIA, chave: 'exercicio', valor: 'vai fazer yoga amanha' },
    { categoria: TEST_CATEGORIA, chave: 'moradia', valor: 'mora em Recife' },
    { categoria: TEST_CATEGORIA, chave: 'humor', valor: 'cansada esta semana' }
  ]);
}

async function getAtivos() {
  const { data } = await supabase
    .from('memorias')
    .select('*')
    .eq('categoria', TEST_CATEGORIA)
    .is('superseded_at', null);
  return data || [];
}

async function getTudo() {
  const { data } = await supabase
    .from('memorias')
    .select('*')
    .eq('categoria', TEST_CATEGORIA);
  return data || [];
}

async function test1_contradicaoDireta() {
  console.log('Test 1: Contradição direta marca antigo como superseded');
  await cleanup();
  await inserirAntigos();
  const antigos = await getAtivos();
  const idExercicio = antigos.find(m => m.chave === 'exercicio').id;
  detectorMock.fakeContradicoes = [idExercicio];

  await salvarMemoriaComHistorico(TEST_CATEGORIA, 'exercicio', 'nao fez yoga hoje', null);

  const { data: antigoCheck } = await supabase
    .from('memorias')
    .select('superseded_at, superseded_by_id')
    .eq('id', idExercicio).single();
  assert(antigoCheck.superseded_at !== null, 'antigo deveria ter superseded_at preenchido');
  assert(antigoCheck.superseded_by_id !== null, 'antigo deveria ter superseded_by_id preenchido');

  const ativos = await getAtivos();
  assert(ativos.length === 3, `deveria ter 3 ativos (2 antigos + 1 novo), tem ${ativos.length}`);
  assert(ativos.find(m => m.valor === 'nao fez yoga hoje'), 'novo fato deveria estar ativo');
  console.log('  ✅ antigo marcado superseded, novo ativo');
}

async function test2_naoContradicao() {
  console.log('Test 2: Não-contradição preserva antigos');
  await cleanup();
  await inserirAntigos();
  detectorMock.fakeContradicoes = [];

  await salvarMemoriaComHistorico(TEST_CATEGORIA, 'preferencia', 'gosta de cha verde', null);

  const ativos = await getAtivos();
  assert(ativos.length === 4, `deveria ter 4 ativos, tem ${ativos.length}`);
  console.log('  ✅ todos antigos preservados, novo adicionado');
}

async function test3_primeiraMemoria() {
  console.log('Test 3: Primeira memória da categoria, sem antigas');
  await cleanup();
  detectorMock.fakeContradicoes = [];

  await salvarMemoriaComHistorico(TEST_CATEGORIA, 'inicial', 'primeira memoria', null);

  const ativos = await getAtivos();
  assert(ativos.length === 1, `deveria ter 1 ativo, tem ${ativos.length}`);
  console.log('  ✅ primeira memória inserida sem erro');
}

async function test4_buscarMemoriasFiltra() {
  console.log('Test 4: buscarMemorias filtra superseded automaticamente (Fase B)');
  await cleanup();
  await inserirAntigos();
  const antigos = await getAtivos();
  const idExercicio = antigos.find(m => m.chave === 'exercicio').id;
  detectorMock.fakeContradicoes = [idExercicio];

  await salvarMemoriaComHistorico(TEST_CATEGORIA, 'exercicio', 'nao fez', null);

  const resultado = await buscarMemorias(TEST_CATEGORIA, 50);
  const temAntigo = resultado.find(m => m.id === idExercicio);
  assert(!temAntigo, 'buscarMemorias NÃO deveria retornar memória superseded');

  const tudo = await getTudo();
  assert(tudo.length === 4, `tabela tem 4 linhas (3 antigos + 1 novo), tem ${tudo.length}`);
  console.log('  ✅ superseded oculta de buscarMemorias, mas preservada no banco');
}

async function test5_multiplasAntigasUmaSoMarcada() {
  console.log('Test 5: Múltiplas antigas, contradiz uma só');
  await cleanup();
  await inserirAntigos();
  const antigos = await getAtivos();
  const idMoradia = antigos.find(m => m.chave === 'moradia').id;
  detectorMock.fakeContradicoes = [idMoradia];

  await salvarMemoriaComHistorico(TEST_CATEGORIA, 'moradia', 'mudou pra SP', null);

  const tudo = await getTudo();
  const supersededs = tudo.filter(m => m.superseded_at !== null);
  assert(supersededs.length === 1, `deveria ter 1 superseded, tem ${supersededs.length}`);
  assert(supersededs[0].id === idMoradia, 'só moradia deveria estar superseded');
  console.log('  ✅ apenas a antiga contradita foi marcada');
}

async function run() {
  let passed = 0, failed = 0;
  const tests = [test1_contradicaoDireta, test2_naoContradicao, test3_primeiraMemoria, test4_buscarMemoriasFiltra, test5_multiplasAntigasUmaSoMarcada];

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      console.error(`  ❌ FAILED: ${e.message}`);
      console.error(`     stack: ${e.stack.split('\n').slice(0, 3).join('\n')}`);
      failed++;
    }
  }

  await cleanup();
  console.log(`\nResultado: ${passed}/${tests.length} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
