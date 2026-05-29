// test-honestidade-erro.js — Honestidade do catch-all de erro
// Valida que classifyBrainError NÃO diz "Calendar não respondeu" quando a causa
// real foi um erro de CÓDIGO (TypeError/ReferenceError/etc) embrulhado como
// CalendarOperationError/CalendarInsertError. Caso real: getCalendarioInfo
// não-exportado → TypeError → mascarado como "Calendar não respondeu" por horas.
//
// Testa só a lógica determinística de classifyBrainError — não chama rede.

require('dotenv').config();

const { classifyBrainError } = require('./src/services/brain');
const { CalendarOperationError, CalendarInsertError } = require('./src/integrations/calendar');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

const INTERNO = 'erro interno';
const CALENDAR = 'Calendar não respondeu';

// C1: cause = TypeError → erro interno, NÃO "Calendar não respondeu"
{
  const r = classifyBrainError(new CalendarOperationError('wrap', new TypeError('boom')));
  check('C1) CalendarOperationError + cause TypeError → "erro interno"',
    r.includes(INTERNO) && !r.includes(CALENDAR), `r=${r}`);
}

// C2: cause = Error genérico (Google 503) → "Calendar não respondeu"
{
  const r = classifyBrainError(new CalendarOperationError('wrap', new Error('Google 503')));
  check('C2) CalendarOperationError + cause Error(Google) → "Calendar não respondeu"',
    r.includes(CALENDAR) && !r.includes(INTERNO), `r=${r}`);
}

// C3: sem cause → "Calendar não respondeu"
{
  const r = classifyBrainError(new CalendarOperationError('wrap'));
  check('C3) CalendarOperationError sem cause → "Calendar não respondeu"',
    r.includes(CALENDAR) && !r.includes(INTERNO), `r=${r}`);
}

// C4: aninhado — CalendarOperationError → CalendarInsertError → ReferenceError
{
  const interno = new CalendarInsertError('inner', new ReferenceError('x'));
  const r = classifyBrainError(new CalendarOperationError('outer', interno));
  check('C4) cause aninhada (CalendarInsertError → ReferenceError) → "erro interno"',
    r.includes(INTERNO) && !r.includes(CALENDAR), `r=${r}`);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
