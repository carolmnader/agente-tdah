// test-roteamento-negativa.js — fix #20 (negativa de atividade não vira "qual cancelar?")
// PURO: importa só predicados do calendarBrain (sem rede/Supabase/relógio) → gate.
// Testa a camada de roteamento determinístico (bypass de fato-passado), NOS DOIS SENTIDOS.

const assert = require('assert');
const {
  RE_FATO_PASSADO,
  RE_VERBO_IMPERATIVO_CALENDAR,
  deveRebaixarPosOpus,
} = require('./src/services/calendarBrain');

// Espelha o gate real em processarCalendar L534: bypassa (→ conversa) só se for
// fato-passado SEM verbo imperativo de Calendar.
function bypassaParaConversa(msg) {
  return RE_FATO_PASSADO.test(msg) && !RE_VERBO_IMPERATIVO_CALENDAR.test(msg);
}

let passed = 0, failed = 0;
function t(nome, ok, info = '') {
  if (ok) { passed++; console.log(`  ✅ ${nome}`); }
  else { failed++; console.error(`  ❌ ${nome}${info ? ' — ' + info : ''}`); }
}

console.log('test-roteamento-negativa');

// ── NEGATIVA → conversa (deve bypassar). Cobre verbo-fora-da-lista, prefixo, ordem. ──
const NEGATIVAS = [
  'não treinei',                 // verbo fora da lista antiga
  'não malhei hoje',
  'acho que não estudei',        // prefixo + verbo fora da lista antiga
  'hoje não fui',                // prefixo antes do "não"
  'ah não fiz',                  // prefixo
  'yoga não rolou',              // ordem atividade-primeiro
  'academia não fui',            // ordem atividade-primeiro
  'não consegui ir pro pilates',
  'não corri hoje',
  'não rolou exercício hoje',    // regressão zero (caso antigo Bug K)
  'Nao fui pro exercicio',       // sem acento (n[aã]o)
];
for (const m of NEGATIVAS) {
  t(`NEGATIVA → conversa: "${m}"`, bypassaParaConversa(m) === true, `bypass=${bypassaParaConversa(m)}`);
}

// ── IMPERATIVO LEGÍTIMO → continua Calendar (NÃO bypassa) ──
const IMPERATIVOS = [
  'cancela a yoga',
  'cancela o exercício de hoje',
  'tira a reunião',
  'remarca o dentista',
  'muda pro calendário Saúde',
  'desmarca o almoço',
  'agenda yoga amanhã 8h',
  'não rolou exercício ontem. Cancela o de amanhã.', // negativa + imperativo → imperativo vence
  'pulei yoga hoje, agenda amanhã 8h',               // idem
];
for (const m of IMPERATIVOS) {
  t(`IMPERATIVO → Calendar (não bypassa): "${m}"`, bypassaParaConversa(m) === false, `bypass=${bypassaParaConversa(m)}`);
}

// ── Regressão zero: declarativas/consultas SEM "não+verbo" não bypassam ──
const NAO_BYPASSAM = [
  'Tenho psicologo amanha',   // consulta (preClass cuida)
  'Tenho tempo hoje',
  'Sim',
  'Tava pensando no exercicio',
];
for (const m of NAO_BYPASSAM) {
  t(`não bypassa (sem negativa de ação): "${m}"`, bypassaParaConversa(m) === false, `bypass=${bypassaParaConversa(m)}`);
}

// ── Guard pós-Opus segue como está (PASSO 2 NÃO aplicado): cancelar NÃO é gated ──
t('deveRebaixarPosOpus rebaixa consultar_evento sem sinal', deveRebaixarPosOpus('consultar_evento', 'Bressan o nome dele') === true);
t('deveRebaixarPosOpus NÃO rebaixa cancelar (fora do conjunto gated — BC8)', deveRebaixarPosOpus('cancelar', 'Bressan o nome dele') === false);
t('deveRebaixarPosOpus NÃO rebaixa criar COM sinal (hora)', deveRebaixarPosOpus('criar', 'marca 14h') === false);

console.log(`\nResultado: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
