// Teste isolado do Bug #5 (timezone do Calendar).
// Spawn de child Node com TZ=UTC e TZ=America/Sao_Paulo, comparando o ISO
// produzido por resolverDataHora('amanha', '13:00').
//
// Demonstra:
// - TZ=UTC (estado do Vercel sem fix) → ISO com 13:00 UTC = 10:00 BRT (BUG)
// - TZ=America/Sao_Paulo (estado pós-fix) → ISO com 16:00 UTC = 13:00 BRT (CORRETO)
//
// Rodar: node test-tz.js
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname);

// Script que o child executa. Carrega .env, chama resolverDataHora, imprime ISO.
const CHILD_SCRIPT = `
require('dotenv').config();
const { resolverDataHora } = require('./src/services/calendarBrain');
console.log(resolverDataHora('amanha', '13:00').toISOString());
`;

// Cenário 3: simula a abordagem C.1 (process.env.TZ setado em runtime no entrypoint,
// SEM TZ no env do shell). Valida que Node respeita TZ alterado antes de require/new Date.
const CHILD_SCRIPT_RUNTIME_TZ = `
process.env.TZ = 'America/Sao_Paulo';
require('dotenv').config();
const { resolverDataHora } = require('./src/services/calendarBrain');
console.log(resolverDataHora('amanha', '13:00').toISOString());
`;

function runWithTz(tz, scriptOverride = null) {
  const env = { ...process.env };
  if (tz === null) delete env.TZ;
  else env.TZ = tz;

  const r = spawnSync('node', ['-e', scriptOverride || CHILD_SCRIPT], {
    env,
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    throw new Error(`child com TZ=${tz} falhou (exit ${r.status}):\n${r.stderr}`);
  }
  // dotenv pode imprimir linhas de log no stdout — pega só a última linha não-vazia (a ISO real).
  const linhas = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return linhas[linhas.length - 1];
}

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

// Roda 3 cenários
const isoUTC        = runWithTz('UTC');
const isoSP         = runWithTz('America/Sao_Paulo');
const isoRuntimeTZ  = runWithTz('UTC', CHILD_SCRIPT_RUNTIME_TZ); // simula C.1

console.log(`TZ=UTC                              → ${isoUTC}`);
console.log(`TZ=America/Sao_Paulo (env shell)    → ${isoSP}`);
console.log(`TZ=UTC + process.env.TZ runtime     → ${isoRuntimeTZ}\n`);

const dtUTC = new Date(isoUTC);
const dtSP  = new Date(isoSP);

// Diferença esperada: SP é UTC-3, então 13h BRT = 16h UTC. SP fica 3h "à frente" do UTC ingênuo.
const diffHoras = (dtSP.getTime() - dtUTC.getTime()) / (1000 * 60 * 60);

assert(
  isoUTC !== isoSP,
  'A.1) ISOs diferentes entre TZ=UTC e TZ=São Paulo (TZ env var afeta o resultado)',
  `UTC=${isoUTC}, SP=${isoSP}`
);

assert(
  diffHoras === 3,
  'A.2) TZ=São Paulo produz ISO 3h adiantado vs TZ=UTC (BRT é UTC-3)',
  `diff=${diffHoras}h`
);

assert(
  dtSP.getUTCHours() === 16,
  'A.3) FIX: TZ=São Paulo + "13:00" → ISO ...T16:00:00.000Z (13h BRT correto)',
  `hora UTC do ISO SP = ${dtSP.getUTCHours()}, esperado 16`
);

assert(
  dtUTC.getUTCHours() === 13,
  'A.4) BUG REPRODUZIDO: TZ=UTC + "13:00" → ISO ...T13:00:00.000Z (= 10h BRT, errado)',
  `hora UTC do ISO UTC = ${dtUTC.getUTCHours()}, esperado 13 (que prova o bug)`
);

// A.5: a abordagem C.1 (process.env.TZ em runtime) tem que produzir o MESMO resultado
// que TZ no env do shell. Valida que a estratégia do entrypoint funciona em Node.
assert(
  isoRuntimeTZ === isoSP,
  'A.5) C.1 funciona: process.env.TZ setado em runtime produz mesmo ISO que TZ no env do shell',
  `runtime=${isoRuntimeTZ}, shell=${isoSP}`
);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
