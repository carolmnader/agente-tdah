const { google } = require('googleapis');
require('dotenv').config();

const getAuthClient = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
};

const getCalendar = () => google.calendar({ version: 'v3', auth: getAuthClient() });

const TIMEZONE = 'America/Sao_Paulo';

// Caps automáticos quando recorrência sem fim explícito (UNTIL/COUNT)
// Evita "lixo eterno" no Calendar — Carol revisita trimestralmente.
const CAP_PADRAO_RECORRENCIA = { daily: 90, weekly: 26, monthly: 12 };

function construirRRULE({ frequencia, dias_semana = null, ate_data = null, contagem = null, intervalo = 1 }) {
  if (!CAP_PADRAO_RECORRENCIA[frequencia]) {
    throw new Error(`frequencia inválida: ${frequencia} (esperado daily|weekly|monthly)`);
  }
  const partes = [`FREQ=${frequencia.toUpperCase()}`];
  if (intervalo > 1) partes.push(`INTERVAL=${intervalo}`);
  if (dias_semana?.length) partes.push(`BYDAY=${dias_semana.join(',')}`);
  if (contagem) partes.push(`COUNT=${contagem}`);
  else if (ate_data) {
    const d = new Date(ate_data + 'T23:59:59Z');
    partes.push(`UNTIL=${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
  } else {
    partes.push(`COUNT=${CAP_PADRAO_RECORRENCIA[frequencia]}`);
  }
  return 'RRULE:' + partes.join(';');
}

// Mapa completo: ID → { nome, emoji }
const CALENDARIOS = {
  'carolinamnader@gmail.com': { nome: 'Selfcare', emoji: '💪' },
  'family00049091303636389204@group.calendar.google.com': { nome: 'Estudo', emoji: '📚' },
  'e5b67144a93e3a77a014c71384a8c82b26340c60ae672c08072f9ddf9dd378af@group.calendar.google.com': { nome: 'Eventos', emoji: '🗓️' },
  '8c9682a2bd8cbe9a0e1d9aed14a7ee912673811166b37c75fa7aa8733c984be8@group.calendar.google.com': { nome: 'Trabalho', emoji: '💼' },
  'fktshc4p6sjmtgtml441fgbf70@group.calendar.google.com': { nome: 'Saúde', emoji: '🏥' },
  'qkgtejobe27bbqmh0ei2h356fg@group.calendar.google.com': { nome: 'Lazer', emoji: '🎉' },
  'q5a6uu1jttntqg2auhnrhfgvu0@group.calendar.google.com': { nome: 'Lar/Pets', emoji: '🏠' },
  '7uc3nmon4dmp802ucv7ju0j47k@group.calendar.google.com': { nome: 'Faculdade', emoji: '🎓' },
  'vt76d6q208ieru17ii2jbu6mnk@group.calendar.google.com': { nome: 'Burocracia', emoji: '📋' },
};

const CALENDAR_IDS = Object.keys(CALENDARIOS);

// Mapa reverso: nome → ID
const CALENDARIO_POR_NOME = {
  'Selfcare': 'carolinamnader@gmail.com',
  'Trabalho': '8c9682a2bd8cbe9a0e1d9aed14a7ee912673811166b37c75fa7aa8733c984be8@group.calendar.google.com',
  'Estudo': 'family00049091303636389204@group.calendar.google.com',
  'Eventos': 'e5b67144a93e3a77a014c71384a8c82b26340c60ae672c08072f9ddf9dd378af@group.calendar.google.com',
  'Saúde': 'fktshc4p6sjmtgtml441fgbf70@group.calendar.google.com',
  'Lazer': 'qkgtejobe27bbqmh0ei2h356fg@group.calendar.google.com',
  'Lar/Pets': 'q5a6uu1jttntqg2auhnrhfgvu0@group.calendar.google.com',
  'Faculdade': '7uc3nmon4dmp802ucv7ju0j47k@group.calendar.google.com',
  'Burocracia': 'vt76d6q208ieru17ii2jbu6mnk@group.calendar.google.com',
  'primary': 'carolinamnader@gmail.com',
};

// Calendário padrão para criar eventos
const DEFAULT_CALENDAR = CALENDARIO_POR_NOME['Trabalho'];

function getCalendarioInfo(calendarId) {
  return CALENDARIOS[calendarId] || { nome: 'Outro', emoji: '📅' };
}

function getCalendarId(nome) {
  return CALENDARIO_POR_NOME[nome] || DEFAULT_CALENDAR;
}

// Interpreta data/hora em linguagem natural
const interpretarDataHora = (texto) => {
  const agora = new Date();
  const amanha = new Date(agora); amanha.setDate(agora.getDate() + 1);

  let data = new Date(agora);

  if (/amanh[ãa]/i.test(texto)) data = amanha;
  if (/segunda/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (1 + 7 - agora.getDay()) % 7 || 7); }
  if (/ter[çc]a/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (2 + 7 - agora.getDay()) % 7 || 7); }
  if (/quarta/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (3 + 7 - agora.getDay()) % 7 || 7); }
  if (/quinta/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (4 + 7 - agora.getDay()) % 7 || 7); }
  if (/sexta/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (5 + 7 - agora.getDay()) % 7 || 7); }
  if (/s[áa]bado/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (6 + 7 - agora.getDay()) % 7 || 7); }
  if (/domingo/i.test(texto)) { data = new Date(agora); data.setDate(agora.getDate() + (0 + 7 - agora.getDay()) % 7 || 7); }

  const horaMatch = texto.match(/(\d{1,2})h(\d{2})?|(\d{1,2}):(\d{2})/i);
  if (horaMatch) {
    const hora = parseInt(horaMatch[1] || horaMatch[3]);
    const min = parseInt(horaMatch[2] || horaMatch[4] || 0);
    data.setHours(hora, min, 0, 0);
  }

  const duracaoMatch = texto.match(/(\d+)\s*(hora|h\b|minuto|min)/i);
  let duracao = 60;
  if (duracaoMatch) {
    duracao = parseInt(duracaoMatch[1]);
    if (/hora|h\b/i.test(duracaoMatch[2])) duracao *= 60;
  }

  return { dataHora: data, duracao };
};

const formatarDiaSemana = (data) => {
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  return dias[data.getDay()];
};

const formatarHora = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

// Busca eventos de TODOS os calendários em paralelo
async function buscarEventosTodos(timeMin, timeMax) {
  const cal = getCalendar();
  const promises = CALENDAR_IDS.map(async (calId) => {
    try {
      const res = await cal.events.list({
        calendarId: calId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items || [])
        .filter(e => !e.summary?.includes('Buffer'))
        .map(e => ({ ...e, _calendarId: calId }));
    } catch (err) {
      console.error(`📅 Erro ao buscar cal ${calId}:`, err.message);
      return [];
    }
  });

  const resultados = await Promise.all(promises);
  const todos = resultados.flat();

  // Ordena por horário de início
  todos.sort((a, b) => {
    const da = new Date(a.start.dateTime || a.start.date || 0);
    const db = new Date(b.start.dateTime || b.start.date || 0);
    return da - db;
  });

  return todos;
}

// 1. LISTAR HOJE — todos os calendários
const listarEventosHoje = async () => {
  try {
    const agora = new Date();
    const inicio = new Date(agora); inicio.setHours(0,0,0,0);
    const fim = new Date(agora); fim.setHours(23,59,59,999);

    const eventos = await buscarEventosTodos(inicio, fim);

    if (!eventos.length) return '📅 <b>Agenda de hoje</b>\n\nNenhum evento. Dia livre! 🌿';

    let txt = `📅 <b>Agenda de hoje — ${formatarDiaSemana(agora)}, ${agora.toLocaleDateString('pt-BR')}</b>\n\n`;

    eventos.forEach(ev => {
      const info = getCalendarioInfo(ev._calendarId);
      const h = ev.start.dateTime ? formatarHora(ev.start.dateTime) : 'dia todo';
      txt += `${info.emoji} <b>${h}</b> — ${ev.summary}\n`;
    });

    // Resumo por calendário
    const contagem = {};
    eventos.forEach(ev => {
      const info = getCalendarioInfo(ev._calendarId);
      contagem[info.nome] = (contagem[info.nome] || 0) + 1;
    });
    const resumo = Object.entries(contagem).map(([k,v]) => `${v} ${k}`).join(' · ');

    txt += `\n<i>${eventos.length} evento(s) — ${resumo}</i>`;
    return txt;
  } catch(e) { return `❌ Erro ao acessar agenda: ${e.message}`; }
};

// 2. LISTAR SEMANA — todos os calendários
const listarEventosSemana = async () => {
  try {
    const agora = new Date();
    const fim = new Date(agora); fim.setDate(agora.getDate() + 7);

    const eventos = await buscarEventosTodos(agora, fim);

    if (!eventos.length) return '📅 <b>Próximos 7 dias</b>\n\nNenhum evento programado. 🌿';

    const porDia = {};
    eventos.forEach(ev => {
      const d = new Date(ev.start.dateTime || ev.start.date);
      const chave = d.toLocaleDateString('pt-BR');
      if (!porDia[chave]) porDia[chave] = { label: `${formatarDiaSemana(d)}, ${chave}`, evs: [] };
      porDia[chave].evs.push(ev);
    });

    let txt = '📅 <b>Sua semana</b>\n\n';
    Object.values(porDia).forEach(({ label, evs }) => {
      txt += `<b>${label}</b>\n`;
      evs.forEach(ev => {
        const info = getCalendarioInfo(ev._calendarId);
        const h = ev.start.dateTime ? formatarHora(ev.start.dateTime) : 'dia todo';
        txt += `  ${info.emoji} ${h} — ${ev.summary}\n`;
      });
      txt += '\n';
    });
    return txt;
  } catch(e) { return `❌ Erro: ${e.message}`; }
};

// Categorias com keywords, cores e calendário
// Cores Google Calendar: 1=lavanda, 2=sálvia(verde), 3=uva, 4=flamingo,
// 5=banana(amarelo), 6=tangerina, 7=pavão(verde-água), 8=grafite,
// 9=mirtilo(azul), 10=manjericão(verde-escuro), 11=tomate(vermelho)
const CATEGORIAS = {
  'Saúde': {
    emoji: '🏥', cor: '2',
    keywords: ['médico','médica','dentista','psicólogo','psicologa','psicóloga','terapia','terapeuta','consulta','exame','farmácia','farmacia','nutricionista','fisioterapia','oftalmologista','dermatologista','ginecologista','ortopedista','cardiologista'],
  },
  'Selfcare': {
    emoji: '💪', cor: '10',
    keywords: ['academia','yoga','pilates','treino','exercício','exercicio','meditação','meditacao','skincare','skin care','salão','salao','unhas','make','cabelo','beleza','spa','corrida','alongamento','massagem'],
  },
  'Trabalho': {
    emoji: '💼', cor: '9',
    keywords: ['reunião','reuniao','cliente','call','apresentação','apresentacao','projeto','entrega','deadline','proposta','meeting','daily','standup','sprint'],
  },
  'Eventos': {
    emoji: '🎉', cor: '11',
    keywords: ['festa','casamento','pre-wedding','pre wedding','aniversário','aniversario','formatura','show','balada','evento','celebração','churrasco','almoço','almoco','jantar','brunch','café','cafe','happy hour'],
  },
  'Estudo': {
    emoji: '📚', cor: '5',
    keywords: ['aula','curso','estudo','prova','trabalho escolar','pesquisa','leitura','livro'],
  },
  'Faculdade': {
    emoji: '🎓', cor: '5',
    keywords: ['faculdade','universidade','tcc','seminário','seminario','monografia'],
  },
  'Lazer': {
    emoji: '🎭', cor: '6',
    keywords: ['cinema','passeio','parque','praia','bar','lazer','netflix','série','jogo','viagem','voo','aeroporto'],
  },
  'Lar/Pets': {
    emoji: '🏠', cor: '4',
    keywords: ['casa','pet','cachorro','gato','vet','veterinário','veterinario','faxina','mercado','compras','limpeza','organizar casa'],
  },
  'Burocracia': {
    emoji: '📋', cor: '8',
    keywords: ['banco','cartório','cartorio','imposto','documento','rg','cpf','cnh','seguro','contrato','assinatura','correios'],
  },
};

function detectarCategoria(titulo) {
  const t = titulo.toLowerCase();
  for (const [nome, config] of Object.entries(CATEGORIAS)) {
    if (config.keywords.some(k => t.includes(k))) return nome;
  }
  return 'Trabalho';
}

// Alias para compatibilidade
const detectarCalendario = (titulo) => getCalendarId(detectarCategoria(titulo));

// 3. CRIAR EVENTO — com cor e calendário automáticos
// Bug #6: aceita parâmetro opcional `recurrence` (string RRULE). Se presente,
// adiciona ao payload do evento E PULA criação do buffer (evita N buffers em série).
const criarEvento = async (titulo, dataHoraInicio, duracaoMinutos = 60, categoriaPassada = null, recurrence = null) => {
  try {
    const cal = getCalendar();

    // Resolve categoria: nome passado → detecta pelo título
    let categoria;
    if (categoriaPassada && CALENDARIO_POR_NOME[categoriaPassada]) {
      categoria = categoriaPassada;
    } else if (categoriaPassada && CALENDARIOS[categoriaPassada]) {
      categoria = getCalendarioInfo(categoriaPassada).nome;
    } else {
      categoria = detectarCategoria(titulo);
    }

    const config = CATEGORIAS[categoria] || CATEGORIAS['Trabalho'];
    const calendarId = getCalendarId(categoria);
    const info = getCalendarioInfo(calendarId);
    const inicio = new Date(dataHoraInicio);
    const fim = new Date(inicio.getTime() + duracaoMinutos * 60000);

    // Salva categorização na memória para aprender
    try {
      const { salvarMemoria } = require('../services/memorySupabase');
      await salvarMemoria('categorizacao', titulo.toLowerCase().substring(0, 30), categoria, 'aprendido ao criar');
    } catch(e) { /* silencia se Supabase não disponível */ }

    const eventResource = {
      summary: titulo,
      colorId: config.cor,
      start: { dateTime: inicio.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: fim.toISOString(), timeZone: TIMEZONE }
    };
    if (recurrence) eventResource.recurrence = [recurrence];

    await cal.events.insert({ calendarId, resource: eventResource });

    // Buffer só pra eventos não-recorrentes (evita N buffers em série)
    if (!recurrence) {
      const bufferFim = new Date(fim.getTime() + 20 * 60000);
      await cal.events.insert({ calendarId, resource: {
        summary: '🌿 Buffer / Transição', colorId: '8',
        start: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: bufferFim.toISOString(), timeZone: TIMEZONE }
      }});
    }

    const dia = `${formatarDiaSemana(inicio)}, ${inicio.toLocaleDateString('pt-BR')}`;
    const hora = formatarHora(inicio.toISOString());

    if (recurrence) {
      return `🔁 <b>Recorrência criada!</b>\n\n${info.emoji} ${titulo}\n📅 Início: ${dia} às ${hora}\n⏱️ ${duracaoMinutos}min cada\n🔢 ${recurrence.replace('RRULE:', '')}\n📂 Agenda: ${info.nome}`;
    }
    return `✅ <b>Agendado!</b>\n\n${info.emoji} ${titulo}\n📅 ${dia} às ${hora}\n⏱️ ${duracaoMinutos}min\n🌿 Buffer de 20min reservado\n📂 Agenda: ${info.nome}\n\nQuer ajustar algo?`;
  } catch(e) { return `❌ Erro ao criar evento: ${e.message}`; }
};

// 4. BUSCAR EVENTO POR NOME — em todos os calendários
const buscarEvento = async (termo) => {
  try {
    const cal = getCalendar();
    const agora = new Date();
    const daqui30 = new Date(agora); daqui30.setDate(agora.getDate() + 30);

    const promises = CALENDAR_IDS.map(async (calId) => {
      try {
        const res = await cal.events.list({
          calendarId: calId, q: termo,
          timeMin: agora.toISOString(), timeMax: daqui30.toISOString(),
          singleEvents: true, orderBy: 'startTime'
        });
        return (res.data.items || [])
          .filter(e => !e.summary?.includes('Buffer'))
          .map(e => ({ ...e, _calendarId: calId }));
      } catch { return []; }
    });

    const resultados = await Promise.all(promises);
    return resultados.flat();
  } catch(e) { return []; }
};

// 5. REAGENDAR EVENTO
const reagendarEvento = async (termoBusca, novaDataHoraTexto) => {
  try {
    const cal = getCalendar();
    const eventos = await buscarEvento(termoBusca);

    if (!eventos.length) return `❌ Não encontrei nenhum evento com "<b>${termoBusca}</b>" nos próximos 30 dias.`;

    if (eventos.length > 1) {
      let txt = `Encontrei ${eventos.length} eventos. Qual você quer reagendar?\n\n`;
      eventos.slice(0,5).forEach((ev, i) => {
        const info = getCalendarioInfo(ev._calendarId);
        const h = ev.start.dateTime ? formatarHora(ev.start.dateTime) : '';
        const d = new Date(ev.start.dateTime || ev.start.date);
        txt += `${i+1}️⃣ ${info.emoji} ${ev.summary} — ${formatarDiaSemana(d)} ${h}\n`;
      });
      txt += '\nResponde com o número.';
      return { multiplos: true, texto: txt, eventos };
    }

    const ev = eventos[0];
    const { dataHora } = interpretarDataHora(novaDataHoraTexto);
    const duracaoOriginal = ev.end.dateTime
      ? (new Date(ev.end.dateTime) - new Date(ev.start.dateTime)) / 60000
      : 60;

    const novoFim = new Date(dataHora.getTime() + duracaoOriginal * 60000);

    await cal.events.update({ calendarId: ev._calendarId, eventId: ev.id, resource: {
      ...ev,
      start: { dateTime: dataHora.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: novoFim.toISOString(), timeZone: TIMEZONE }
    }});

    const info = getCalendarioInfo(ev._calendarId);
    const horaAntiga = formatarHora(ev.start.dateTime);
    const diaAntigo = formatarDiaSemana(new Date(ev.start.dateTime));
    const horaNova = formatarHora(dataHora.toISOString());
    const diaNovo = formatarDiaSemana(dataHora);

    return `🔄 <b>Reagendado!</b>\n\n${info.emoji} ${ev.summary}\n📅 Antes: ${diaAntigo} às ${horaAntiga}\n📅 Agora: ${diaNovo} às ${horaNova}`;
  } catch(e) { return `❌ Erro ao reagendar: ${e.message}`; }
};

// 6. CANCELAR EVENTO
const cancelarEvento = async (termoBusca) => {
  try {
    const cal = getCalendar();
    const eventos = await buscarEvento(termoBusca);

    if (!eventos.length) return `❌ Não encontrei nenhum evento com "<b>${termoBusca}</b>".`;

    if (eventos.length > 1) {
      let txt = `Encontrei ${eventos.length} eventos. Qual você quer cancelar?\n\n`;
      eventos.slice(0,5).forEach((ev, i) => {
        const info = getCalendarioInfo(ev._calendarId);
        const h = ev.start.dateTime ? formatarHora(ev.start.dateTime) : '';
        const d = new Date(ev.start.dateTime || ev.start.date);
        txt += `${i+1}️⃣ ${info.emoji} ${ev.summary} — ${formatarDiaSemana(d)} ${h}\n`;
      });
      txt += '\nResponde com o número.';
      return { multiplos: true, texto: txt, eventos };
    }

    const ev = eventos[0];
    await cal.events.delete({ calendarId: ev._calendarId, eventId: ev.id });
    return `🗑️ <b>${ev.summary}</b> removido da agenda.\n\nQuer agendar algo no lugar?`;
  } catch(e) { return `❌ Erro ao cancelar: ${e.message}`; }
};

// 7. PRÓXIMO HORÁRIO LIVRE — considerando todos os calendários
const proximoHorarioLivre = async (duracaoMinutos = 60) => {
  try {
    const agora = new Date();
    const fimDia = new Date(agora); fimDia.setHours(22,0,0,0);

    if (agora >= fimDia) return '😴 Já passou das 22h, Carol. Amanhã a gente planeja. 💜';

    const eventos = await buscarEventosTodos(agora, fimDia);

    const ocupados = eventos
      .filter(e => e.start.dateTime)
      .map(e => ({ inicio: new Date(e.start.dateTime), fim: new Date(e.end.dateTime) }));

    let candidato = new Date(agora);
    candidato.setMinutes(Math.ceil(candidato.getMinutes()/30)*30, 0, 0);

    for (let i = 0; i < 20; i++) {
      const fimCandidato = new Date(candidato.getTime() + duracaoMinutos * 60000);
      const conflito = ocupados.some(b => candidato < b.fim && fimCandidato > b.inicio);
      if (!conflito && fimCandidato <= fimDia) {
        const h1 = formatarHora(candidato.toISOString());
        const h2 = formatarHora(fimCandidato.toISOString());
        return `🕐 Próximo horário livre: <b>${h1} — ${h2}</b> (${duracaoMinutos}min)\n\nQuer que eu agende algo nesse horário?`;
      }
      candidato = new Date(candidato.getTime() + 30 * 60000);
    }
    return '😅 Agenda bem cheia hoje! Quer ver amanhã?';
  } catch(e) { return `❌ Erro: ${e.message}`; }
};

module.exports = { listarEventosHoje, listarEventosSemana, criarEvento, reagendarEvento, cancelarEvento, proximoHorarioLivre, buscarEvento, buscarEventosTodos, interpretarDataHora, getCalendar, getAuthClient, getCalendarId, detectarCalendario, detectarCategoria, CALENDARIOS, CALENDARIO_POR_NOME, CATEGORIAS, construirRRULE, CAP_PADRAO_RECORRENCIA };
