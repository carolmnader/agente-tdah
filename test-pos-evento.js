// test-pos-evento.js — elegibilidade pura do motor pós-evento (Commit A)
// Valida eventoElegivelPos(ev, agora) em src/utils/time.js. Sem rede/modelo.
// Janela elegível: terminou em [agora−15min, agora−5min), TIMED, não-buffer.

const { eventoElegivelPos } = require('./src/utils/time');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

const agora = new Date('2026-05-29T15:00:00-03:00');
// helper: evento timed que terminou há `min` minutos
const evFim = (min, summary = 'Reunião') => {
  const fim = new Date(agora.getTime() - min * 60000);
  const ini = new Date(fim.getTime() - 60 * 60000); // durou 1h
  return { summary, start: { dateTime: ini.toISOString() }, end: { dateTime: fim.toISOString() } };
};

// C1: terminou há 10min → ELEGÍVEL
check('C1) timed terminou há 10min → true',
  eventoElegivelPos(evFim(10), agora) === true, `real=${eventoElegivelPos(evFim(10), agora)}`);

// C2: all-day → false (sem dateTime)
check('C2) all-day (start.date/end.date) → false',
  eventoElegivelPos({ summary: 'Feriado', start: { date: '2026-05-29' }, end: { date: '2026-05-30' } }, agora) === false);

// C3: terminou há 2min → false (recente demais, < 5min)
check('C3) timed terminou há 2min → false',
  eventoElegivelPos(evFim(2), agora) === false, `real=${eventoElegivelPos(evFim(2), agora)}`);

// C4: terminou há 20min → false (antigo demais, >= 15min)
check('C4) timed terminou há 20min → false',
  eventoElegivelPos(evFim(20), agora) === false, `real=${eventoElegivelPos(evFim(20), agora)}`);

// C5: buffer/deslocamento na janela → false (título)
check('C5a) título "Buffer" na janela → false', eventoElegivelPos(evFim(10, '🌿 Buffer / Transição'), agora) === false);
check('C5b) título "🚗" na janela → false', eventoElegivelPos(evFim(10, '🚗 Deslocamento'), agora) === false);

// C6: bordas exatas da janela
check('C6a) fim exatamente há 5min → false (limite superior exclusivo)',
  eventoElegivelPos(evFim(5), agora) === false, `real=${eventoElegivelPos(evFim(5), agora)}`);
check('C6b) fim exatamente há 15min → true (limite inferior inclusivo)',
  eventoElegivelPos(evFim(15), agora) === true, `real=${eventoElegivelPos(evFim(15), agora)}`);

// C7: defensivo — objeto sem end → false
check('C7) sem end → false', eventoElegivelPos({ summary: 'x', start: { dateTime: agora.toISOString() } }, agora) === false);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
