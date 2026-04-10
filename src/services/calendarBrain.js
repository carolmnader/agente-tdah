const Anthropic = require('@anthropic-ai/sdk');
const { listarEventosHoje, listarEventosSemana, criarEvento, reagendarEvento, cancelarEvento, proximoHorarioLivre, buscarEvento, detectarCategoria } = require('../integrations/calendar');
const { buscarMemoriaPorChave } = require('./memorySupabase');

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
  terapia: '🧠', consulta: '🏥', exame: '🏥',
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

const resolverDataHora = (data, hora) => {
  const agora = new Date();
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

const PROMPT_INTENT = `Você é o cérebro de agenda da ARIA, assistente pessoal da Carol com TDAH.

CONTEXTO:
- Agora: {HORA_ATUAL} de {DIA_SEMANA}, {DATA_ATUAL}
- Agenda de hoje: {AGENDA_HOJE}
- Histórico recente: {HISTORICO}
- Apelidos desta sessão: {APELIDOS}

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

EXEMPLOS DE MUDAR CALENDÁRIO:
- "muda categoria para Saúde" → acao: mudar_calendario, calendario: "Saúde", evento_original: último evento mencionado
- "coloca no Trabalho" → acao: mudar_calendario, calendario: "Trabalho"
- "psicólogo às 14h" → acao: criar, calendario: "Saúde", hora: "14:00" (NÃO é mudar_calendario)

RETORNE APENAS JSON:
{
  "acao": "ver_hoje|ver_semana|criar|criar_lote|reagendar|cancelar|horario_livre|reorganizar|mudar_calendario|nao_e_calendar",
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
  "apelido_aprendido": {"termo":"string","evento_real":"string"}|null,
  "raciocinio": "explicação em 1 linha"
}`;

const processarCalendar = async (mensagem, historico = []) => {
  try {
    const mem = global.ariaMemoria;

    // Resolve conflitos pendentes
    const msgL = mensagem.toLowerCase();
    if (mem.conflitosCalendarPendentes?.length > 0) {
      if (/substitui|sim|pode|cancela os|remove os|troca/.test(msgL)) {
        const conflitos = mem.conflitosCalendarPendentes;
        mem.conflitosCalendarPendentes = null;
        let resp = '🔄 <b>Substituindo conflitos...</b>\n\n';
        for (const c of conflitos) {
          try {
            await cancelarEvento(c.existente);
            const dh = resolverDataHora(c.novo.data, c.novo.hora);
            const tituloComEmoji = adicionarEmoji(c.novo.titulo);
            await criarEvento(tituloComEmoji, dh, c.novo.duracao_minutos || 60, c.novo.calendario || categorizarEvento(tituloComEmoji));
            resp += `✅ ${tituloComEmoji} às ${c.novo.hora}\n`;
          } catch(e) { resp += `❌ Erro: ${c.novo.titulo}\n`; }
        }
        return resp;
      }
      if (/pula|ignora|só os livres|sem conflito|mantém/.test(msgL)) {
        mem.conflitosCalendarPendentes = null;
        return '✅ Ok! Mantive só os eventos sem conflito.';
      }
    }

    // Busca agenda para contexto
    let agendaHoje = '';
    try {
      agendaHoje = (await listarEventosHoje()).replace(/<[^>]*>/g, '');
    } catch(e) { agendaHoje = 'indisponível'; }

    const agora = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const historicoTexto = historico.slice(-8)
      .map(m => `${m.role === 'user' ? 'Carol' : 'ARIA'}: ${m.content?.substring(0, 120)}`)
      .join('\n');

    const prompt = PROMPT_INTENT
      .replace('{HORA_ATUAL}', agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))
      .replace('{DIA_SEMANA}', diasSemana[agora.getDay()])
      .replace('{DATA_ATUAL}', agora.toLocaleDateString('pt-BR'))
      .replace('{AGENDA_HOJE}', agendaHoje || 'vazia')
      .replace('{HISTORICO}', historicoTexto || 'início da conversa')
      .replace('{APELIDOS}', JSON.stringify(mem.apelidos))
      .replace('{MENSAGEM}', mensagem);

    const respIA = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const texto = respIA.content[0].text.trim().replace(/```json|```/g,'').trim();
    const intent = JSON.parse(texto);

    console.log(`📅 [CalendarBrain] Ação: ${intent.acao} | Título: ${intent.titulo || '-'} | Raciocínio: ${intent.raciocinio || '-'}`);

    // Aprende apelido
    if (intent.apelido_aprendido) {
      mem.apelidos[intent.apelido_aprendido.termo.toLowerCase()] = intent.apelido_aprendido.evento_real;
    }

    if (intent.acao === 'nao_e_calendar') return null;

    // VER
    if (intent.acao === 'ver_hoje') return await listarEventosHoje();
    if (intent.acao === 'ver_semana') return await listarEventosSemana();
    if (intent.acao === 'horario_livre') return await proximoHorarioLivre(intent.duracao_minutos || 60);

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
      const criados = [], conflitos = [];

      await Promise.all(intent.eventos.map(async (ev) => {
        try {
          const tituloFinal = adicionarEmoji(ev.titulo || 'Evento');
          const dh = resolverDataHora(ev.data, ev.hora);
          const fim = new Date(dh.getTime() + (ev.duracao_minutos || 60) * 60000);

          // Checa conflito
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
            conflitos.push({ novo: {...ev, titulo: tituloFinal, calendario: evCal}, existente: ocupados[0].summary });
          } else {
            await criarEvento(tituloFinal, dh, ev.duracao_minutos || 60, evCal);
            criados.push({...ev, titulo: tituloFinal});
          }
        } catch(e) {
          const tituloFinal = adicionarEmoji(ev.titulo || 'Evento');
          const evCal = ev.calendario || categorizarEvento(tituloFinal);
          const dh = resolverDataHora(ev.data, ev.hora);
          await criarEvento(tituloFinal, dh, ev.duracao_minutos || 60, evCal);
          criados.push({...ev, titulo: tituloFinal});
        }
      }));

      let resp = '';
      if (criados.length > 0) {
        const dataRef = resolverDataHora(criados[0].data, criados[0].hora);
        const diaFmt = dataRef.toLocaleDateString('pt-BR', {weekday:'long',day:'numeric',month:'long'});
        resp += `📅 <b>${criados.length} evento(s) criados — ${diaFmt}:</b>\n\n`;
        const ordenados = [...criados].sort((a,b) => (a.hora || '').localeCompare(b.hora || ''));
        ordenados.forEach(ev => {
          resp += `⏰ <b>${ev.hora}</b> — ${ev.titulo} (${ev.duracao_minutos || 60}min)\n`;
        });
        resp += `\n🌿 Buffers de 20min adicionados entre compromissos`;
      }

      if (conflitos.length > 0) {
        mem.conflitosCalendarPendentes = conflitos;
        resp += `\n\n⚠️ <b>${conflitos.length} conflito(s) detectado(s):</b>\n`;
        conflitos.forEach(c => {
          resp += `🔴 "${c.novo.titulo}" conflita com "<b>${c.existente}</b>"\n`;
        });
        resp += `\nO que prefere?\n▸ <b>"substitui"</b> — remove os antigos e cria os novos\n▸ <b>"pula os conflitos"</b> — mantém os já criados`;
      }

      return resp || '❌ Não consegui criar os eventos.';
    }

    // REAGENDAR
    if (intent.acao === 'reagendar') {
      if (!intent.evento_original) return '📅 Qual evento quer reagendar?';
      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>". Como está salvo na agenda?`;
      const novoHorario = `${intent.nova_data || intent.data || 'hoje'} às ${intent.nova_hora || ''}`;
      return await reagendarEvento(intent.evento_original, novoHorario);
    }

    // CANCELAR
    if (intent.acao === 'cancelar') {
      if (!intent.evento_original) return '🗑️ Qual evento quer cancelar?';
      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>".`;
      return await cancelarEvento(intent.evento_original);
    }

    // MUDAR CALENDÁRIO — patch colorId sem mover horário
    if (intent.acao === 'mudar_calendario') {
      if (!intent.evento_original) return '📅 Qual evento quer mover de calendário?';

      const eventos = await buscarComSinonimos(intent.evento_original, intent.sinonimos_busca || []);
      if (!eventos.length) return `❌ Não encontrei "<b>${intent.evento_original}</b>".`;

      const ev = eventos[0];
      const { CATEGORIAS } = require('../integrations/calendar');
      const novaCategoria = intent.calendario || 'Trabalho';
      const config = CATEGORIAS[novaCategoria] || CATEGORIAS['Trabalho'] || { cor: '9', emoji: '💼' };

      try {
        const { google } = require('googleapis');
        const { getAuthClient } = require('../integrations/calendar');
        const cal = google.calendar({ version: 'v3', auth: getAuthClient() });

        const calOrigem = ev._calendarId || ev.organizer?.email || 'primary';

        await cal.events.patch({
          calendarId: calOrigem,
          eventId: ev.id,
          resource: { colorId: config.cor },
        });

        return `✅ <b>${ev.summary}</b> agora está em ${config.emoji} <b>${novaCategoria}</b>`;
      } catch(e) {
        console.error('[CalendarBrain] Erro ao mudar categoria:', e.message);
        return `❌ Erro ao mudar categoria: ${e.message}`;
      }
    }

    // REORGANIZAR
    if (intent.acao === 'reorganizar') {
      const agenda = await listarEventosHoje();
      return agenda + '\n\n💡 <b>O que quer ajustar?</b> Pode me dizer em linguagem livre — "empurra o almoço", "encaixa o psicólogo às 13h", etc.';
    }

    return null;

  } catch(e) {
    console.error('[CalendarBrain] Erro:', e.message);
    return null;
  }
};

module.exports = { processarCalendar };
