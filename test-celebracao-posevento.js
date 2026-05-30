// test-celebracao-posevento.js — Loop Fogg pós-evento (Commit 1)
// PURO: importa só montarDiretrizCelebracao. Sem rede, sem Supabase, sem relógio
// → entra no gate determinístico.

const assert = require('assert');
const { montarDiretrizCelebracao } = require('./src/services/celebracaoPosEvento');

let passed = 0, failed = 0;
function t(nome, fn) {
  try { fn(); passed++; console.log(`  ✅ ${nome}`); }
  catch (e) { failed++; console.error(`  ❌ ${nome}: ${e.message}`); }
}

console.log('test-celebracao-posevento');

const vivido = montarDiretrizCelebracao({ sabor: 'vivido', evento: 'Workshop de cerâmica' });
const habito = montarDiretrizCelebracao({ sabor: 'habito', evento: 'Yoga' });

function checaTresRamificacoes(out, rotulo) {
  // fez → celebra
  assert.ok(/FEZ/.test(out) && /celebre/i.test(out), `${rotulo}: ramificação "fez → celebra" ausente`);
  // não fez → acolhe sem culpa
  assert.ok(/N[ÃA]O fez/.test(out) && /sem culpa/i.test(out), `${rotulo}: ramificação "não fez → acolhe sem culpa" ausente`);
  // ambíguo → caloroso-neutro
  assert.ok(/amb[íi]gua/i.test(out) && /neutro/i.test(out), `${rotulo}: ramificação "ambíguo → neutro" ausente`);
}

t('vivido: contém as três ramificações', () => checaTresRamificacoes(vivido, 'vivido'));
t('habito: contém as três ramificações', () => checaTresRamificacoes(habito, 'habito'));

t('contém "deixa a vitória respirar"', () => {
  assert.ok(/deixa a vit[óo]ria respirar/i.test(vivido), 'vivido sem "deixa a vitória respirar"');
  assert.ok(/deixa a vit[óo]ria respirar/i.test(habito), 'habito sem "deixa a vitória respirar"');
});

t('ancora no nome do evento', () => {
  assert.ok(vivido.includes('Workshop de cerâmica'), 'vivido não cita o evento');
  assert.ok(habito.includes('Yoga'), 'habito não cita o evento');
});

t('usa "você"', () => {
  // sem \b ao redor: "você" termina em char acentuado (non-word) → \b final falha (lição Bug K)
  assert.ok(/você/i.test(vivido) && /você/i.test(habito), 'falta "você"');
});

t('NÃO usa "tu" (forma informal)', () => {
  assert.ok(!/\btu\b/i.test(vivido), `vivido contém "tu": ${vivido}`);
  assert.ok(!/\btu\b/i.test(habito), `habito contém "tu": ${habito}`);
});

t('NÃO contém cobrança / pontos / streak (companion ≠ tracker)', () => {
  const proibido = /cobran|\bpontos\b|streak/i;
  assert.ok(!proibido.test(vivido), `vivido contém termo de tracker: ${vivido}`);
  assert.ok(!proibido.test(habito), `habito contém termo de tracker: ${habito}`);
});

t('sabor habito NÃO presume execução; vivido assume que aconteceu', () => {
  assert.ok(/presuma execu/i.test(habito) || /n[ãa]o sabe se aconteceu/i.test(habito), 'habito deveria não-presumir execução');
  assert.ok(/estava na agenda|acabou de acontecer/i.test(vivido), 'vivido deveria assumir que aconteceu');
});

t('robusto: sem evento → usa fallback, não quebra', () => {
  const out = montarDiretrizCelebracao({ sabor: 'vivido' });
  assert.ok(typeof out === 'string' && out.length > 0);
  assert.ok(out.includes('isso'), 'fallback "isso" ausente');
  // determinístico
  assert.strictEqual(out, montarDiretrizCelebracao({ sabor: 'vivido' }));
});

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
