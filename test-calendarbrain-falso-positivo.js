// test-calendarbrain-falso-positivo.js — Onda 1.6 Anti-falso-positivo
// Bateria adversarial: valida regex anti-fato-passado + preClassificarConsulta.
// Não chama Opus/Google/Supabase — testa só a lógica determinística do JS.
//
// Cenários 1-12: foco em Commit 1 (anti-fato-passado).
//   5,6,7,8 → bypass via RE_FATO_PASSADO (esperado true após Commit 1)
//   12     → fato passado + verbo imperativo "agenda" → NÃO bypass
// Cenários 13-17: foco em Commit 1.5 (falsos positivos consultar_evento).
//   13,14,15 → preClassificarConsulta deve retornar null (após 1.5)
//   16,17    → preClassificarConsulta deve PRESERVAR consulta_evento

require('dotenv').config();

const {
  preClassificarConsulta,
  temSinalCalendar,
  RE_FATO_PASSADO,
  RE_FATO_PASSADO_POSITIVO,
  RE_VERBO_IMPERATIVO_CALENDAR,
  REGEX_HORARIO_TEXTO,
} = require('./src/services/calendarBrain');

function deveByPassFatoPassado(msg) {
  return RE_FATO_PASSADO.test(msg) && !RE_VERBO_IMPERATIVO_CALENDAR.test(msg);
}

// Commit 1 — Sabor A: relato de passado POSITIVO. Espelha o guard de :449.
function deveByPassRelatoPositivo(msg) {
  return RE_FATO_PASSADO_POSITIVO.test(msg)
    && !RE_VERBO_IMPERATIVO_CALENDAR.test(msg)
    && !REGEX_HORARIO_TEXTO.test(msg);
}

const CENARIOS = [
  // # | Mensagem | bypass_esperado | preClass_esperado (null | 'consultar_evento')
  { n: 1,  msg: 'Cancela exercicio de amanha',              bypass: false, preClass: null },
  { n: 2,  msg: 'Adiciona psicologo quinta 15h',            bypass: false, preClass: null },
  { n: 3,  msg: 'Move yoga pra 8h',                          bypass: false, preClass: null },
  { n: 4,  msg: 'Tira cinema de hoje',                       bypass: false, preClass: null },
  { n: 5,  msg: 'Nao fui pro exercicio',                     bypass: true,  preClass: null },
  { n: 6,  msg: 'Nao fiz yoga essa semana',                  bypass: true,  preClass: null },
  { n: 7,  msg: 'Esqueci do dentista',                       bypass: true,  preClass: null },
  { n: 8,  msg: 'Cheguei tarde no trabalho',                 bypass: true,  preClass: null },
  { n: 9,  msg: 'Tenho ate as 17h livre. Depois quero...',   bypass: false, preClass: null }, // após 1.5
  { n: 10, msg: 'Tava pensando no exercicio',                bypass: false, preClass: null },
  { n: 11, msg: 'Sim',                                       bypass: false, preClass: null },
  { n: 12, msg: 'Nao fui pro mercado. Agenda pra amanha',    bypass: false, preClass: null }, // verbo imperativo "agenda" preserva
  { n: 13, msg: 'Tenho ate as 17h livre. Depois quero...',   bypass: false, preClass: null }, // bug 12:09
  { n: 14, msg: 'Tenho tempo hoje',                          bypass: false, preClass: null },
  { n: 15, msg: 'Tenho fome',                                bypass: false, preClass: null },
  { n: 16, msg: 'Tenho psicologo amanha',                    bypass: false, preClass: 'consultar_evento' }, // PRESERVAR
  { n: 17, msg: 'Tenho almoco com pais quinta',              bypass: false, preClass: 'consultar_evento' }, // PRESERVAR
  // Bug K — Onda 1.7 anti-fato-passado ampliado (20/05 19:30 smoking gun)
  { n: 18, msg: 'Não rolou exercício hoje',                  bypass: true,  preClass: null }, // smoking gun
  { n: 19, msg: 'Não aconteceu o treino',                    bypass: true,  preClass: null },
  { n: 20, msg: 'Não saí pra academia',                      bypass: true,  preClass: null },
  { n: 21, msg: 'Pulei o yoga essa semana',                  bypass: true,  preClass: null },
  { n: 22, msg: 'Não acordei a tempo pro psicólogo',         bypass: true,  preClass: null },
  { n: 23, msg: 'Passei o dia sem academia',                 bypass: true,  preClass: null },
  // Cenários OPOSTOS: verbo imperativo preserva (regressão zero da regra estrutural)
  { n: 24, msg: 'Não rolou exercício ontem. Cancela o de amanhã.', bypass: false, preClass: null }, // "cancela" preserva
  { n: 25, msg: 'Pulei yoga hoje, agenda amanhã 8h',         bypass: false, preClass: null }, // "agenda" preserva
];

