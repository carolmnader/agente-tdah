// test-agenda-reativa.js — Bug raciocinio temporal Fase 2
//
// Valida helpers em src/utils/time.js:
//   - minutosAteEvento(startISO, now) — calculo puro
//   - montarBlocoAgenda(eventos, now) — bloco textual com PROXIMO COMPROMISSO
//
// 6 cenarios C1-C6. Testes PUROS, sem modelo, deterministicos (Date offset -03:00).
//
// Rodar: node test-agenda-reativa.js

const { minutosAteEvento, montarBlocoAgenda } = require('./src/utils/time');

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// ─── C1: O BUG — 12:58 + evento 13:00 ─────────────────
{
  const now = new Date('2026-05-22T12:58:00-03:00');
  const eventos = [{ summary: 'Psicólogo', start: { dateTime: '2026-05-22T13:00:00-03:00' } }];
  const bloco = montarBlocoAgenda(eventos, now);
  assert(
    bloco && /PRÓXIMO COMPROMISSO: Psicólogo às 13:00 \(em 2 min\)/.test(bloco),
    'C1) 12:58 + Psicólogo 13:00 → bloco diz "em 2 min"',
    `bloco=${bloco}`
  );
  assert(
    /- 13:00 — Psicólogo/.test(bloco),
    'C1b) lista evento "- 13:00 — Psicólogo"',
    `bloco=${bloco}`
  );
}

// ─── C2: evento passou → nenhum mais hoje ─────────────
{
  const now = new Date('2026-05-22T12:58:00-03:00');
  const eventos = [{ summary: 'Café da manhã', start: { dateTime: '2026-05-22T07:00:00-03:00' } }];
  const bloco = montarBlocoAgenda(eventos, now);
  assert(
    bloco && /- 07:00 — Café da manhã/.test(bloco),
    'C2a) lista evento "- 07:00 — Café da manhã"',
    `bloco=${bloco}`
  );
  assert(
    bloco && /PRÓXIMO COMPROMISSO: nenhum mais hoje\./.test(bloco),
    'C2b) PRÓXIMO COMPROMISSO: nenhum mais hoje',
    `bloco=${bloco}`
  );
}

// ─── C3: all-day → "dia todo", nao vira proximo ───────
{
  const now = new Date('2026-05-22T09:00:00-03:00');
  const eventos = [
    { summary: 'Aniversário Ana', start: { date: '2026-05-22' } },
    { summary: 'Reunião', start: { dateTime: '2026-05-22T15:00:00-03:00' } },
  ];
  const bloco = montarBlocoAgenda(eventos, now);
  assert(
    bloco && /- dia todo — Aniversário Ana/.test(bloco),
    'C3a) all-day vira "- dia todo — X"',
    `bloco=${bloco}`
  );
  assert(
    bloco && /PRÓXIMO COMPROMISSO: Reunião às 15:00/.test(bloco) &&
    !/PRÓXIMO COMPROMISSO: Aniversário/.test(bloco),
    'C3b) all-day NÃO vira PRÓXIMO COMPROMISSO (só timed)',
    `bloco=${bloco}`
  );
}

// ─── C4: multiplos timed → proximo = mais cedo dos futuros ──
{
  const now = new Date('2026-05-22T09:00:00-03:00');
  const eventos = [
    { summary: 'Almoço', start: { dateTime: '2026-05-22T13:00:00-03:00' } },
    { summary: 'Yoga', start: { dateTime: '2026-05-22T17:00:00-03:00' } },
  ];
  const bloco = montarBlocoAgenda(eventos, now);
  assert(
    bloco && /PRÓXIMO COMPROMISSO: Almoço às 13:00/.test(bloco),
    'C4) próximo = Almoço 13:00 (não Yoga 17:00)',
    `bloco=${bloco}`
  );
}

// ─── C5: vazio → null ─────────────────────────────────
{
  const now = new Date('2026-05-22T09:00:00-03:00');
  const bloco = montarBlocoAgenda([], now);
  assert(bloco === null, 'C5) montarBlocoAgenda([], now) === null', `bloco=${bloco}`);
  const bloco2 = montarBlocoAgenda(null, now);
  assert(bloco2 === null, 'C5b) montarBlocoAgenda(null, now) === null', `bloco2=${bloco2}`);
}

// ─── C6: minutosAteEvento puro ────────────────────────
{
  const now = new Date('2026-05-22T12:58:00-03:00');
  const result = minutosAteEvento('2026-05-22T13:00:00-03:00', now);
  assert(result === 2, 'C6) minutosAteEvento(13:00, 12:58) === 2', `result=${result}`);

  // bonus: evento ja passou → negativo
  const result2 = minutosAteEvento('2026-05-22T12:00:00-03:00', now);
  assert(result2 === -58, 'C6b) evento passou (12:00) com now=12:58 → -58 min', `result2=${result2}`);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
