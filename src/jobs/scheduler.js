// BACKLOG Bug #16: 7 crons existentes usam 'America/Bahia', novo cron noturno
// usa 'America/Sao_Paulo' (pós-Bug #5). Alinhar todos pra Sao_Paulo em sessão futura.
const cron = require('node-cron');
const { listarEventosHoje, listarEventosSemana, proximoHorarioLivre, getAuthClient, buscarEventosTodos } = require('../integrations/calendar');
const { buscarMemorias, buscarHistoricoRecente, listarTarefas, salvarMemoria } = require('../services/memorySupabase');
const { getFaseLunarLocal, getContextoAstrologico } = require('../integrations/astrology');
const { getContextoAyurveda, getContextoAyurvedico, getMensagemAyurvedica } = require('../modules/ayurveda');
const { buscarAniversariosProximos } = require('../services/crm');
const { gerarRelatorioSemanal, gerarRelatorioMensal } = require('../services/analytics');
const { aplicarDecaimentoGlobal, proporHipotese, hipotesesParaPrompt, buscarAprendizadosNaoNotificados, marcarComoNotificadas } = require('../services/hipoteses');
const { analisarNoturno, buscarHumor3dias } = require('../services/analiseNoturna');
const { proporSugestao } = require('../services/sugestoes');
const { snapshotMatinal } = require('../services/oura');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('../prompts/system');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { sendTelegramMessage, enviarMensagemLonga } = require('../services/telegram');
const CAROL_CHAT_ID = process.env.TELEGRAM_CHAT_ID_CAROL;

// ─── GERADOR DE MENSAGEM PROATIVA ────────────────────────────────────────────

const gerarMensagemProativa = async (contexto) => {
  const userPrompt = `Você está enviando uma mensagem PROATIVA pra Carol no Telegram (não é resposta a pergunta dela).

TIPO: ${contexto.tipo}
CONTEXTO: ${JSON.stringify(contexto.dados)}

FONTES (CRÍTICO — não inventar):
- oura_corpo (DADOS BIOMÉTRICOS REAIS DO ANEL OURA, PRIORIDADE ABSOLUTA quando presente): contém sono (score, total_sleep_min, deep_sleep_min, rem_sleep_min, efficiency), readiness (score, temperature_deviation_c, hrv_balance, resting_heart_rate), atividade (steps, score), stress (stress_high_seconds, day_summary), workouts (array de atividades detectadas). Trate como observação primária do corpo da Carol HOJE. Use os números literalmente quando relevantes (ex: "dormiu 6h13, score 62, temperatura +0.3°C do baseline"). Ancore a observação inicial neles antes de qualquer outra fonte. Se ausente ou null, PULE esta fonte sem mencionar. NUNCA invente leituras que não estão literalmente nos dados.
- FACTUAIS (verdade se presentes, NÃO invente se vazias): agenda_do_dia, aniversarios_proximos, humor_3_dias. Só mencione o que está literalmente nestas chaves.
- tarefas_pendentes: são reais (vêm do Supabase) mas NÃO são agenda — trate como "fazer se der tempo", nunca como compromissos do dia.
- CONTEXTUAIS (pano de fundo, NÃO são agenda): memorias_relevantes, hipoteses_ativas. Use como observação ou cor, nunca como compromisso de hoje.
- aprendizados_recentes: hipóteses recém-validadas sobre a Carol. Se o array tiver itens, INCLUA no briefing UM bloco destacado com marcador 🧠, no formato exato: "🧠 Algo que aprendi com certeza sobre você: [texto da hipótese de maior confiança]". Use só o primeiro item do array. Máximo 1 bloco por briefing. Se o array estiver vazio, não mencione nada.
- Tipo "checkin_tarde": é check-in de meio do dia, hora específica no contexto. Tom Registro A (seca-poética) ou C (editorial-observadora), NUNCA maternal. Se há eventos_passados, pergunte factualmente sobre eles ("você tinha X, como foi?"). Se tarefas_pendentes tem itens, mencione uma específica sem cobrar. Se evento_proximo_30min não for null, seja breve (vai interromper). Se tudo vazio, só marque o momento ("tarde começando") sem forçar conversa.
- Se agenda_do_dia estiver vazia ou ausente, diga literalmente "agenda livre hoje" ou similar. NÃO mencione exercício, estudo, reunião ou outros compromissos a menos que estejam em agenda_do_dia.

Regras desta mensagem:
- Use HTML do Telegram: <b>negrito</b>, <i>itálico</i>
- Máximo 20 linhas
- Modula o registro (A/B/C) conforme o momento exige — não force pergunta no final se a mensagem pede silêncio.

Gere APENAS a mensagem, sem explicações.`;

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return resp.content[0].text;
};

