// test-classify-anthropic.js — discriminador de erro Anthropic
// Confirma que classifyBrainError lê err.type (subtipo extraído pelo SDK 0.85),
// NÃO err.error.type (='error', wrapper externo). Antes do fix, os 4 ramos
// específicos eram código morto e tudo caía no genérico.
//
// Objetos duck-typed (o código usa error?.type). Sem rede.

require('dotenv').config();

const { classifyBrainError } = require('./src/services/brain');
const { CalendarOperationError } = require('./src/integrations/calendar');

let passed = 0, failed = 0;
function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// C1-C4: subtipo em err.type → ramo específico
{
  const r = classifyBrainError({ type: 'rate_limit_error' });
  check('C1) type=rate_limit_error → mensagem de rate limit',
    /rate limit/i.test(r), `r=${r}`);
}
{
  const r = classifyBrainError({ type: 'authentication_error' });
  check('C2) type=authentication_error → mensagem de auth',
    /autentica/i.test(r), `r=${r}`);
}
{
  const r = classifyBrainError({ type: 'overloaded_error' });
  check('C3) type=overloaded_error → mensagem de overloaded',
    /sobrecarregada/i.test(r), `r=${r}`);
}
{
  const r = classifyBrainError({ type: 'invalid_request_error' });
  check('C4) type=invalid_request_error → mensagem de invalid_request',
    /invalid_request_error/i.test(r), `r=${r}`);
}

// C5 (regressão-chave): o wrapper externo (.error.type='error') NÃO deve
// sequestrar — tem que usar .type='rate_limit_error'.
{
  const r = classifyBrainError({ error: { type: 'error' }, type: 'rate_limit_error', status: 429 });
  check('C5) .error.type=error mas .type=rate_limit_error → usa .type (rate limit)',
    /rate limit/i.test(r), `r=${r}`);
}

// C6 (não-regressão da honestidade): erro de código embrulhado → erro interno
{
  const r = classifyBrainError(new CalendarOperationError('x', new TypeError('y')));
  check('C6) CalendarOperationError + cause TypeError → "erro interno"',
    /erro interno/i.test(r), `r=${r}`);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
