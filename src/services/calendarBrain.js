const Anthropic = require('@anthropic-ai/sdk');
const { listarEventosHoje, listarEventosSemana, criarEvento, reagendarEvento, cancelarEvento, proximoHorarioLivre, buscarEvento, detectarCategoria } = require('../integrations/calendar');
const { buscarMemoriaPorChave, salvarAcaoPendente, buscarAcaoPendente, limparAcaoPendente } = require('./memorySupabase');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Memória de sessão: apelidos, conflitos pendentes, último evento mencionado
if (!global.ariaMemoria) {
  global.ariaMemoria = {
    apelidos: {},
    conflitosCalendarPendentes: null,
    ultimoEventoMencionado: null,
  };
}

// Emojis automáticos por categoria
const EMOJIS_CATEGORIA = {
  casamento: '💍', 'pre-wedding': '💍', 'pre wedding': '💍', noivado: '💍',
  festa: '🎉', aniversario: '🎂', aniversário: '🎂', formatura: '🎓', show: '🎵',
  reuniao: '💼', reunião: '💼', cliente: '💼', call: '📞', apresentacao: '📊',
  academia: '💪', treino: '💪', gym: '💪', exercicio: '💪', exercício: '💪',
  yoga: '🧘', pilates: '🧘', corrida: '🏃',
  medico: '🏥', médico: '🏥', dentista: '🦷', psicologo: '🧠', psicólogo: '🧠',
  psiquiatra: '🧠', terapia: '🧠', consulta: '🏥', exame: '🏥',
  almoco: '🍽️', almoço: '🍽️', jantar: '🍷', cafe: '☕', café: '☕',
  aeroporto: '✈️', voo: '✈️', viagem: '✈️', embarque: '✈️',
  salao: '💅', salão: '💅', unhas: '💅', make: '💄', cabelo: '💇', beleza: '💅',
  sobrancelha: '✨', depilacao: '✨', depilação: '✨',
  aula: '📚', curso: '📚', estudo: '📚', faculdade: '🎓',
  acordar: '⏰', cafe_manha: '☕', banho: '🚿', arrumar: '👗',
  deslocamento: '🚗', buffer: '🌿',
};

const adicionarEmoji = (titulo) => {
  // Se já começa com emoji (qualquer char > U+2000), retorna sem alterar
  const code = titulo.codePointAt(0);
  if (code > 0x2000) return titulo;

  const tituloLower = titulo.toLowerCase();
  for (const [chave, emoji] of Object.entries(EMOJIS_CATEGORIA)) {
    if (tituloLower.includes(chave)) {
      return emoji + ' ' + titulo;
    }
  }
  return '📌 ' + titulo;
};

const categorizarEvento = (titulo) => {
  const t = titulo.toLowerCase();
  if (/casamento|pre.?wedding|noivado|festa|aniversar|formatura|show|balada/.test(t)) return 'Eventos';
  if (/reunia|reuniã|cliente|call|apresenta|projeto|trabalho/.test(t)) return 'Trabalho';
  if (/academia|treino|gym|exerc|yoga|pilates|corrida/.test(t)) return 'Selfcare';
  if (/medic|médic|dentist|psicolog|terapia|consulta|exame/.test(t)) return 'Selfcare';
  if (/salao|salão|unhas|make|cabelo|beleza|sobrancelh|depila/.test(t)) return 'Selfcare';
  if (/aula|curso|estudo|faculdade/.test(t)) return 'Estudo';
  if (/almoc|almoç|jantar|café|cafe/.test(t)) return 'Eventos';
  if (/aeroporto|voo|viagem|embarque/.test(t)) return 'Eventos';
  return 'Trabalho';
};

// ─── Pré-classificador de intenção (Bug #1: categoria × horário) ───
// Detecta padrões óbvios em JS antes de chamar Opus, dá hint pra desambiguar
// reagendar (destino=horário) vs mudar_calendario (destino=nome de calendário).
const NOMES_CALENDARIOS = ['Saúde','Saude','Trabalho','Selfcare','Eventos','Lazer','Estudo','Faculdade','Burocracia','Lar/Pets','Lar','Pets'];
const REGEX_NOME_CALENDARIO = new RegExp(`\\b(${NOMES_CALENDARIOS.map(n => n.replace(/\//g, '\\/?')).join('|')})\\b`, 'i');
const REGEX_HORARIO_TEXTO = /\b(\d{1,2}[:h]\d{0,2}|\d{1,2}\s*h(oras?)?|meio[-\s]?dia|meia[-\s]?noite)\b/i;
const REGEX_VERBO_MUDANCA = /\b(muda|mudar|passa|passar|move|mover|joga|jogar|coloca|colocar|p[oõ]e|p[oõ]r|categoriza|recategoriza)\b/i;