// ─── JOB 1: BRIEFING MATINAL — todo dia às 7h ────────────────────────────────

const jobBriefingMatinal = async () => {
  try {
    const agora = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const agenda = await listarEventosHoje();
    const agendaLimpa = agenda.replace(/<[^>]*>/g, '');
    const lua = getFaseLunarLocal(agora);
    const ayurveda = getContextoAyurveda();
    const tarefas = await listarTarefas('aberta');

    const humorRecente = await buscarHumor3dias();
    const aniversariosRaw = await buscarAniversariosProximos(7);
    const aniversarios = aniversariosRaw.map(p => {
      const hoje = new Date(agora.toISOString().slice(0, 10));
      const aniv = new Date(p.aniversario);
      aniv.setFullYear(hoje.getFullYear());
      if (aniv < hoje) aniv.setFullYear(hoje.getFullYear() + 1);
      const dias = Math.round((aniv - hoje) / 86400000);
      return { nome: p.nome, dias_ate: dias, relacionamento: p.relacionamento || null };
    });
    const hipoteses = await hipotesesParaPrompt(5);
    const aprendizadosRecentes = await buscarAprendizadosNaoNotificados(3);

    // Oura: dados biometricos reais (corpo factual)
    const ouraCorpo = await snapshotMatinal().catch(e => {
      console.log('🟡 [Briefing] Oura snapshot falhou:', e.message);
      return null;
    });

    const numEventos = (agendaLimpa.match(/⏰/g) || []).length;
    const agendaPesada = numEventos > 4;

    const ayurvedaMsg = getMensagemAyurvedica(agora);

    const msg = await gerarMensagemProativa({
      tipo: 'briefing_matinal',
      dados: {
        dia: diasSemana[agora.getDay()],
        data: agora.toLocaleDateString('pt-BR'),
        agenda: agendaLimpa,
        num_eventos: numEventos,
        agenda_pesada: agendaPesada,
        lua: `${lua.emoji} ${lua.mensagem_tdah}`,
        energia_lua: lua.energia,
        horario_ayurveda: `${ayurveda.bloco.nome} — ${ayurveda.estrategia.energia}`,
        mensagem_ayurveda: ayurvedaMsg.replace(/<[^>]*>/g, ''),
        alerta_tdah: ayurveda.estrategia.alerta_tdah,
        tarefas_pendentes: tarefas.slice(0, 3).map(t => t.titulo),
        humor_3_dias: humorRecente,
        aniversarios_proximos: aniversarios,
        hipoteses_ativas: hipoteses,
        aprendizados_recentes: aprendizadosRecentes,
        oura_corpo: ouraCorpo,
        sugestao: agendaPesada ? 'Sugerir deixar agenda mais leve' : 'Encorajar o dia'
      }
    });

    await enviarMensagemLonga(CAROL_CHAT_ID, msg);
    if (aprendizadosRecentes.length > 0 && msg.includes('🧠')) {
      await marcarComoNotificadas(aprendizadosRecentes.map(h => h.id));
      console.log(`[Scheduler] 🧠 ${aprendizadosRecentes.length} aprendizado(s) marcado(s)`);
    }
    await salvarMemoria('sistema', 'ultimo_briefing', agora.toISOString(), 'cron job matinal');
    console.log('[Scheduler] ✅ Briefing matinal enviado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro briefing matinal:', e.message);
  }
};

// ─── JOB 1.5: CHECK-IN TARDE — 12h, 15h, 18h ────────────────────────────────