let passed = 0, failed = 0;

function check(label, ok, info = '') {
  if (ok) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

for (const c of CENARIOS) {
  const bypassReal = deveByPassFatoPassado(c.msg);
  const preReal = preClassificarConsulta(c.msg);
  const preRealAcao = preReal ? preReal.acao : null;

  const okBypass = bypassReal === c.bypass;
  const okPreClass = preRealAcao === c.preClass;

  check(
    `C${c.n}) "${c.msg.substring(0, 50)}" bypass_fato_passado=${c.bypass}`,
    okBypass,
    `esperado=${c.bypass} real=${bypassReal}`
  );
  check(
    `C${c.n}) "${c.msg.substring(0, 50)}" preClass=${c.preClass}`,
    okPreClass,
    `esperado=${c.preClass} real=${preRealAcao}`
  );
}

// ─── Commit 1 — Sabor A: relato de passado POSITIVO não vira criar ───
const CENARIOS_RELATO_POSITIVO = [
  { n: 'A1', msg: 'Fiz yoga e musculação',        bypass: true  },
  { n: 'A2', msg: 'Musculação fiz',                bypass: true  }, // verbo no fim (objeto antes)
  { n: 'A3', msg: 'Terminei o Archicad',           bypass: true  },
  { n: 'A4', msg: 'Fui pra academia hoje',         bypass: true  }, // "hoje" não é hora explícita
  { n: 'A5', msg: 'Consegui acordar cedo',         bypass: true  },
  { n: 'A6', msg: 'Já fiz a reunião',              bypass: true  },
  { n: 'A7', msg: 'Completei o projeto ontem',     bypass: true  },
  // Guardas (regressão zero): imperativo e/ou hora preservam a criação
  { n: 'A8', msg: 'Agenda yoga que fiz',           bypass: false }, // "agenda" imperativo
  { n: 'A9', msg: 'Fiz yoga, marca amanhã 8h',     bypass: false }, // "marca" imperativo + hora
  { n: 'A10', msg: 'Adiciona musculação',          bypass: false }, // não é passado
  { n: 'A11', msg: 'Cancela exercicio de amanha',  bypass: false }, // não é passado positivo
];
for (const c of CENARIOS_RELATO_POSITIVO) {
  const real = deveByPassRelatoPositivo(c.msg);
  check(
    `${c.n}) "${c.msg.substring(0, 50)}" relato_positivo_bypass=${c.bypass}`,
    real === c.bypass,
    `esperado=${c.bypass} real=${real}`
  );
}

// ─── Commit 2 — Sabor B-JS: "Tenho" allowlist via temSinalCalendar ───
const CENARIOS_TENHO = [
  // matar: declarativa sem substantivo de agenda
  { n: 'B1', msg: 'Tenho contato de desenhista',               preClass: null },
  { n: 'B2', msg: 'Tenho',                                     preClass: null },
  { n: 'B3', msg: 'Tenho usado música clássica pra trabalhar', preClass: null },
  // preservar: nomeia um evento (substantivo de agenda)
  { n: 'B4', msg: 'Tenho psicólogo hoje?',                     preClass: 'consultar_evento' },
  { n: 'B5', msg: 'Tenho reunião amanhã?',                     preClass: 'consultar_evento' },
  { n: 'B6', msg: 'Tem academia hoje?',                        preClass: 'consultar_evento' },
  { n: 'B10', msg: 'Tenho psiquiatra hoje?',                   preClass: 'consultar_evento' }, // Bressan — psiquiatra ∈ vocab
];
for (const c of CENARIOS_TENHO) {
  const pre = preClassificarConsulta(c.msg);
  const acao = pre ? pre.acao : null;
  check(
    `${c.n}) "${c.msg.substring(0, 50)}" preClass=${c.preClass}`,
    acao === c.preClass,
    `esperado=${c.preClass} real=${acao}`
  );
}
// temSinalCalendar direto: substantivo obrigatório, temporal sozinho não basta
check('B7) temSinalCalendar("Tenho reunião amanhã")===true',
  temSinalCalendar('Tenho reunião amanhã') === true);
check('B8) temSinalCalendar("Tenho até as 17h livre")===false (só temporal)',
  temSinalCalendar('Tenho até as 17h livre') === false);
check('B9) temSinalCalendar("Tenho contato de desenhista")===false',
  temSinalCalendar('Tenho contato de desenhista') === false);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
