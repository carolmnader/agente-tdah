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
  deveRebaixarPosOpus,
  classificarPorJanela,
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

// ─── Commit 3 — Sabor B/C: guard pós-Opus exige sinal de calendar ───
const CENARIOS_GUARD = [
  // rebaixa: Opus classificou consulta/criar mas a msg não tem NENHUM sinal
  { n: 'BC1',  acao: 'consultar_evento', msg: 'Bressan o nome dele',       rebaixa: true  },
  { n: 'BC2',  acao: 'criar',            msg: 'isso mesmo, é o nome dele',  rebaixa: true  }, // resposta sem noun → guard pega
  { n: 'BC3',  acao: 'consultar_evento', msg: 'o nome dele é Bressan',      rebaixa: true  },
  // divisão de trabalho: declarativa COM noun (psiquiatra ∈ vocab) → guard NÃO
  // rebaixa; quem mata é o PROMPT (few-shot da declarativa). Não-determinístico
  // testar o prompt, mas TRAVAMOS aqui que o guard deixa passar (igual psicólogo).
  { n: 'BC2b', acao: 'criar',            msg: 'Agora vou ter meu psiquiatra Bressan', rebaixa: false },
  // NÃO rebaixa: tem sinal (noun de agenda, verbo imperativo, ou hora)
  { n: 'BC4',  acao: 'criar',            msg: 'agenda manicure às 15h',     rebaixa: false }, // imperativo+hora, noun fora do vocab
  { n: 'BC5',  acao: 'consultar_evento', msg: 'que horas é o psicólogo?',   rebaixa: false }, // noun
  { n: 'BC6',  acao: 'criar',            msg: 'marca 14h',                  rebaixa: false }, // hora
  // ações fora do conjunto gated nunca rebaixam (mesmo sem sinal)
  { n: 'BC7',  acao: 'ver_hoje',         msg: 'oi tudo bem?',               rebaixa: false },
  { n: 'BC8',  acao: 'cancelar',         msg: 'Bressan o nome dele',        rebaixa: false },
];
for (const c of CENARIOS_GUARD) {
  const real = deveRebaixarPosOpus(c.acao, c.msg);
  check(
    `${c.n}) [${c.acao}] "${c.msg.substring(0, 40)}" rebaixa=${c.rebaixa}`,
    real === c.rebaixa,
    `esperado=${c.rebaixa} real=${real}`
  );
}

// ─── Commit 4 — contrato de export de ../integrations/calendar ───
// Bug: getCalendarioInfo era usado no handler consultar_evento (calendarBrain
// :741/:751) mas NÃO estava no module.exports → undefined cross-module →
// TypeError síncrono mascarado como "Calendar não respondeu". Este assert trava
// que todo símbolo que o calendarBrain desestrutura de calendar.js exista.
// (calendar.js já é carregado via calendarBrain no topo deste arquivo; roda no
//  gate determinístico com DOTENV_CONFIG_PATH apontando pro .env do repo pai.)
const calendarMod = require('./src/integrations/calendar');
const EXPORT_FUNCOES = [
  'listarEventosHoje', 'listarEventosSemana', 'criarEvento', 'reagendarEvento',
  'cancelarEvento', 'proximoHorarioLivre', 'buscarEvento', 'detectarCategoria',
  'getAuthClient', 'getCalendarioInfo', 'construirRRULE',
  'CalendarOperationError', 'CalendarInsertError',
];
const EXPORT_DADOS = ['CATEGORIAS', 'CAP_PADRAO_RECORRENCIA']; // objetos, não funções
for (const sym of EXPORT_FUNCOES) {
  check(`EXPORT) typeof calendar.${sym} === 'function'`,
    typeof calendarMod[sym] === 'function',
    `real=${typeof calendarMod[sym]}`);
}
for (const sym of EXPORT_DADOS) {
  check(`EXPORT) calendar.${sym} definido`,
    typeof calendarMod[sym] !== 'undefined',
    `real=${typeof calendarMod[sym]}`);
}
// shape que o handler consultar_evento usa (info.emoji + info.nome)
const _info = calendarMod.getCalendarioInfo('inexistente');
check('EXPORT) getCalendarioInfo(x) retorna {nome,emoji}',
  !!_info && typeof _info.nome === 'string' && typeof _info.emoji === 'string',
  `real=${JSON.stringify(_info)}`);

