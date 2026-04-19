// Teste isolado do fix de buscarHistorico (Bug A).
// Insere 25 mensagens fake com timestamps controlados, valida que buscarHistorico
// retorna as 20 MAIS RECENTES em ordem cronológica.
//
// Rodar: node test-history-fix.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { buscarHistorico } = require('./src/services/memorySupabase');

const TEST_MARKER = '[TEST-HISTORY-FIX-XYZ]';
let passed = 0, failed = 0;

function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${String(info).substring(0, 250)}`); }
}

async function cleanup() {
  await supabase.from('mensagens').delete().like('content', `%${TEST_MARKER}%`);
}

async function run() {
  // Pre-cleanup: garante estado limpo caso execução anterior tenha crashado e deixado lixo
  await cleanup();

  try {
    // Inserir 25 mensagens com timestamps espaçados (mais antiga = msg 1, mais nova = msg 25)
    // Usa anchor no FUTURO DISTANTE (2030) pra garantir que TODAS as nossas msgs são as
    // mais novas da tabela — o que permite validar que DESC+LIMIT(20) retorna nossas msgs
    // (e não o lixo real do prod que ficaria nas posições 21+).
    const baseTime = new Date('2030-01-01T00:00:00Z').getTime();
    const rows = [];
    for (let i = 1; i <= 25; i++) {
      rows.push({
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `${TEST_MARKER} mensagem #${i.toString().padStart(2, '0')}`,
        created_at: new Date(baseTime + i * 1000).toISOString(),
      });
    }
    const { error } = await supabase.from('mensagens').insert(rows);
    if (error) throw new Error(`Insert falhou: ${error.message}`);

    // Chamar buscarHistorico e validar
    const historico = await buscarHistorico(20);

    // ── Filtrar só as nossas mensagens de teste ──
    const nossasNoHistorico = historico.filter(m => m.content?.includes(TEST_MARKER));

    // 1) Tem que devolver 20 mensagens (limite)
    assert(historico.length === 20,
      'A.1) buscarHistorico(20) retorna exatamente 20 itens',
      `recebido: ${historico.length}`);

    // 2) Em produção há outras mensagens reais, então nossas 20 inseridas podem
    //    não ser todas as 20 retornadas. Mas as nossas que estão lá devem ser as
    //    mais NOVAS (#06 a #25), não as mais antigas (#01 a #20).
    if (nossasNoHistorico.length > 0) {
      const numeros = nossasNoHistorico.map(m => {
        const match = m.content.match(/#(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      });
      const min = Math.min(...numeros);
      const max = Math.max(...numeros);
      assert(max === 25,
        'A.2) Nossas mensagens no histórico incluem a #25 (a MAIS RECENTE inserida)',
        `min=${min}, max=${max}, todos=${numeros.join(',')}`);
      assert(min >= 6,
        'A.3) Nossas mensagens no histórico NÃO incluem #01..#05 (as 5 mais antigas)',
        `min=${min}, esperado >= 6`);
    } else {
      failed++;
      console.log('❌ A.2/A.3) Nenhuma mensagem de teste apareceu no histórico — algo muito errado');
    }

    // 3) Ordem cronológica ASC dentro do array (mais antigo primeiro, mais novo no fim)
    if (nossasNoHistorico.length >= 2) {
      const numeros = nossasNoHistorico.map(m => parseInt(m.content.match(/#(\d+)/)?.[1] || '0', 10));
      const ordenado = [...numeros].sort((a, b) => a - b);
      assert(JSON.stringify(numeros) === JSON.stringify(ordenado),
        'A.4) Mensagens vêm em ordem cronológica ASC no array (cronológico pro Claude)',
        `recebido: [${numeros.join(',')}], esperado ordenado: [${ordenado.join(',')}]`);
    }

    // 4) Última mensagem do array é a mais recente (importante pro Passo 0-PRE)
    if (nossasNoHistorico.length > 0) {
      const ultima = historico[historico.length - 1];
      const ultimaNum = parseInt(ultima.content?.match(/#(\d+)/)?.[1] || '0', 10);
      // Pode ser uma mensagem real do prod entre as nossas; o que importa é que NÃO
      // seja uma das nossas antigas (#01..#10) — ou é nossa mais nova ou é msg real recente
      const ehNossaAntiga = ultima.content?.includes(TEST_MARKER) && ultimaNum <= 10;
      assert(!ehNossaAntiga,
        'A.5) history[length-1] NÃO é uma das nossas mensagens mais antigas (Passo 0-PRE pegava msg velha)',
        `ultima.content: ${ultima.content?.substring(0, 80)}`);
    }
  } finally {
    // Post-cleanup: SEMPRE roda, mesmo se asserts ou inserts derem throw
    await cleanup();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async e => {
  console.error('💥 erro fatal:', e);
  await cleanup();
  process.exit(1);
});
