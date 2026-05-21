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
  RE_FATO_PASSADO,
  RE_VERBO_IMPERATIVO_CALENDAR,
} = require('./src/services/calendarBrain');

function deveByPassFatoPassado(msg) {
  return RE_FATO_PASSADO.test(msg) && !RE_VERBO_IMPERATIVO_CALENDAR.test(msg);
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

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