const jobCheckinTarde = async (hora) => {
  try {
    const agora = new Date();
    const inicioDia = new Date(agora); inicioDia.setHours(0,0,0,0);
    const eventos = await buscarEventosTodos(inicioDia, agora);
    const eventosPassados = eventos
      .filter(e => e.start?.dateTime)
      .map(e => ({
        titulo: e.summary,
        hora: new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      }));

    const em30min = new Date(agora.getTime() + 30 * 60000);
    const proximos = await buscarEventosTodos(agora, em30min);
    const eventoProximo30min = proximos[0]?.start?.dateTime
      ? { titulo: proximos[0].summary, hora: new Date(proximos[0].start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }
      : null;

    const tarefas = await listarTarefas('aberta');
    const humor3d = await buscarHumor3dias();
    const hojeISO = agora.toISOString().slice(0, 10);
    const humorHoje = humor3d
      ? (humor3d.split('\n').filter(l => l.startsWith(hojeISO)).join('\n') || null)
      : null;

    const msg = await gerarMensagemProativa({
      tipo: 'checkin_tarde',
      dados: {
        hora,
        eventos_passados: eventosPassados,
        tarefas_pendentes: tarefas.slice(0, 3).map(t => t.titulo),
        humor_hoje: humorHoje,
        evento_proximo_30min: eventoProximo30min,
      }
    });
    await enviarMensagemLonga(CAROL_CHAT_ID, msg);
    await salvarMemoria('sistema', `ultimo_checkin_${hora}h`, agora.toISOString(), `cron checkin tarde ${hora}h`);
    console.log(`[Scheduler] ✅ Check-in tarde ${hora}h enviado`);
  } catch(e) {
    console.error(`[Scheduler] ❌ Erro check-in tarde ${hora}h:`, e.message);
  }
};

// ─── JOB 2: LEMBRETES PRÉ-EVENTO — checa a cada 5min ────────────────────────

const jobPreEvento = async () => {
  try {
    const agora = new Date();
    const em30min = new Date(agora.getTime() + 30 * 60000);
    const em31min = new Date(agora.getTime() + 31 * 60000);

    const { google } = require('googleapis');
    const cal = google.calendar({ version: 'v3', auth: getAuthClient() });

    // Busca em todos os calendários
    const calIds = (process.env.GOOGLE_CALENDAR_IDS || 'primary').split(',');

    for (const calId of calIds) {
      try {
        const res = await cal.events.list({
          calendarId: calId.trim(),
          timeMin: em30min.toISOString(),
          timeMax: em31min.toISOString(),
          singleEvents: true,
        });

        const eventos = (res.data.items || []).filter(e =>
          !e.summary?.includes('Buffer') &&
          !e.summary?.includes('🌿') &&
          !e.summary?.includes('🚗')
        );

        for (const evento of eventos) {
          const hora = new Date(evento.start.dateTime).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
          const msg = await gerarMensagemProativa({
            tipo: 'pre_evento',
            dados: {
              evento: evento.summary,
              hora: hora,
              em_minutos: 30,
              local: evento.location || 'não especificado'
            }
          });
          await sendTelegramMessage(CAROL_CHAT_ID, msg);
          console.log(`[Scheduler] ✅ Lembrete pré-evento: ${evento.summary}`);
        }
      } catch(e) {
        // Silencia erro de calendário individual
      }
    }
  } catch(e) {
    console.error('[Scheduler] ❌ Erro pré-evento:', e.message);
  }
};

// ─── JOB 3: RESUMO NOTURNO — todo dia às 22h ─────────────────────────────────

const jobResumoNoturno = async () => {
  try {
    const historico = await buscarHistoricoRecente(16);
    const tarefasPendentes = await listarTarefas('aberta');
    const agenda = await listarEventosHoje();
    const agendaLimpa = agenda.replace(/<[^>]*>/g, '');

    const mensagensHoje = historico.filter(h => h.role === 'user').length;
    const humoresHoje = historico.filter(h => h.humor).map(h => h.humor);

    const msg = await gerarMensagemProativa({
      tipo: 'resumo_noturno',
      dados: {
        agenda_do_dia: agendaLimpa,
        tarefas_pendentes: tarefasPendentes.slice(0, 5).map(t => t.titulo),
        num_interacoes: mensagensHoje,
        humores_detectados: humoresHoje,
        hora: '22h',
        sugestao: 'Celebrar vitórias do dia, preparar amanhã'
      }
    });

    await sendTelegramMessage(CAROL_CHAT_ID, msg);
    await salvarMemoria('sistema', 'ultimo_resumo_noturno', new Date().toISOString(), 'cron job noturno');
    console.log('[Scheduler] ✅ Resumo noturno enviado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro resumo noturno:', e.message);
  }
};

// ─── JOB 4: PLANEJAMENTO SEMANAL — domingo às 18h ────────────────────────────

const jobPlanejamentoSemanal = async () => {
  try {
    const semana = await listarEventosSemana();
    const semanaLimpa = semana.replace(/<[^>]*>/g, '');
    const tarefas = await listarTarefas('aberta');
    const lua = getFaseLunarLocal(new Date());

    const msg = await gerarMensagemProativa({
      tipo: 'planejamento_semanal',
      dados: {
        proxima_semana: semanaLimpa,
        tarefas_pendentes: tarefas.map(t => t.titulo),
        lua: `${lua.emoji} ${lua.mensagem_tdah}`,
        energia_lua: lua.energia,
        sugestao: 'Planejar a semana com leveza, Rule of 3 por dia'
      }
    });

    await sendTelegramMessage(CAROL_CHAT_ID, msg);
    await salvarMemoria('sistema', 'ultimo_planejamento_semanal', new Date().toISOString(), 'cron job semanal');
    console.log('[Scheduler] ✅ Planejamento semanal enviado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro planejamento semanal:', e.message);
  }
};

// ─── JOB 5: ANIVERSÁRIOS — todo dia às 8h ───────────────────────────────────

const jobAniversarios = async () => {
  try {
    const aniversarios = await buscarAniversariosProximos(2);
    for (const p of aniversarios) {
      const aniv = new Date(p.aniversario);
      const hoje = new Date();
      const proxAniv = new Date(hoje.getFullYear(), aniv.getMonth(), aniv.getDate());
      const diff = Math.round((proxAniv - hoje) / (1000 * 60 * 60 * 24));

      let msg = '';
      if (diff === 0) {
        msg = `🎂 <b>Hoje é aniversário de ${p.nome}!</b>\n\nQuer enviar uma mensagem? 💙`;
      } else if (diff === 1) {
        msg = `🎂 <b>Amanhã é aniversário de ${p.nome}!</b>\n\nQuer que eu te lembre de parabenizar? 💙`;
      } else if (diff === 2) {
        msg = `🎂 <b>Em 2 dias é aniversário de ${p.nome}!</b>\n\nQuer que eu te lembre de parabenizar? 💙`;
      }

      if (msg) await sendTelegramMessage(CAROL_CHAT_ID, msg);
    }
    console.log('[Scheduler] ✅ Job aniversários executado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro aniversários:', e.message);
  }
};

// ─── JOB 6: RELATÓRIO SEMANAL — domingo às 17h ──────────────────────────────

const jobRelatorioSemanal = async () => {
  try {
    const relatorio = await gerarRelatorioSemanal();
    await sendTelegramMessage(CAROL_CHAT_ID, '📊 <b>Seu relatório semanal chegou!</b>\n\n' + relatorio);
    console.log('[Scheduler] ✅ Relatório semanal enviado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro relatório semanal:', e.message);
  }
};

// ─── JOB 7: RELATÓRIO MENSAL — dia 1 às 9h ──────────────────────────────────

const jobRelatorioMensal = async () => {
  try {
    const relatorio = await gerarRelatorioMensal();
    await sendTelegramMessage(CAROL_CHAT_ID, '📈 <b>Seu relatório mensal chegou!</b>\n\n' + relatorio);
    console.log('[Scheduler] ✅ Relatório mensal enviado');
  } catch(e) {
    console.error('[Scheduler] ❌ Erro relatório mensal:', e.message);
  }
};

// ─── JOB 8: ANÁLISE NOTURNA (memória evolutiva) — todo dia às 2h ────────────

const jobAnaliseNoturna = async () => {
  console.log('🌙 [Cron noturno] Iniciando análise...');
  try {
    const decaimento = await aplicarDecaimentoGlobal();
    console.log(`🌙 Decaimento aplicado em ${decaimento} hipóteses`);
    const resultado = await analisarNoturno();
    console.log(`🌙 Análise gerou ${resultado.hipoteses_novas.length} hipóteses novas`);
    for (const h of resultado.hipoteses_novas) {
      await proporHipotese({
        texto: h.texto, fonte: 'cron_noturno',
        tags: h.tags || [], contexto: 'analise_noturna_02h',
      });
    }
    const sugestoesGeradas = resultado?.sugestoes_arquiteturais || [];
    if (sugestoesGeradas.length > 0) {
      for (const s of sugestoesGeradas) {
        try {
          await proporSugestao({
            titulo: s.titulo,
            descricao: s.descricao,
            categoria: s.categoria,
            prioridade: s.prioridade || 3,
            confianca: s.confianca || 0.5,
            origem: 'cron_noturno',
            contexto: { data_noite: new Date().toISOString() }
          });
        } catch (err) {
          console.error('[Scheduler] Erro ao propor sugestão:', err.message);
        }
      }
      console.log(`[Scheduler] 🔧 ${sugestoesGeradas.length} sugestão(ões) persistida(s)`);
    }
  } catch (e) {
    console.error('🌙 [Cron noturno] Erro:', e.message);
  }
};

// ─── INICIALIZAÇÃO DOS JOBS ───────────────────────────────────────────────────

const iniciarScheduler = () => {
  if (!CAROL_CHAT_ID) {
    console.warn('[Scheduler] ⚠️ TELEGRAM_CHAT_ID_CAROL não configurado — scheduler desativado');
    return;
  }

  // Briefing matinal — todo dia às 7h
  cron.schedule('0 7 * * *', jobBriefingMatinal, { timezone: 'America/Bahia' });

  // Check-ins tarde — 12h, 15h, 18h
  cron.schedule('0 12 * * *', () => jobCheckinTarde(12), { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 15 * * *', () => jobCheckinTarde(15), { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 18 * * *', () => jobCheckinTarde(18), { timezone: 'America/Sao_Paulo' });

  // Pré-evento — checa a cada 5 minutos
  cron.schedule('*/5 * * * *', jobPreEvento, { timezone: 'America/Bahia' });

  // Resumo noturno — todo dia às 22h
  cron.schedule('0 22 * * *', jobResumoNoturno, { timezone: 'America/Bahia' });

  // Planejamento semanal — domingo às 18h
  cron.schedule('0 18 * * 0', jobPlanejamentoSemanal, { timezone: 'America/Bahia' });

  // Aniversários — todo dia às 8h
  cron.schedule('0 8 * * *', jobAniversarios, { timezone: 'America/Bahia' });

  // Relatório semanal — domingo às 17h
  cron.schedule('0 17 * * 0', jobRelatorioSemanal, { timezone: 'America/Bahia' });

  // Relatório mensal — dia 1 de cada mês às 9h
  cron.schedule('0 9 1 * *', jobRelatorioMensal, { timezone: 'America/Bahia' });

  // Memória evolutiva — análise noturna todo dia às 2h (não notifica Carol, só registra hipóteses)
  cron.schedule('0 2 * * *', jobAnaliseNoturna, { timezone: 'America/Sao_Paulo' });

  console.log('[Scheduler] ✅ Jobs ativos:');
  console.log('  🌅 Briefing matinal: todo dia às 7h');
  console.log('  🎂 Aniversários: todo dia às 8h');
  console.log('  ⏰ Pré-evento: a cada 5min');
  console.log('  📊 Relatório semanal: domingo às 17h');
  console.log('  📅 Planejamento semanal: domingo às 18h');
  console.log('  🌙 Resumo noturno: todo dia às 22h');
  console.log('  📈 Relatório mensal: dia 1 às 9h');
  console.log('  🌙 Análise evolutiva (memória): todo dia às 2h');
};

module.exports = {
  iniciarScheduler,
  jobBriefingMatinal,
  jobCheckinTarde,
  jobPreEvento,
  jobResumoNoturno,
  jobPlanejamentoSemanal,
  jobAniversarios,
  jobRelatorioSemanal,
  jobRelatorioMensal,
  jobAnaliseNoturna,
};