// Padrões pt-BR de recorrência (Bug #6)
const PADROES_RECORRENCIA = [
  /\b(todos?\s+(os\s+)?dias?|diariamente|todo\s+dia)\b/i,
  /\btoda\s+(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i,
  /\b(toda\s+semana|semanalmente)\b/i,
  /\b(todo\s+m[eê]s|mensalmente|todo\s+dia\s+\d{1,2}\b)\b/i,
  /\b(de\s+segunda\s+a\s+sexta|seg\s+a\s+sex)\b/i,
];
const REGEX_ESSA_SEMANA = /\b(essa|esta|nessa|nesta)\s+semana\b/i;

// Bug #12 + #19: pré-classificador JS de consulta de evento.
// Bypass do Opus em perguntas óbvias sobre horário — Opus tende a marcar como
// nao_e_calendar e responder do histórico (Bug #12 confirmado em prod 04/05).
const RE_CONSULTA_FORTE = /^\s*(que horas|a que horas|quando)\b/i;
const RE_CONSULTA_TEM = /^\s*(tem|tenho)\b/i;
// Sabor B-JS: "tem/tenho" só vira consulta se a frase NOMEAR um evento.
// Antes era denylist (RE_FALSO_POSITIVO_TEM*) — whack-a-mole que furava em
// "Tenho contato de desenhista" e "Tenho usado música clássica pra trabalhar".
// Agora é allowlist: reusa o vocabulário de agenda já existente
// (EMOJIS_CATEGORIA, fonte única), sem criar lista nova. Marcador temporal
// sozinho NÃO basta — "Tenho até as 17h livre" tem "17h" mas não nomeia evento.
const RE_SUBSTANTIVO_AGENDA = new RegExp(
  '\\b(' + Object.keys(EMOJIS_CATEGORIA).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);
function temSinalCalendar(msg) {
  if (!msg) return false;
  return RE_SUBSTANTIVO_AGENDA.test(String(msg).toLowerCase());
}

// Onda 1.6 Opção C: bypass do Opus pra declarações de fato passado.
// Frase começando com "Não fui/fiz/consegui/...", "Esqueci", "Cheguei tarde",
// "Perdi", "Faltei" NÃO é intent de Calendar — é contexto narrativo. Combinada
// com RE_VERBO_IMPERATIVO_CALENDAR pra preservar frases compostas
// ("Não fui ao mercado. Agenda pra amanhã" → tem verbo imperativo → segue).
// Bug K: lookahead `(?=$|\W)` em vez de `\b` final pra funcionar com chars
// acentuados (ex: "saí" + espaço — `\b` falha entre `í` non-word e espaço non-word).
const RE_FATO_PASSADO = /^\s*(n[aã]o\s+(fui|fiz|consegui|deu|cheguei|tive|rolou|aconteceu|sa[íi]|acordei)|cheguei\s+tarde|esqueci|perdi|faltei|pulei|passei\s+o\s+dia\s+sem|deixei\s+pra\s+l[aá]|acabei\s+n[aã]o|falhei|escapei|travei)(?=$|\W)/i;
const RE_VERBO_IMPERATIVO_CALENDAR = /\b(cancela|cancelar|desmarca|desmarcar|tira|tirar|remove|adiciona|adicionar|marca|marcar|agenda|agendar|reagenda|reagendar|muda|mudar|move|mover|coloca|p[oõ]e|bota)\b/i;

// Sabor A: relato de atividade JÁ FEITA (passado POSITIVO) não é intent de
// Calendar — "Fiz yoga", "Musculação fiz", "Terminei o Archicad", "Fui pra
// academia". RE_FATO_PASSADO (Bug K) só cobria o NEGATIVO ("não fiz/fui").
// Mesmo boundary `(?=$|\W)` do Bug K (chars acentuados). O grupo opcional
// `(\S+\s+)?` tolera UM objeto antes do verbo ("Musculação fiz" → verbo no fim).
// Pareado no guard com !imperativo (preserva "Agenda yoga que fiz") e !horário
// explícito ("Fiz yoga às 8h" é ambíguo → deixa Opus decidir).
const RE_FATO_PASSADO_POSITIVO = /^\s*(\S+\s+)?(fiz|fez|fizemos|fui|fomos|terminei|completei|consegui|acabei\s+de|j[áa]\s+(fiz|fui|terminei))(?=$|\W)/i;

// Sabor B/C: guard determinístico pós-Opus (cinto — a camada primária é a
// moldura positiva do PROMPT_INTENT). Uma intent de consulta/criar só sobrevive
// se a mensagem tem ALGUM sinal de calendar: substantivo de agenda OU verbo
// imperativo OU hora explícita. Sem nenhum → era declarativa/resposta
// ("Bressan o nome dele"). Declarativa COM noun ("vou ter meu psiquiatra/
// psicólogo amanhã") tem sinal → guard NÃO rebaixa; quem pega é o PROMPT.
// Sinal de propósito mais largo que temSinalCalendar (noun-only): "agenda
// manicure às 15h" tem verbo+hora e deve criar mesmo com noun fora do vocabulário.
const ACOES_EXIGEM_SINAL = ['consultar_evento', 'criar', 'criar_lote', 'criar_recorrente'];
function sinalCalendarGuard(msg) {
  const m = String(msg || '');
  return temSinalCalendar(m) || RE_VERBO_IMPERATIVO_CALENDAR.test(m) || REGEX_HORARIO_TEXTO.test(m);
}
function deveRebaixarPosOpus(acao, msg) {
  return ACOES_EXIGEM_SINAL.includes(acao) && !sinalCalendarGuard(msg);
}

// Bug L: negação CLARA do fluxo de cancelamento, dividida em 2 níveis.
//
// FORTE: padrão por si só inequívoco — "não quero cancelar" / "não era pra
// cancelar" / "pra você saber apenas". Inclui "cancelar" como objeto de "não
// quero" (infinitivo NÃO é imperativo). Não precisa proteção.
//
// AMBIGUA: gatilhos que podem coexistir com imperativo Calendar — "esquece",
// "percebi que", "me confundi", "deixa pra lá". Protegida por
// !RE_VERBO_IMPERATIVO_CALENDAR (simetria com RE_FATO_PASSADO):
// "Percebi que tem 3, cancela o 2" → tem "cancela" imperativo → segue fluxo
// normal de cancelamento em vez de limpar pendente.
const NEG_FLUXO_FORTE = /(^|\b)(eu\s+)?n[aã]o\s+(quero|queria|vou|preciso|era pra)\s+(cancelar|que cancele|mais|isso)|^n[aã]o era pra\b|s[oó]\s+(pra|para)\s+(voc[eê]\s+)?saber|pra\s+voc[eê]\s+saber\s+apenas/i;
const NEG_FLUXO_AMBIGUA = /^(esquece|deixa pra l[aá]|me confundi|confundi|percebi que)\b/i;

function extrairTermoConsulta(msg) {
  let t = String(msg || '').trim()
    .replace(/[?!.]+$/, '')
    .replace(/^(que horas|a que horas|quando|tem|tenho)\s+/i, '')
    .replace(/^(é|e|sao|são|fica)\s+/i, '')
    .replace(/^(o|a|os|as|meu|minha|meus|minhas|um|uma)\s+/i, '')
    .replace(/\s+(hoje|amanh[ãa]|essa semana|nesta semana|na (segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo))\s*$/i, '')
    .trim();
  return t.length >= 2 ? t : null;
}

// Captura o escopo temporal da pergunta (mesma lista de tokens que
// extrairTermoConsulta descarta em :155). Usado pra filtrar consultar_evento
// por janela. Sem token → null. Função PURA (não toca Date).
// `(?=$|\W)` em vez de `\b` final: lição do Bug K — `\b` falha depois de char
// acentuado ("amanhã" termina em ã, non-word → sem boundary antes de "?").
const RE_PERIODO = /\b(hoje|amanh[ãa]|essa semana|nesta semana|na\s+(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo))(?=$|\W)/i;
function detectarPeriodo(msg) {
  const match = String(msg || '').match(RE_PERIODO);
  return match ? match[0].trim().toLowerCase() : null;
}

function preClassificarConsulta(msg) {
  if (!msg) return null;
  const m = String(msg).trim();
  const ehForte = RE_CONSULTA_FORTE.test(m);
  const ehTem = RE_CONSULTA_TEM.test(m) && temSinalCalendar(m);
  if (!ehForte && !ehTem) return null;
  const termo = extrairTermoConsulta(m);
  if (!termo) return null;
  return { acao: 'consultar_evento', evento_original: termo, periodo: detectarPeriodo(m), raciocinio: 'pre-classificador JS (bypass Opus)' };
}

function dicaIntent(msg) {
  if (!msg) return null;
  // Recorrência tem prioridade — verbo de criação ("agenda"/"cria") não está no REGEX_VERBO_MUDANCA
  if (PADROES_RECORRENCIA.some(re => re.test(msg))) {
    if (REGEX_ESSA_SEMANA.test(msg)) return null; // escopo curto → criar_lote (Opus decide)
    return 'criar_recorrente';
  }
  if (!REGEX_VERBO_MUDANCA.test(msg)) return null;
  const temCalendario = REGEX_NOME_CALENDARIO.test(msg);
  const temHorario = REGEX_HORARIO_TEXTO.test(msg);
  if (temCalendario && !temHorario) return 'mudar_calendario';
  if (temHorario && !temCalendario) return 'reagendar';
  return null; // ambíguo (ambos ou nenhum) — deixa Opus decidir
}

const resolverDataHora = (data, hora, agora = new Date()) => {
  const resultado = new Date(agora);
  const dias = { segunda:1, terca:2, quarta:3, quinta:4, sexta:5, sabado:6, domingo:0 };
  if (!data || data === 'hoje') {
    // mantém hoje
  } else if (data === 'amanha' || data === 'amanhã') {
    resultado.setDate(agora.getDate() + 1);
  } else if (dias[data] !== undefined) {
    let diff = dias[data] - agora.getDay();
    if (diff <= 0) diff += 7;
    resultado.setDate(agora.getDate() + diff);
  } else if (/^\d{1,2}\/\d{1,2}$/.test(data)) {
    const [dia, mes] = data.split('/').map(Number);
    resultado.setDate(dia);
    resultado.setMonth(mes - 1);
  }
  if (hora) {
    const [h, m] = hora.split(':').map(Number);
    resultado.setHours(h, m || 0, 0, 0);
  }
  return resultado;
};

// Filtro temporal de consultar_evento (Bug: "hoje" era ignorado). PURA —
// recebe bounds por parâmetro, não chama Date.now. Trata all-day (start.date,
// meia-noite LOCAL) e timed (start.dateTime). proximo = evento mais próximo
// (menor start) entre os achados; naJanela = os dentro de [timeMin,timeMax].
function parseInicioEvento(ev) {
  const s = (ev && ev.start) || {};
  if (s.dateTime) return new Date(s.dateTime);
  if (s.date) return new Date(s.date + 'T00:00:00'); // all-day → 00:00 LOCAL
  return null;
}
function classificarPorJanela(eventos, timeMin, timeMax) {
  const comData = (eventos || [])
    .map(ev => ({ ev, ini: parseInicioEvento(ev) }))
    .filter(x => x.ini && !isNaN(x.ini.getTime()))
    .sort((a, b) => a.ini - b.ini);
  const naJanela = comData.filter(x => x.ini >= timeMin && x.ini <= timeMax).map(x => x.ev);
  const proximo = comData.length ? comData[0].ev : null;
  return { naJanela, proximo };
}
// Converte o token de período (cru) na janela [timeMin,timeMax]. Impura (usa
// resolverDataHora/now); o handler chama isto e passa os bounds pra helper pura.
function janelaDoPeriodo(periodo) {
  const p = String(periodo || '').toLowerCase().trim();
  const agora = new Date();
  if (/semana/.test(p)) {
    const timeMin = new Date(agora); timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(agora); timeMax.setDate(agora.getDate() + 7); timeMax.setHours(23, 59, 59, 999);
    return { timeMin, timeMax };
  }
  const tok = p.replace(/^na\s+/, '').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  const dia = resolverDataHora(tok, null);
  const timeMin = new Date(dia); timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(dia); timeMax.setHours(23, 59, 59, 999);
  return { timeMin, timeMax };
}

const buscarComSinonimos = async (termo, sinonimos = []) => {
  const apelidos = global.ariaMemoria.apelidos;
  const todoTermos = [termo, ...sinonimos];
  if (apelidos[termo.toLowerCase()]) todoTermos.push(apelidos[termo.toLowerCase()]);
  const sinonimosBuiltin = {
    'salão': ['salao', 'unhas', 'make', 'cabelo', 'beleza'],
    'salao': ['salão', 'unhas', 'make', 'cabelo', 'beleza'],
    'psico': ['psicólogo', 'psicologo', 'terapia', 'terapeuta'],
    'psicólogo': ['psicologo', 'psico', 'terapia'],
    'academia': ['treino', 'exercício', 'exercicio', 'gym'],
    'treino': ['academia', 'exercício', 'gym'],
    'médico': ['medico', 'consulta', 'exame'],
    'medico': ['médico', 'consulta'],
  };
  const extra = sinonimosBuiltin[termo.toLowerCase()] || [];
  todoTermos.push(...extra);
  const unicos = [...new Set(todoTermos)];
  for (const t of unicos) {
    const r = await buscarEvento(t);
    if (r && r.length > 0) {
      global.ariaMemoria.apelidos[termo.toLowerCase()] = r[0].summary;
      return r;
    }
  }
  if (termo.length > 4) {
    const parcial = termo.substring(0, 4);
    const r = await buscarEvento(parcial);
    if (r && r.length > 0) return r;
  }
  return [];
};

// ─── Guard de confirmação para ações destrutivas ───
// Estado mora em Supabase (tabela acoes_pendentes) — sobrevive ao reciclo de instâncias serverless

const formatarQuandoEvento = (ev) => {
  try {
    const inicio = ev.start?.dateTime || ev.start?.date;
    if (!inicio) return '';
    const d = new Date(inicio);
    const dia = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return ` em ${dia} às ${hora}`;
  } catch (e) { return ''; }
};

const executarCriarLote = async (eventosLote) => {
  const mem = global.ariaMemoria;
  const criados = [], conflitos = [];

  await Promise.all(eventosLote.map(async (ev) => {
    try {
      const tituloFinal = adicionarEmoji(ev.titulo || 'Evento');
      const dh = resolverDataHora(ev.data, ev.hora);
      const fim = new Date(dh.getTime() + (ev.duracao_minutos || 60) * 60000);
      const { google } = require('googleapis');
      const { getAuthClient } = require('../integrations/calendar');
      const cal = google.calendar({ version: 'v3', auth: getAuthClient() });
      const existentes = await cal.events.list({
        calendarId: 'primary',
        timeMin: dh.toISOString(), timeMax: fim.toISOString(), singleEvents: true,
      });
      const ocupados = (existentes.data.items || []).filter(e => !e.summary?.includes('Buffer') && !e.summary?.includes('🌿'));
      const evCal = ev.calendario || categorizarEvento(tituloFinal);
      if (ocupados.length > 0) {
        // Onda 1.8 Opção A: guarda IDs do evento existente pra delete atomico
        // no handler "substitui". Antes era so `existente: ocupados[0].summary`
        // (string), que forcava cancelarEvento(termo) a refazer busca — bug F.
        conflitos.push({
          novo: { ...ev, titulo: tituloFinal, calendario: evCal },
          existente: {
            id: ocupados[0].id,
            calendarId: ocupados[0]._calendarId || 'primary',
            summary: ocupados[0].summary,
            startISO: ocupados[0].start?.dateTime || ocupados[0].start?.date,
          }
        });
      } else {
        await criarEvento(tituloFinal, dh, ev.duracao_minutos || 60, evCal);
        criados.push({ ...ev, titulo: tituloFinal });
      }
    } catch (e) {
      const tituloFinal = adicionarEmoji(ev.titulo || 'Evento');
      const evCal = ev.calendario || categorizarEvento(tituloFinal);
      const dh = resolverDataHora(ev.data, ev.hora);
      await criarEvento(tituloFinal, dh, ev.duracao_minutos || 60, evCal);
      criados.push({ ...ev, titulo: tituloFinal });
    }
  }));

  let resp = '';
  if (criados.length > 0) {
    const dataRef = resolverDataHora(criados[0].data, criados[0].hora);
    const diaFmt = dataRef.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    resp += `📅 <b>${criados.length} evento(s) criados — ${diaFmt}:</b>\n\n`;
    const ordenados = [...criados].sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    ordenados.forEach(ev => {
      resp += `⏰ <b>${ev.hora}</b> — ${ev.titulo} (${ev.duracao_minutos || 60}min)\n`;
    });
    resp += `\n🌿 Buffers de 20min adicionados entre compromissos`;
  }

  if (conflitos.length > 0) {
    mem.conflitosCalendarPendentes = conflitos;
    resp += `\n\n⚠️ <b>${conflitos.length} conflito(s) detectado(s):</b>\n`;
    conflitos.forEach(c => {
      resp += `🔴 "${c.novo.titulo}" conflita com "<b>${c.existente.summary}</b>"\n`;
    });
    resp += `\nO que prefere?\n▸ <b>"substitui"</b> — remove os antigos e cria os novos\n▸ <b>"pula os conflitos"</b> — mantém os já criados`;
  }

  return resp || '❌ Não consegui criar os eventos.';
};

const executarAcaoConfirmada = async (pendente) => {
  const { tipo, params } = pendente;
  try {
    if (tipo === 'cancelar') {
      return await cancelarEvento(params.evento_original);
    }
    if (tipo === 'reagendar') {
      const novoHorario = `${params.nova_data || params.data || 'hoje'} às ${params.nova_hora || ''}`;
      return await reagendarEvento(params.evento_original, novoHorario);
    }
    if (tipo === 'mudar_calendario') {
      const { google } = require('googleapis');
      const { getAuthClient, CATEGORIAS } = require('../integrations/calendar');
      const cal = google.calendar({ version: 'v3', auth: getAuthClient() });
      const config = CATEGORIAS[params.novaCategoria] || CATEGORIAS['Trabalho'] || { cor: '9', emoji: '💼' };
      await cal.events.patch({
        calendarId: params.calOrigem,
        eventId: params.eventId,
        resource: { colorId: config.cor },
      });
      return `✅ <b>${params.summary}</b> agora está em ${config.emoji} <b>${params.novaCategoria}</b>`;
    }
    if (tipo === 'criar_lote') {
      return await executarCriarLote(params.eventos);
    }
    if (tipo === 'criar_recorrente') {
      const { titulo, hora, duracao_minutos, categoria, data_inicio, rrule } = params;
      const dh = resolverDataHora(data_inicio, hora);
      return await criarEvento(titulo, dh, duracao_minutos, categoria, rrule);
    }
    return '❌ Ação pendente desconhecida.';
  } catch (e) {
    console.error('[CalendarBrain] Erro ao executar ação confirmada:', e.message);
    return `❌ Deu erro ao executar: ${e.message}`;
  }
};

const PROMPT_INTENT = `Você é o cérebro de agenda da ARIA, assistente pessoal da Carol com TDAH.

CONTEXTO:
- Agora: {HORA_ATUAL} de {DIA_SEMANA}, {DATA_ATUAL}
- Agenda de hoje: {AGENDA_HOJE}
- Histórico recente: {HISTORICO}
- Apelidos desta sessão: {APELIDOS}
- Dica do pré-classificador (regex JS): {DICA_INTENT}

MENSAGEM DA CAROL: {MENSAGEM}

CALENDÁRIOS DISPONÍVEIS: Selfcare, Trabalho, Estudo, Eventos, Saúde, Lazer, Lar/Pets, Faculdade, Burocracia.

REGRAS ABSOLUTAS:
0. ATENÇÃO: palavras como "Saúde", "Trabalho", "Eventos", "Estudo", "Selfcare", "Lazer", "Burocracia", "Faculdade", "Lar/Pets" são CALENDÁRIOS, não horários. Se aparecerem junto com um horário ("Saúde às 14h"), o calendário é "Saúde" e o horário é "14:00". NUNCA coloque nome de calendário no campo hora.
1. SINÔNIMOS: "salão" pode ser "unhas/make/cabelo/beleza". "psico"="psicólogo/terapia". "treino"="academia". Se usou apelido antes, lembre.
2. EMOJIS: sempre inclua emoji no título. Pre-wedding=💍, Psicólogo=🧠, Academia=💪, Almoço=🍽️, Aeroporto=✈️, Salão=💅, Médico=🏥, Festa=🎉, Reunião=💼, Vet=🐾, Banco=🏦.
3. CATEGORIZAÇÃO automática de calendário:
   - Médico/psicólogo/dentista/exame/consulta → Saúde
   - Reunião/call/cliente/projeto → Trabalho
   - Academia/yoga/pilates/treino/meditação/salão/beleza → Selfcare
   - Festa/casamento/pre-wedding/aniversário/show → Eventos
   - Aula/curso/livro/leitura → Estudo
   - Faculdade/universidade/TCC → Faculdade
   - Cinema/passeio/praia/bar/happy → Lazer
   - Casa/pet/vet/faxina/mercado → Lar/Pets
   - Banco/cartório/documento/imposto → Burocracia
   - Almoço/jantar/café/brunch → Eventos
4. DESLOCAMENTO: se dois eventos consecutivos são em locais diferentes, adicione 20-30min de margem. Psicólogo acaba 14h + 30min deslocamento = salão às 14h30 no mínimo.
5. CONFLITO: verifique mentalmente a agenda antes de sugerir horário. Se há sobreposição, sugira horário alternativo automaticamente.
6. CONTEXTO: "o resto", "os outros", "os demais" refere-se à conversa anterior. Leia o histórico.
7. LOTE: se houver 2+ eventos, use criar_lote com array completo.
8. LINGUAGEM INFORMAL: "bota"=criar, "tira"/"desmarca"=cancelar, "empurra"/"puxa"/"move"=reagendar, "reorganiza"=reorganizar.
9. MUDAR CALENDÁRIO: "muda categoria para Saúde", "coloca no Trabalho", "põe no Selfcare" → acao: mudar_calendario. O evento_original é o evento mencionado anteriormente no histórico ou na mensagem.
10. CONSULTAR EVENTO (Bug #12): perguntas sobre quando/que horas é um evento → acao: consultar_evento. SEMPRE consulte o Calendar real via essa ação — ela aciona buscarEvento que é a única fonte de verdade sobre eventos. O histórico da conversa é só contexto, nunca fonte factual sobre horários.

EXEMPLOS DE CONSULTAR EVENTO:
- "que horas é o almoço?" → acao: consultar_evento, evento_original: "almoço"
- "quando é a reunião com Ana?" → acao: consultar_evento, evento_original: "reunião Ana"
- "tem psicólogo amanhã?" → acao: consultar_evento, evento_original: "psicólogo"
- "a que horas é meu treino hoje?" → acao: consultar_evento, evento_original: "treino"
- (NÃO confundir) "agenda almoço amanhã às 13h" → acao: criar (verbo de criação)
- (NÃO confundir) "muda almoço pra 14h" → acao: reagendar (verbo de mudança)

11. NÃO-CALENDAR (declarativas/respostas): classifique como consulta ou criar SOMENTE quando houver sinal de calendar — verbo de agenda (agenda/marca/cancela/reagenda/move), horário/data, OU um evento nomeado a buscar. Declaração de fato, opinião, resposta conversacional ou continuação de papo NÃO é calendar → acao: nao_e_calendar. Na dúvida sem sinal, prefira nao_e_calendar (o histórico não é fonte factual).

EXEMPLOS DE NÃO-CALENDAR:
- "Bressan o nome dele" → acao: nao_e_calendar (resposta conversacional, sem verbo/hora/evento)
- "Agora vou ter meu psiquiatra Bressan" → acao: nao_e_calendar (declarativa "vou ter", não é pedido de agendar)
- "Tô indo pro mercado" / "fui no salão" → acao: nao_e_calendar (relato, não comando)
- "Tenho usado música pra focar" → acao: nao_e_calendar (narrativa, não consulta)

EXEMPLOS DE MUDAR CALENDÁRIO:
- "muda categoria para Saúde" → acao: mudar_calendario, calendario: "Saúde", evento_original: último evento mencionado
- "coloca no Trabalho" → acao: mudar_calendario, calendario: "Trabalho"
- "psicólogo às 14h" → acao: criar, calendario: "Saúde", hora: "14:00" (NÃO é mudar_calendario)

DESAMBIGUAÇÃO REAGENDAR vs MUDAR_CALENDARIO (CRÍTICO — Bug #1):
- Destino é HORÁRIO (HH:MM, "15h", "meio-dia") → reagendar
- Destino é CALENDÁRIO (Saúde/Trabalho/Selfcare/Eventos/Lazer/Estudo/Faculdade/Burocracia/Lar/Pets) → mudar_calendario
- Se mencionar AMBOS na mesma frase: prefira reagendar (Carol pode mudar a cor depois).
- A regra 8 (LINGUAGEM INFORMAL) lista "move" como reagendar — isso vale APENAS quando o destino é horário. Se o destino é um nome de calendário, sempre mudar_calendario.

EXEMPLOS DE DESAMBIGUAÇÃO:
- "muda almoço pra 13h" → reagendar (13h é hora)
- "muda almoço pra Saúde" → mudar_calendario (Saúde é calendário)
- "passa o almoço de 12h pra 13h" → reagendar
- "passa o almoço de Trabalho pra Saúde" → mudar_calendario
- "move o psicólogo pra Selfcare" → mudar_calendario (NÃO reagendar, mesmo com "move")
- "puxa o almoço pra 13h" → reagendar
- "joga o almoço pra Saúde" → mudar_calendario

ATENÇÃO: se a "Dica do pré-classificador" do CONTEXTO indicar uma ação ('reagendar' ou 'mudar_calendario'), prefira ela — só desvie se a mensagem da Carol contradiz claramente.

RECORRÊNCIA / SEQUÊNCIA / ROTINA (Bug #6):
- Use criar_recorrente quando a frase indicar REPETIÇÃO: "todos os dias", "diariamente", "toda segunda/terça/...", "todo mês", "de segunda a sexta", "semanalmente".
- frequencia: "daily" (todos os dias), "weekly" (toda segunda OU "de segunda a sexta"), "monthly" (todo mês, todo dia X).
- dias_semana: ["MO","TU","WE","TH","FR","SA","SU"] — só pra weekly. "de segunda a sexta" → ["MO","TU","WE","TH","FR"]. "toda quarta" → ["WE"].
- ate_data (UNTIL): "até dezembro" → "2026-12-31"; "até 30/04" → "2026-04-30". Formato YYYY-MM-DD.
- contagem (COUNT): "por 5 dias", "5 vezes", "por 3 semanas" → number.
- Sem ate_data nem contagem → cap automático (90 daily / 26 weekly / 12 monthly) aplicado pelo código.
- "essa semana"/"esta semana" → NÃO é criar_recorrente, é criar_lote (escopo curto, gere 5-7 eventos one-off).
- "próxima segunda"/"próximo mês" → NÃO é criar_recorrente, é criar simples (1 evento na data específica).
- Mensagem sem palavra de repetição ("almoço amanhã às 13h") → criar simples, NÃO criar_recorrente.

EXEMPLOS DE RECORRÊNCIA:
- "almoço todos os dias às 13h" → criar_recorrente, frequencia="daily", hora="13:00"
- "reunião toda segunda às 9h" → criar_recorrente, frequencia="weekly", dias_semana=["MO"], hora="09:00"
- "academia segunda a sexta às 7h" → criar_recorrente, frequencia="weekly", dias_semana=["MO","TU","WE","TH","FR"], hora="07:00"
- "psicólogo toda quarta até dezembro" → criar_recorrente, frequencia="weekly", dias_semana=["WE"], ate_data="2026-12-31"
- "almoço todos os dias por 5 dias" → criar_recorrente, frequencia="daily", contagem=5
- "almoço essa semana às 13h" → criar_lote (NÃO criar_recorrente)
- "reunião próxima segunda às 14h" → criar simples (1 evento, NÃO criar_recorrente)
- "almoço hoje às 13h" → criar simples (sem palavra de repetição)

RETORNE APENAS JSON:
{
  "acao": "ver_hoje|ver_semana|criar|criar_lote|criar_recorrente|reagendar|cancelar|consultar_evento|horario_livre|reorganizar|mudar_calendario|nao_e_calendar",
  "titulo": "emoji + nome ou null",
  "data": "hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|DD/MM|null",
  "hora": "HH:MM|null",
  "duracao_minutos": number|60,
  "evento_original": "nome para buscar|null",
  "sinonimos_busca": ["termo1","termo2"],
  "nova_hora": "HH:MM|null",
  "nova_data": "string|null",
  "calendario": "Trabalho|Estudo|Eventos|Selfcare|null",
  "eventos": [{"titulo":"emoji+nome","data":"string","hora":"HH:MM","duracao_minutos":number,"calendario":"string","deslocamento_antes":number}]|null,
  "frequencia": "daily|weekly|monthly|null",
  "dias_semana": ["MO","TU","WE","TH","FR","SA","SU"]|null,
  "ate_data": "YYYY-MM-DD|null",
  "contagem": number|null,
  "intervalo": number|1,
  "data_inicio": "hoje|amanha|segunda|...|YYYY-MM-DD|null",
  "apelido_aprendido": {"termo":"string","evento_real":"string"}|null,
  "raciocinio": "explicação em 1 linha"
}`;

const processarCalendar = async (mensagem, historico = [], chatId = parseInt(process.env.TELEGRAM_CHAT_ID_CAROL || '0', 10), opcoes = {}) => {
  try {
    const mem = global.ariaMemoria;
    const msgL = mensagem.toLowerCase();

    // Onda 1.6 Opção C: bypass do Opus quando mensagem é fato passado SEM
    // verbo imperativo de Calendar. Evita interpretar "Não fui pro exercício"
    // como intent de cancelar.
    if (RE_FATO_PASSADO.test(mensagem) && !RE_VERBO_IMPERATIVO_CALENDAR.test(mensagem)) {
      console.log(`📅 [CalendarBrain] Fato passado detectado, bypass Opus: "${mensagem.substring(0, 60)}"`);
      return null;
    }

    // Sabor A: relato de passado POSITIVO ("Fiz yoga", "Musculação fiz") também
    // é narrativa, não intent de criar. !imperativo preserva "Agenda yoga que
    // fiz"; !horário deixa "Fiz yoga às 8h" (ambíguo) pro Opus.
    if (RE_FATO_PASSADO_POSITIVO.test(mensagem)
        && !RE_VERBO_IMPERATIVO_CALENDAR.test(mensagem)
        && !REGEX_HORARIO_TEXTO.test(mensagem)) {
      console.log(`📅 [CalendarBrain] Relato (passado positivo), bypass Opus: "${mensagem.substring(0, 60)}"`);
      return null;
    }

    // Resolve ação pendente (sim/não) — persistida no Supabase, expira em 5 min
    const pendente = await buscarAcaoPendente(chatId);
    if (pendente) {
      const pos = /^(sim|confirmo|pode|ok|beleza|vai|faz|manda|confirma|isso|uhum|claro|com certeza)\b/i;
      const neg = /^(n[aã]o|cancela|deixa|esquece|para|pera|espera|melhor n[aã]o)\b/i;

      // Handler especifico: seleção de evento pra cancelar (múltiplos)
      if (pendente.tipo === 'cancelar_selecao' && pendente.params?.eventos) {
        const eventos = pendente.params.eventos;

        // Match número direto: "1", "2", "3"
        const matchNum = msgL.match(/^\s*([1-9])\s*$/);
        if (matchNum) {
          const idx = parseInt(matchNum[1]) - 1;
          if (idx >= 0 && idx < eventos.length) {
            const ev = eventos[idx];
            await limparAcaoPendente(chatId);
            try {
              const { google } = require('googleapis');
              const { getAuthClient } = require('../integrations/calendar');
              const cal = google.calendar({ version: 'v3', auth: getAuthClient() });
              await cal.events.delete({ calendarId: ev.calendarId, eventId: ev.id });
              return `🗑️ <b>${ev.summary}</b> removido do calendário.`;
            } catch(e) {
              return `❌ Erro ao remover: ${e.message}`;
            }
          }
          return `Opa, só tem ${eventos.length} opções. Manda número entre 1 e ${eventos.length}.`;
        }

        // Bug L: NEG_FLUXO ANTES de matchHoje — frases negativas com "hoje"
        // ("Eu não quero cancelar... hoje", "Percebi que hoje...") cairiam no
        // path de seleção por dia (matchHoje). Causa-raiz primária do Bug L.
        // FORTE dispara sozinho; AMBIGUA exige ausência de verbo imperativo.
        const ehNegacaoFluxo = NEG_FLUXO_FORTE.test(mensagem) ||
          (NEG_FLUXO_AMBIGUA.test(mensagem) && !RE_VERBO_IMPERATIVO_CALENDAR.test(mensagem));
        if (ehNegacaoFluxo) {
          await limparAcaoPendente(chatId);
          return '✋ Ok, não cancelei nada. Se quiser outra coisa, é só pedir.';
        }

        // Match por dia: "o de hoje", "o de amanhã"
        const matchHoje = /\b(hoje|de hoje|do dia)\b/i.test(msgL);
        const matchAmanha = /\b(amanh[aã]|de amanh[aã])\b/i.test(msgL);
        if (matchHoje || matchAmanha) {
          const hoje = new Date();
          const amanha = new Date(hoje.getTime() + 24*60*60*1000);
          const alvo = matchHoje ? hoje : amanha;
          const evMatch = eventos.find(ev => {
            const start = new Date(ev.startISO);
            return start.toDateString() === alvo.toDateString();
          });
          if (evMatch) {
            await limparAcaoPendente(chatId);
            try {
              const { google } = require('googleapis');
              const { getAuthClient } = require('../integrations/calendar');
              const cal = google.calendar({ version: 'v3', auth: getAuthClient() });
              await cal.events.delete({ calendarId: evMatch.calendarId, eventId: evMatch.id });
              return `🗑️ <b>${evMatch.summary}</b> de ${matchHoje ? 'hoje' : 'amanhã'} removido.`;
            } catch(e) {
              return `❌ Erro ao remover: ${e.message}`;
            }
          }
          return `Não achei nenhum evento ${matchHoje ? 'de hoje' : 'de amanhã'} na lista. Manda o número.`;
        }

        // Cancelar a seleção
        if (neg.test(msgL)) {
          await limparAcaoPendente(chatId);
          return '✋ Ok, não cancelei nada.';
        }

        // Ainda esperando seleção válida
        return `Manda o número (1-${eventos.length}) ou "o de hoje/amanhã" pra eu saber qual cancelar.`;
      }

      // Handlers genéricos (preservados)
      if (pos.test(msgL)) {
        await limparAcaoPendente(chatId);
        return await executarAcaoConfirmada(pendente);
      }
      if (neg.test(msgL)) {
        await limparAcaoPendente(chatId);
        return '✋ Ok, não mexi em nada.';
      }
    }

    // Resolve conflitos pendentes
    if (mem.conflitosCalendarPendentes?.length > 0) {
      if (/substitui|sim|pode|cancela os|remove os|troca/.test(msgL)) {
        const conflitos = mem.conflitosCalendarPendentes;
        mem.conflitosCalendarPendentes = null;
        // Onda 1.8 Opção A: delete atomico via cal.events.delete(id, calendarId)
        // em vez de cancelarEvento(termo) — evita re-busca por termo, que
        // retornava string da lista quando recorrente (bug F prod 18/05).
        const { google } = require('googleapis');
        const { getAuthClient } = require('../integrations/calendar');
        const cal = google.calendar({ version: 'v3', auth: getAuthClient() });
        let resp = '🔄 <b>Substituindo conflitos...</b>\n\n';
        for (const c of conflitos) {
          try {
            await cal.events.delete({
              calendarId: c.existente.calendarId,
              eventId: c.existente.id,
            });
            const dh = resolverDataHora(c.novo.data, c.novo.hora);
            const tituloComEmoji = adicionarEmoji(c.novo.titulo);
            await criarEvento(tituloComEmoji, dh, c.novo.duracao_minutos || 60, c.novo.calendario || categorizarEvento(tituloComEmoji));
            resp += `✅ ${tituloComEmoji} às ${c.novo.hora}\n`;
          } catch(e) {
            resp += `❌ Erro substituindo ${c.existente.summary} → ${c.novo.titulo}: ${e.message}\n`;
          }
        }

        // Onda 1.8 Opção D: re-roteamento de frase composta apos gatilho.
        // Ex: "Sim. Coloca cinema 19h tambem" — gatilho "sim" foi processado
        // acima; resto da mensagem ("Coloca cinema 19h tambem") precisa ir
        // pro classifier de novo. Guard anti-loop via opcoes._jaProcessouSubstituicao.
        if (!opcoes._jaProcessouSubstituicao) {
          const restoMsg = mensagem
            .replace(/^[\s.,!]*\b(sim|substitui|pode|ok|beleza|confirma|troca|remove os|cancela os)\b[\s.,!]*/i, '')
            .replace(/^(tambem|também|e tambem|e também)[\s.,!]+/i, '')
            .trim();
          if (restoMsg.length > 8 && /\b(adiciona|coloca|cria|agenda|cancela|reagenda|move|tira|bota|marca)\b/i.test(restoMsg)) {
            const respExtra = await processarCalendar(restoMsg, historico, chatId, { _jaProcessouSubstituicao: true });
            if (respExtra) return `${resp}\n\n${respExtra}`;
          }
        }

        return resp;
      }
      if (/pula|ignora|só os livres|sem conflito|mantém/.test(msgL)) {
        mem.conflitosCalendarPendentes = null;
        let resp = '✅ Ok! Mantive só os eventos sem conflito.';

        // Onda 1.8 Opção D: mesmo re-roteamento aplicado ao "pula" composto.
        // Ex: "Pula. Adiciona cinema 19h tambem" — gatilho "pula" processou
        // o conflito; resto precisa ir pro classifier.
        if (!opcoes._jaProcessouSubstituicao) {
          const restoMsg = mensagem
            .replace(/^[\s.,!]*\b(pula|ignora|mantém|mantem|deixa|sem conflito|só os livres|so os livres)\b[\s.,!]*/i, '')
            .replace(/^(tambem|também|e tambem|e também)[\s.,!]+/i, '')
            .trim();
          if (restoMsg.length > 8 && /\b(adiciona|coloca|cria|agenda|cancela|reagenda|move|tira|bota|marca)\b/i.test(restoMsg)) {
            const respExtra = await processarCalendar(restoMsg, historico, chatId, { _jaProcessouSubstituicao: true });
            if (respExtra) return `${resp}\n\n${respExtra}`;
          }
        }

        return resp;
      }
    }

    // Busca agenda para contexto
    let agendaHoje = '';
    try {
      agendaHoje = (await listarEventosHoje()).replace(/<[^>]*>/g, '');
    } catch(e) { agendaHoje = 'indisponível'; }

    const agora = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    // Onda 1.6 Opção A: filtro temporal de 15min no histórico.
    // Mensagens mais antigas não contam como contexto vizinho (evita Opus
    // inferir continuidade de conversa terminada 1h+ atrás). ts === null
    // fallback defensivo: paylod sem created_at NÃO crasha, segue passando.
    const QUINZE_MIN_MS = 15 * 60 * 1000;
    const agoraMs = Date.now();
    const historicoRecente = historico.filter(m => {
      const ts = m.created_at ? new Date(m.created_at).getTime() : null;
      return ts === null || (agoraMs - ts) <= QUINZE_MIN_MS;
    });

    const historicoTexto = historicoRecente.slice(-8)
      .map(m => `${m.role === 'user' ? 'Carol' : 'ARIA'}: ${m.content?.substring(0, 120)}`)
      .join('\n');

    const dica = dicaIntent(mensagem);

    const prompt = PROMPT_INTENT
      .replace('{HORA_ATUAL}', agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))
      .replace('{DIA_SEMANA}', diasSemana[agora.getDay()])
      .replace('{DATA_ATUAL}', agora.toLocaleDateString('pt-BR'))
      .replace('{AGENDA_HOJE}', agendaHoje || 'vazia')
      .replace('{HISTORICO}', historicoTexto || 'início da conversa')
      .replace('{APELIDOS}', JSON.stringify(mem.apelidos))
      .replace('{DICA_INTENT}', dica || 'nenhuma')
      .replace('{MENSAGEM}', mensagem);

    // Bug #12: pré-classificador JS para perguntas claras sobre horário —
    // bypass do Opus, que tende a marcar como nao_e_calendar e responder do histórico.
    let intent = preClassificarConsulta(mensagem);
    if (intent) {
      console.log(`📅 [CalendarBrain] Pré-classificador: consultar_evento "${intent.evento_original}" (Opus bypassed)`);
    } else {
      const respIA = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      });
      const texto = respIA.content[0].text.trim().replace(/```json|```/g,'').trim();
      intent = JSON.parse(texto);
    }

    console.log(`📅 [CalendarBrain] Ação: ${intent.acao} | Título: ${intent.titulo || '-'} | Raciocínio: ${intent.raciocinio || '-'}`);

    // Aprende apelido
    if (intent.apelido_aprendido) {
      mem.apelidos[intent.apelido_aprendido.termo.toLowerCase()] = intent.apelido_aprendido.evento_real;
    }

    // Sabor B/C — guard pós-Opus (cinto): consulta/criar sem nenhum sinal de
    // calendar é declarativa/resposta mal-classificada → nao_e_calendar.
    // Também resolve o Sabor C: sem sinal não chama Calendar, some o
    // "Calendar não respondeu" de declarativas como "vou ter meu psiquiatra".
    if (deveRebaixarPosOpus(intent.acao, mensagem)) {
      console.log(`📅 [CalendarBrain] Guard pós-Opus: "${intent.acao}" sem sinal de calendar → nao_e_calendar: "${mensagem.substring(0, 60)}"`);
      return null;
    }

    if (intent.acao === 'nao_e_calendar') return null;

    // VER
    if (intent.acao === 'ver_hoje') return await listarEventosHoje();
    if (intent.acao === 'ver_semana') return await listarEventosSemana();
    if (intent.acao === 'horario_livre') return await proximoHorarioLivre(intent.duracao_minutos || 60);

    // CONSULTAR EVENTO (Bug #12) — sempre consulta Calendar real, nunca infere do histórico
    if (intent.acao === 'consultar_evento') {
      const termo = intent.evento_original || intent.titulo;
      if (!termo) return '📅 Qual evento você quer consultar?';
      let eventos = await buscarComSinonimos(termo, intent.sinonimos_busca || []);
      if (!eventos.length) {
        return `❌ Não achei "<b>${termo}</b>" na agenda. Quer que eu crie?`;
      }
      // Escopo temporal (Bug: "hoje" era ignorado → devolvia o próximo dos 30d).
      // Só filtra quando a pergunta trouxe período; sem período = atual, intocado.
      if (intent.periodo) {
        const { timeMin, timeMax } = janelaDoPeriodo(intent.periodo);
        const { naJanela, proximo } = classificarPorJanela(eventos, timeMin, timeMax);
        if (!naJanela.length) {
          if (!proximo) return `❌ Não achei "<b>${termo}</b>" ${intent.periodo}.`;
          const dP = new Date(proximo.start.dateTime || (proximo.start.date + 'T00:00:00'));
          const diaP = dP.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
          const horaP = proximo.start.dateTime ? ' às ' + dP.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
          return `Você não tem ${termo} ${intent.periodo}. Próximo: ${proximo.summary} — ${diaP}${horaP}.`;
        }
        eventos = naJanela;
      }
      if (eventos.length > 1) {
        let txt = `Achei ${eventos.length} eventos com "<b>${termo}</b>":\n\n`;
        const { getCalendarioInfo } = require('../integrations/calendar');
        eventos.slice(0, 5).forEach(ev => {
          const info = getCalendarioInfo(ev._calendarId);
          const d = new Date(ev.start.dateTime || ev.start.date);
          const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
          const hora = ev.start.dateTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'dia todo';
          txt += `${info.emoji} ${ev.summary} — ${dia} às ${hora}\n`;
        });
        return txt;
      }
      const ev = eventos[0];
      const { getCalendarioInfo } = require('../integrations/calendar');
      const info = getCalendarioInfo(ev._calendarId);
      const d = new Date(ev.start.dateTime || ev.start.date);
      const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      const hora = ev.start.dateTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'dia todo';
      return `${info.emoji} <b>${ev.summary}</b>\n📅 ${dia} às ${hora}\n📂 Agenda: ${info.nome}`;
    }

    // CRIAR
    if (intent.acao === 'criar') {
      if (!intent.hora) return `📅 Entendido! <b>${intent.titulo || 'Evento'}</b> — que horas?`;
      const tituloFinal = adicionarEmoji(intent.titulo || 'Evento');
      // Consulta memória → intent → detecta automático
      let categoriaFinal = intent.calendario;
      if (!categoriaFinal) {
        try {
          const memCat = await buscarMemoriaPorChave(tituloFinal.toLowerCase().substring(0, 30));
          if (memCat?.length > 0) categoriaFinal = memCat[0].valor;
        } catch(e) {}
      }
      if (!categoriaFinal) categoriaFinal = detectarCategoria(tituloFinal);
      const dh = resolverDataHora(intent.data, intent.hora);
      return await criarEvento(tituloFinal, dh, intent.duracao_minutos || 60, categoriaFinal);
    }

    // CRIAR LOTE
    if (intent.acao === 'criar_lote' && intent.eventos?.length > 0) {
      // 2+ eventos: pede confirmação antes de criar
      if (intent.eventos.length >= 2) {
        const dataRef = resolverDataHora(intent.eventos[0].data, intent.eventos[0].hora);
        const diaFmt = dataRef.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        let resp = `📅 <b>Vou criar ${intent.eventos.length} eventos — ${diaFmt}:</b>\n\n`;
        const ordenados = [...intent.eventos]
          .map(ev => ({ ...ev, _titulo: adicionarEmoji(ev.titulo || 'Evento') }))
          .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
        ordenados.forEach(ev => {
          resp += `⏰ <b>${ev.hora}</b> — ${ev._titulo} (${ev.duracao_minutos || 60}min)\n`;
        });
        resp += `\n<b>Confirma?</b> Responda "sim" ou "não".`;
        await salvarAcaoPendente(chatId, {
          tipo: 'criar_lote',
          params: { eventos: intent.eventos },
        });
        return resp;
      }
      // 1 evento só em lote: cria direto
      return await executarCriarLote(intent.eventos);
    }

    // CRIAR RECORRENTE — guard com mensagem rica mostrando cap explícito
    if (intent.acao === 'criar_recorrente') {
      if (!intent.hora) return '📅 Que horas? (ex: 13:00)';
      if (!intent.frequencia) return '📅 Com que frequência? (todos os dias / toda semana / todo mês)';
      const { CATEGORIAS, construirRRULE, CAP_PADRAO_RECORRENCIA } = require('../integrations/calendar');
      const tituloFinal = adicionarEmoji(intent.titulo || 'Evento');
      const categoria = intent.calendario || categorizarEvento(tituloFinal);
      let rrule;
      try {
        rrule = construirRRULE({
          frequencia: intent.frequencia,
          dias_semana: intent.dias_semana,
          ate_data: intent.ate_data,
          contagem: intent.contagem,
          intervalo: intent.intervalo || 1,
        });
      } catch (e) { return `❌ Erro na recorrência: ${e.message}`; }
      const capInfo = intent.contagem
        ? `${intent.contagem} ocorrências`
        : intent.ate_data
          ? `até ${intent.ate_data}`
          : `${CAP_PADRAO_RECORRENCIA[intent.frequencia]} ocorrências (cap padrão)`;
      const freqLabel = { daily: 'Diariamente', weekly: 'Semanalmente', monthly: 'Mensalmente' }[intent.frequencia];
      const diasLabel = intent.dias_semana?.length ? ` (${intent.dias_semana.join(',')})` : '';
      const config = CATEGORIAS[categoria] || CATEGORIAS['Trabalho'] || { emoji: '💼' };
      const data_inicio = intent.data_inicio || intent.data || 'hoje';
      await salvarAcaoPendente(chatId, {
        tipo: 'criar_recorrente',
        params: { titulo: tituloFinal, hora: intent.hora, duracao_minutos: intent.duracao_minutos || 60, categoria, data_inicio, rrule },
      });
      return `🔁 <b>Vou criar "${tituloFinal}" como recorrente:</b>\n\n📅 ${freqLabel}${diasLabel} às ${intent.hora}\n⏱️ ${intent.duracao_minutos || 60}min cada\n🔢 Cap: ${capInfo}\n📂 Calendário: ${config.emoji} ${categoria}\n📅 Início: ${data_inicio}\n\n<b>Confirma?</b> Responda "sim" ou "não".`;
    }

    // REAGENDAR — pede confirmação
    if (intent.acao === 'reagendar') {
      if (!intent.evento_original) return '📅 Qual evento quer reagendar?';
      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>". Como está salvo na agenda?`;
      const ev = eventos[0];
      const quandoAtual = formatarQuandoEvento(ev);
      const novoQuando = `${intent.nova_data || intent.data || 'hoje'}${intent.nova_hora ? ' às ' + intent.nova_hora : ''}`;
      await salvarAcaoPendente(chatId, {
        tipo: 'reagendar',
        params: {
          evento_original: intent.evento_original,
          nova_data: intent.nova_data,
          data: intent.data,
          nova_hora: intent.nova_hora,
        },
      });
      return `🔄 <b>Confirma mover "${ev.summary}"${quandoAtual ? ' de' + quandoAtual : ''} para ${novoQuando}?</b>\nResponda "sim" ou "não".`;
    }

    // CANCELAR — pede confirmação (ou seleção se múltiplos)
    if (intent.acao === 'cancelar') {
      if (!intent.evento_original) return '🗑️ Qual evento quer cancelar?';
      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>".`;

      // Múltiplos: salva IDs e pede seleção (número ou por dia)
      if (eventos.length > 1) {
        const diasAbrev = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const lista = eventos.slice(0, 5).map((ev, i) => {
          const start = new Date(ev.start?.dateTime || ev.start?.date);
          const dia = diasAbrev[start.getDay()];
          const hora = ev.start?.dateTime
            ? start.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone: 'America/Sao_Paulo' })
            : '';
          return `${i+1}️⃣ ${ev.summary} — ${dia} ${hora}`.trim();
        }).join('\n');
        await salvarAcaoPendente(chatId, {
          tipo: 'cancelar_selecao',
          params: {
            eventos: eventos.slice(0, 5).map(ev => ({
              id: ev.id,
              calendarId: ev._calendarId,
              summary: ev.summary,
              startISO: ev.start?.dateTime || ev.start?.date,
            })),
          },
        });
        const n = Math.min(eventos.length, 5);
        return `Encontrei ${eventos.length} eventos. Qual cancelar?\n\n${lista}\n\nManda o número (1-${n}) ou "o de hoje".`;
      }

      // 1 evento: caminho original (confirma e executa via executarAcaoConfirmada)
      const ev = eventos[0];
      const quando = formatarQuandoEvento(ev);
      await salvarAcaoPendente(chatId, {
        tipo: 'cancelar',
        params: { evento_original: intent.evento_original },
      });
      return `🗑️ <b>Confirma cancelar "${ev.summary}"${quando}?</b>\nResponda "sim" ou "não".`;
    }

    // MUDAR CALENDÁRIO — pede confirmação
    if (intent.acao === 'mudar_calendario') {
      if (!intent.evento_original) return '📅 Qual evento quer mover de calendário?';
      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>".`;
      const ev = eventos[0];
      const { CATEGORIAS } = require('../integrations/calendar');
      const novaCategoria = intent.calendario || 'Trabalho';
      const config = CATEGORIAS[novaCategoria] || CATEGORIAS['Trabalho'] || { cor: '9', emoji: '💼' };
      const calOrigem = ev._calendarId || ev.organizer?.email || 'primary';
      await salvarAcaoPendente(chatId, {
        tipo: 'mudar_calendario',
        params: { eventId: ev.id, summary: ev.summary, calOrigem, novaCategoria },
      });
      return `🎨 <b>Confirma mover "${ev.summary}" para o calendário ${config.emoji} ${novaCategoria}?</b>\nResponda "sim" ou "não".`;
    }

    // REORGANIZAR
    if (intent.acao === 'reorganizar') {
      const agenda = await listarEventosHoje();
      return agenda + '\n\n💡 <b>O que quer ajustar?</b> Pode me dizer em linguagem livre — "empurra o almoço", "encaixa o psicólogo às 13h", etc.';
    }

    return null;

  } catch(e) {
    // Bug #11+#13: null é reservado pra "não é calendar" (path intencional).
    // Erro de infra propaga — catch-all do brain.js diferencia o tipo e responde direto.
    const { CalendarOperationError, CalendarInsertError } = require('../integrations/calendar');
    console.error('[CalendarBrain] Erro:', { name: e.name, message: e.message, type: e?.error?.type, status: e?.status, stack: e.stack });
    if (e instanceof CalendarInsertError || e instanceof CalendarOperationError) throw e;
    // Bug J: erros Anthropic SDK sobem intactos pra classifyBrainError detectar
    // invalid_request_error / overloaded_error / rate_limit_error / authentication_error.
    // Wrapper só é aplicado em erros sem assinatura Anthropic (googleapis, internos).
    if (e?.error?.type) throw e;
    throw new CalendarOperationError(`Falha em processarCalendar: ${e.message}`, e);
  }
};

module.exports = { processarCalendar, dicaIntent, resolverDataHora, preClassificarConsulta, extrairTermoConsulta, detectarPeriodo, classificarPorJanela, temSinalCalendar, sinalCalendarGuard, deveRebaixarPosOpus, RE_FATO_PASSADO, RE_FATO_PASSADO_POSITIVO, RE_VERBO_IMPERATIVO_CALENDAR, REGEX_HORARIO_TEXTO };