// ─── Commit 5 — escopo temporal em consultar_evento ───
// Captura do período (preClassificarConsulta passa a trazer intent.periodo):
const capP = preClassificarConsulta('Tenho psiquiatra hoje?');
check('P1) "Tenho psiquiatra hoje?" → evento_original=psiquiatra',
  capP && capP.evento_original === 'psiquiatra', `real=${JSON.stringify(capP)}`);
check('P2) "Tenho psiquiatra hoje?" → periodo=hoje',
  capP && capP.periodo === 'hoje', `real=${capP && capP.periodo}`);
const capA = preClassificarConsulta('Tenho médico amanhã?');
check('P3) "Tenho médico amanhã?" → periodo=amanhã',
  capA && capA.periodo === 'amanhã', `real=${capA && capA.periodo}`);
const capN = preClassificarConsulta('Quando é meu psiquiatra?');
check('P4) "Quando é meu psiquiatra?" → periodo=null',
  capN && capN.periodo === null, `real=${capN && capN.periodo}`);

// classificarPorJanela (PURA — bounds por parâmetro, sem Date.now):
const J_tMin = new Date('2026-05-29T00:00:00-03:00');
const J_tMax = new Date('2026-05-29T23:59:59-03:00');
const evDentro = { summary: 'Dentro', start: { dateTime: '2026-05-29T10:00:00-03:00' } };
const evFora   = { summary: 'Fora',   start: { dateTime: '2026-06-24T15:00:00-03:00' } };
const r1 = classificarPorJanela([evFora, evDentro], J_tMin, J_tMax);
check('J1) dentro da janela → naJanela tem o do dia',
  r1.naJanela.length === 1 && r1.naJanela[0].summary === 'Dentro', `real=${JSON.stringify(r1.naJanela.map(e=>e.summary))}`);
const r2 = classificarPorJanela([evFora], J_tMin, J_tMax);
check('J2) só fora → naJanela vazio + proximo=Fora',
  r2.naJanela.length === 0 && r2.proximo && r2.proximo.summary === 'Fora', `real=${JSON.stringify(r2)}`);
const r3 = classificarPorJanela([], J_tMin, J_tMax);
check('J3) vazio → naJanela vazio + proximo=null',
  r3.naJanela.length === 0 && r3.proximo === null);
const J_julMin = new Date('2026-07-01T00:00:00-03:00');
const J_julMax = new Date('2026-07-01T23:59:59-03:00');
const r4 = classificarPorJanela([evFora, evDentro], J_julMin, J_julMax);
check('J4) ambos fora → proximo é o mais cedo (Dentro 29/05), não ordem do array',
  r4.naJanela.length === 0 && r4.proximo && r4.proximo.summary === 'Dentro', `real=${r4.proximo && r4.proximo.summary}`);
const J_localMin = new Date(2026, 4, 29, 0, 0, 0, 0);
const J_localMax = new Date(2026, 4, 29, 23, 59, 59, 999);
const evAllDay = { summary: 'AllDay', start: { date: '2026-05-29' } };
const r5 = classificarPorJanela([evAllDay], J_localMin, J_localMax);
check('J5) all-day no dia → naJanela (start.date tratado como 00:00 LOCAL)',
  r5.naJanela.length === 1 && r5.naJanela[0].summary === 'AllDay', `real=${JSON.stringify(r5.naJanela.map(e=>e.summary))}`);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
