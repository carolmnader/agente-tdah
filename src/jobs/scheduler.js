// BACKLOG Bug #16: 7 crons existentes usam 'America/Bahia', novo cron noturno
// usa 'America/Sao_Paulo' (pós-Bug #5). Alinhar todos pra Sao_Paulo em sessão futura.
const cron = require('node-cron');
const { listarEventosHoje, listarEventosSemana, proximoHorarioLivre, getAuthClient, buscarEventosTodos, getCalendarioInfo } = require('../integrations/calendar');
const { buscarMemorias, buscarHistoricoRecente, listarTarefas, salvarMemoria, buscarHumorRecente, salvarMemoriaComHistorico } = require('../services/memorySupabase');
const { planejarUpsertFeedback } = require('../services/feedbackReincidente');
const { getFaseLunarLocal, getContextoAstrologico } = require('../integrations/astrology');
const { getContextoAyurveda, getContextoAyurvedico, getMensagemAyurvedica } = require('../modules/ayurveda');
const { buscarAniversariosProximos } = require('../services/crm');
const { gerarRelatorioSemanal, gerarRelatorioMensal } = require('../services/analytics');
const { aplicarDecaimentoGlobal, proporHipotese, hipotesesParaPrompt, buscarAprendizadosNaoNotificados, marcarComoNotificadas } = require('../services/hipoteses');
const { analisarNoturno, buscarHumor3dias } = require('../services/analiseNoturna');
const { proporSugestao } = require('../services/sugestoes');
const { jaNotificado, marcarNotificado, limparAntigos, contarNotificadosHoje } = require('../services/eventosNotificados');
const { snapshotMatinal } = require('../services/oura');
const { montarDiretrizPriming } = require('../services/priming');
const { getBrtNow, eventoElegivelPos, classificarSaborPos, cabeNoTetoPos } = require('../utils/time');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT, normalizarTratamento } = require('../prompts/system');
const { detectarPerformaSubjetividade } = require('../services/detectarPerformaSubjetividade');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { sendTelegramMessage, enviarMensagemLonga } = require('../services/telegram');
const CAROL_CHAT_ID = process.env.TELEGRAM_CHAT_ID_CAROL;

// ─── GERADOR DE MENSAGEM PROATIVA ────────────────────────────────────────────

const gerarMensagemProativa = async (contexto) => {
  const agora = getBrtNow();
  const userPrompt = `Você está enviando uma mensagem PROATIVA pra Carol no Telegram (não é resposta a pergunta dela).

━━━ AGORA ━━━
Hora: ${agora.hora} BRT · ${agora.diaSemana}, ${agora.dataBR} · Período: ${agora.periodo}
Use essa âncora pra saudações e referências temporais. NUNCA chute período pelo conteúdo do contexto.

TIPO: ${contexto.tipo}
CONTEXTO: ${JSON.stringify(contexto.dados)}

FONTES (CRÍTICO — não inventar):
- oura_corpo (DADOS BIOMÉTRICOS REAIS DO ANEL OURA, PRIORIDADE ABSOLUTA quando presente): contém sono (score, total_sleep_min, deep_sleep_min, rem_sleep_min, efficiency), readiness (score, temperature_deviation_c, hrv_balance, resting_heart_rate), atividade (steps, score), stress (stress_high_seconds, day_summary), workouts (array de atividades detectadas). Trate como observação primária do corpo da Carol HOJE. Use os números literalmente quando relevantes (ex: "dormiu 6h13, score 62, temperatura +0.3°C do baseline"). Ancore a observação inicial neles antes de qualquer outra fonte. Se ausente ou null, PULE esta fonte sem mencionar. NUNCA invente leituras que não estão literalmente nos dados.
- FACTUAIS (verdade se presentes, NÃO invente se vazias): agenda_do_dia, aniversarios_proximos, humor_3_dias. Só mencione o que está literalmente nestas chaves.
- tarefas_pendentes: são reais (vêm do Supabase) mas NÃO são agenda — trate como "fazer se der tempo", nunca como compromissos do dia.
- CONTEXTUAIS (pano de fundo, NÃO são agenda): memorias_relevantes, hipoteses_ativas. Use como observação ou cor, nunca como compromisso de hoje.
- aprendizados_recentes: hipóteses recém-validadas sobre a Carol. Se o array tiver itens, INCLUA no briefing UM bloco destacado com marcador 🧠, no formato exato: "🧠 Algo que aprendi com certeza sobre você: [texto da hipótese de maior confiança]". Use só o primeiro item do array. Máximo 1 bloco por briefing. Se o array estiver vazio, não mencione nada.
- Tipo "briefing_matinal": é abertura de dia (7h BRT em geral). Tom Registro C (editorial-observadora) ou A (seca-poética). NUNCA motivacional ("você é capaz!", "acredite em si!", "vai dar certo!", "bom dia maravilhosa!"). NUNCA self-help genérico ou clichês TDAH ("uma coisa de cada vez", "ferrari com freio de bicicleta").
  PROVOCAÇÃO CULTURAL (opcional — no máximo UMA linha, só se conectar de verdade com o dia/estação/tema; se não conectar, OMITE):

  Puxe de UMA figura desta curadoria e PARAFRASEIE uma ideia documentada dela, atribuindo o autor ("como X pensava…", "na visão de X…"). Tom de registro, não de motivação — provocação que faz pensar, nunca frase de efeito de coach.

  REGRA ANTI-MENTIRA (inegociável): NUNCA invente frase entre aspas na boca de ninguém. Parafraseie a IDEIA e atribua o autor. Com figuras públicas reais (Mujica, Krenak, Arendt…) isso vale dobrado — frase falsa é mentira e desrespeito. A ÚNICA citação verbatim permitida é a canônica do Niemeyer ("Não é o ângulo reto que me atrai, nem a linha reta, dura, inflexível…"). Qualquer outra coisa: paráfrase atribuída.

  NÃO use pop-filosofia de palco (ex.: Cortella) como sabedoria. A curadoria é séria.

  Curadoria (paleta — varie, não repita sempre os mesmos):
  - Arquitetura/espaço: Bachelard, Pallasmaa, Tanizaki, Lina Bo Bardi, Niemeyer, Louis Kahn, Aldo Van Eyck, Manfredo Tafuri, Henri Lefebvre
  - Literatura: Clarice Lispector, Hilda Hilst, Hermann Hesse, Cortázar, Camus, João Cabral, Dante, Stefan Zweig, Saint-Exupéry, Calvino, Borges, Drummond, Bauman
  - Cinema: Francis Ford Coppola, Sofia Coppola, Woody Allen, Agnès Varda, Joachim Trier, Godard, Scorsese, Cronenberg, Tarkóvski, Chris Marker, Kieślowski, Glauber Rocha, Wong Kar-wai
  - Música: Bach, Chopin, Prokófiev, Chostakóvitch, Pierre Henry, Stockhausen, Chico Science, Nino Rota
  - Pintura: Chagall
  - História/pensamento: Hannah Arendt, Carlos Lemos, Roberto Pompeu de Toledo, Eduardo Giannetti, Hobsbawm, Braudel, Carlo Ginzburg, Eduardo Galeano
  - Política como filosofia de vida: Ailton Krenak, Davi Kopenawa, Eduardo Viveiros de Castro, Pepe Mujica, Václav Havel
  - Grandes mentes: Nietzsche, Schopenhauer, Edith Stein, Jung, Simone Weil, Byung-Chul Han, Susan Sontag
  Exemplos de tom (referência, não copiar):
  ✓ "Quatro reuniões. Bachelard chamava a casa de abrigo do devaneio — você vai ter pouco devaneio hoje. Marca um intervalo."
  ✓ "Lua nova, Vata pesado. Tanizaki escrevia sobre o valor das sombras — hoje permite a manhã ser menos brilhante."
  ✗ "Boa segunda! Como diria Clarice, 'eu sou tudo aquilo que aconteceu comigo'!" (frase textual inventada, motivacional)
  ✗ "Você é capaz! Niemeyer dizia pra acreditar nas curvas!" (clichê motivacional)
- Tipo "checkin_tarde": é check-in de meio do dia, hora específica no contexto. Tom Registro A (seca-poética) ou C (editorial-observadora), NUNCA maternal. Se há eventos_passados, pergunte factualmente sobre eles ("você tinha X, como foi?"). Se tarefas_pendentes tem itens, mencione uma específica sem cobrar. Se evento_proximo_30min não for null, seja breve (vai interromper). Se tudo vazio, só marque o momento ("tarde começando") sem forçar conversa.
- Tipo "pre_evento": é lembrete de evento que começa em alguns minutos. Em "CONTEXTO" você recebe: evento (nome), hora (HH:MM BRT), em_minutos (número EXATO de minutos até começar), local. SEMPRE use em_minutos LITERALMENTE — ex: se em_minutos=28, escreva "em 28 minutos" ou "daqui a 28 minutos". NÃO arredonde pra 30. NÃO substitua por "logo", "em breve", "já já", "daqui a pouco". Se em_minutos for 0 ou 1, diga "Agora" ou "em 1 minuto". Use a hora literal (HH:MM). Tom Registro A (seca-poética) ou C (editorial-observadora). Mensagem CURTA — 1-3 linhas (com o priming abaixo, no máximo ~4). Pode adicionar 1 detalhe contextual (item a trazer, deslocamento). Se local for "não especificado", omita.
${contexto.tipo === 'pre_evento' ? montarDiretrizPriming(contexto.dados?.oura_corpo) : ''}
- Tipo "pos_evento": check-in sobre algo que ACABOU. CONTEXTO traz: evento, hora_fim (HH:MM BRT), ha_minutos, local, e sabor ('vivido' ou 'habito'). REGRA TONAL CRÍTICA (vale pros dois sabores): NUNCA cobrança, NUNCA "você fez?", NUNCA pressuponha que foi bom OU ruim. CURTÍSSIMA 1-2 linhas, Registro B (presença) ou C, nunca seco/clínico. Use o nome do evento LITERAL do CONTEXTO; NÃO invente detalhes; NÃO precisa citar ha_minutos; se local for "não especificado", omita. Silêncio da pessoa NUNCA é cobrado. Ramifique por sabor:
  • sabor "vivido" (evento que de fato aconteceu — Eventos/Trabalho/Lazer): curiosidade calorosa sobre como foi. Ex.: "Como foi [evento]? 💜".
  • sabor "habito" (Selfcare — você NÃO sabe se a atividade rolou): convite ABERTO que NÃO assume execução (nem sucesso nem falha). Celebra SE rolou, acolhe SE não. Ex.: "Tinha [evento] agora 💜 se rolou, comemora comigo; se não, sem culpa."
- Se agenda_do_dia estiver vazia ou ausente, diga literalmente "agenda livre hoje" ou similar. NÃO mencione exercício, estudo, reunião ou outros compromissos a menos que estejam em agenda_do_dia.

Regras desta mensagem:
- Use HTML do Telegram: <b>negrito</b>, <i>itálico</i>
- Máximo 20 linhas
- Modula o registro (A/B/C) conforme o momento exige — não force pergunta no final se a mensagem pede silêncio.

Gere APENAS a mensagem, sem explicações.`;

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textoFinal = normalizarTratamento(resp.content[0].text);

  // Onda 1.9 Layer 2: detector fire-and-forget de performance de subjetividade
  detectarPerformaSubjetividade(textoFinal, null, 'scheduler.gerarMensagemProativa', { tipo: contexto.tipo }).catch(() => {});

  return textoFinal;
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
    // Janela alargada 25-35min (era 1min): cobre cadência cron-job.org de 5min com folga 200%.
    // Dedup via eventos_notificados (jaNotificado check-then-act) previne duplicatas.
    const em25min = new Date(agora.getTime() + 25 * 60000);
    const em35min = new Date(agora.getTime() + 35 * 60000);

    const { google } = require('googleapis');
    const cal = google.calendar({ version: 'v3', auth: getAuthClient() });

    // Busca em todos os calendários
    const calIds = (process.env.GOOGLE_CALENDAR_IDS || 'primary').split(',');

    for (const calId of calIds) {
      try {
        const res = await cal.events.list({
          calendarId: calId.trim(),
          timeMin: em25min.toISOString(),
          timeMax: em35min.toISOString(),
          singleEvents: true,
        });

        const eventos = (res.data.items || []).filter(e =>
          !e.summary?.includes('Buffer') &&
          !e.summary?.includes('🌿') &&
          !e.summary?.includes('🚗')
        );

        for (const evento of eventos) {
          // Trade-off: 2 cron runs concorrentes podem enviar 2x (PK conflict no 2o INSERT).
          // Aceitável receber 2x esporadicamente > NÃO receber. cron-job.org é HTTP sync.
          // try/catch por evento: 1 evento ruim não interrompe os outros (T7).
          try {
            // Check-then-act: SELECT antes pra não trancar evento se envio falhar (Bug J ontem)
            if (await jaNotificado(evento.id, 'pre_evento_30min')) {
              console.log(`[Scheduler] Evento ${evento.id} ja notificado, pulando.`);
              continue;
            }

            // Defesa em profundidade: all-day events (sem dateTime) ficam fora de "em X min"
            if (!evento.start?.dateTime) continue;

            const startMs = new Date(evento.start.dateTime).getTime();
            const minutosReais = Math.max(0, Math.round((startMs - agora.getTime()) / 60000));
            const hora = new Date(evento.start.dateTime).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});

            // Priming (MVP): readiness REAL de hoje, buscado SÓ aqui (evento elegível
            // não-notificado prestes a virar mensagem), não em todo tick. Falha → null.
            const oura = await snapshotMatinal().catch(() => null);
            const ouraSlim = oura ? { readiness: oura.readiness, stress: oura.stress } : null;

            const msg = await gerarMensagemProativa({
              tipo: 'pre_evento',
              dados: {
                evento: evento.summary,
                hora: hora,
                em_minutos: minutosReais,
                local: evento.location || 'não especificado',
                oura_corpo: ouraSlim
              }
            });
            await sendTelegramMessage(CAROL_CHAT_ID, msg);
            // INSERT só DEPOIS do envio bem-sucedido — saldo zerado ou Telegram down NÃO tranca evento
            await marcarNotificado(evento.id, 'pre_evento_30min');
            console.log(`[Scheduler] ✅ Lembrete pré-evento: ${evento.summary} (em ${minutosReais}min)`);
          } catch (eventoErr) {
            console.error('[Scheduler] ❌ pre-evento item:', {
              name: eventoErr.name, message: eventoErr.message,
              type: eventoErr?.error?.type, status: eventoErr?.status,
              eventId: evento.id, calendarId: calId, stack: eventoErr.stack
            });
            // Nao re-throw: outros eventos do mesmo calendario continuam sendo processados
          }
        }
      } catch(e) {
        console.error('[Scheduler] ❌ pre-evento calendario:', {
          name: e.name, message: e.message,
          type: e?.error?.type, status: e?.status,
          calendarId: calId, stack: e.stack
        });
        // Nao re-throw: outros calendarios continuam sendo processados no for externo
      }
    }
  } catch(e) {
    console.error('[Scheduler] ❌ Erro pré-evento:', e.message);
  }
};

// ─── JOB 2.5: CHECK-IN PÓS-EVENTO (sabor "vivido") ───────────────────────────
// Espelha jobPreEvento mas detecta evento que ACABOU (janela [−15,−5)min via
// eventoElegivelPos puro). Tom celebração/curiosidade, NUNCA cobrança.
// Allowlist Eventos/Trabalho/Lazer · blinda Saúde · teto 2/dia · quiet hours 22-7.
const jobPosEvento = async () => {
  try {
    const agora = new Date();

    // Quiet hours: 22h–07h BRT → silêncio.
    const { horaNum } = getBrtNow(agora);
    if (horaNum < 7 || horaNum >= 22) return;

    // Governança de volume (cross-execução, via eventos_notificados):
    // teto total 2/dia + sub-teto máx 1 hábito/dia. Contadores locais (let)
    // incrementam dentro da execução pra o teto valer no mesmo run.
    let habitoHoje = await contarNotificadosHoje('pos_evento_habito');
    let totalHoje = (await contarNotificadosHoje('pos_evento_vivido')) + habitoHoje;
    if (totalHoje >= 2) return;

    // buscarEventosTodos: cobre os 9 calendários E seta _calendarId (≠ loop env do pré).
    const trintaMin = new Date(agora.getTime() - 30 * 60000);
    const eventos = await buscarEventosTodos(trintaMin, agora);

    for (const ev of eventos) {
      try {
        const nome = getCalendarioInfo(ev._calendarId)?.nome;
        const sabor = classificarSaborPos(nome); // 'vivido' | 'habito' | null
        if (!sabor) continue;                     // Saúde blindado + Estudo/Faculdade/Lar/Burocracia silêncio
        const tipo = sabor === 'habito' ? 'pos_evento_habito' : 'pos_evento_vivido';
        if (!cabeNoTetoPos({ totalHoje, habitoHoje, sabor })) continue; // teto 2/dia + máx 1 hábito
        if (!eventoElegivelPos(ev, agora)) continue; // timed + não-buffer + janela [−15,−5)min
        if (await jaNotificado(ev.id, tipo)) continue;

        const fimDate = new Date(ev.end.dateTime);
        const horaFim = fimDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const haMinutos = Math.max(0, Math.round((agora.getTime() - fimDate.getTime()) / 60000));

        const msg = await gerarMensagemProativa({
          tipo: 'pos_evento',
          dados: {
            evento: ev.summary,
            hora_fim: horaFim,
            ha_minutos: haMinutos,
            local: ev.location || 'não especificado',
            sabor,
          },
        });
        await sendTelegramMessage(CAROL_CHAT_ID, msg);
        // INSERT só DEPOIS do envio (igual jobPreEvento)
        await marcarNotificado(ev.id, tipo);
        totalHoje++;
        if (sabor === 'habito') habitoHoje++;
        console.log(`[Scheduler] ✅ Check-in pós-evento (${sabor}): ${ev.summary} (há ${haMinutos}min)`);
      } catch (eventoErr) {
        console.error('[Scheduler] ❌ pos-evento item:', {
          name: eventoErr.name, message: eventoErr.message,
          type: eventoErr?.type, status: eventoErr?.status,
          eventId: ev?.id, stack: eventoErr.stack
        });
        // Não re-throw: outros eventos continuam
      }
    }
  } catch(e) {
    console.error('[Scheduler] ❌ Erro pós-evento:', e.message);
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

    // Humor: ler humor_log REAL (calibrado pela REGRA HUMOR), nao inferir
    // de mensagens.humor (regex permissiva que gerava contagens infladas).
    const humoresHoje = await buscarHumorRecente(24);

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

// ─── JOB 7.5: WEEKLY REVIEW — sábado 07h America/Sao_Paulo ──────────────────
// Onda 1.5 — Ritual reflexivo de 6 blocos. Primeiro disparo: 23/05/2026.

const jobWeeklyReview = async (chatId) => {
  try {
    console.log('[Scheduler] 🌅 Weekly Review disparado — chatId:', chatId);
    const { gerarWeeklyReview } = require('../services/weeklyReview');
    const { salvarAcaoPendente } = require('../services/memorySupabase');

    const resultado = await gerarWeeklyReview(chatId, { trigger: 'cron' });

    await enviarMensagemLonga(chatId, resultado.mensagem);

    // Se houver sugestões em fila, salvar acao_pendente pra parser
    // numerado em brain.js Passo 0f-weekly
    if (resultado.deveSalvarPendente && resultado.sugestoesIds.length > 0) {
      await salvarAcaoPendente(chatId, {
        tipo: 'weekly_sugestoes',
        params: {
          sugestoes: resultado.sugestoesIds,
          disparada_em: new Date().toISOString()
        }
      });
    }

    console.log(`[Scheduler] ✅ Weekly Review concluído — sugestões em fila: ${resultado.sugestoesIds.length}`);
  } catch (err) {
    console.error('[Scheduler] ❌ Erro Weekly Review:', err.message);
    // Não re-throw — cron resiliente
  }
};

// ─── JOB 8: ANÁLISE NOTURNA (memória evolutiva) — todo dia às 2h ────────────

const jobAnaliseNoturna = async () => {
  console.log('🌙 [Cron noturno] Iniciando análise...');
  try {
    // Cleanup nightly: remove notificacoes antigas (>48h) da tabela eventos_notificados
    const limpos = await limparAntigos();
    console.log(`[Cron noturno] Eventos notificados antigos (>48h) removidos: ${limpos}`);
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

    // (C) Feedbacks reincidentes sobre o comportamento da ARIA → memorias.feedback_aria.
    // Honra de graça: buildMemoryContext já injeta a categoria no prompt reativo.
    const feedbacksAria = resultado?.feedbacks_aria || [];
    for (const f of feedbacksAria) {
      try {
        let memoriaExistente = null;
        if (f.match_chave) {
          const existentes = await buscarMemorias('feedback_aria', 50);
          memoriaExistente = existentes.find(m => m.chave === f.match_chave) || null;
        }
        const plano = planejarUpsertFeedback({
          item: {
            instrucao_canonica: f.instrucao_canonica,
            chave_sugerida: f.chave_sugerida,
            match_chave: f.match_chave || null,
          },
          memoriaExistente,
        });
        // salvarMemoriaComHistorico: INSERT + same-key auto-supersede (insert; ou
        // supersede o antigo + insert com count+1 quando acao === 'increment').
        await salvarMemoriaComHistorico('feedback_aria', plano.chave, plano.valor, plano.contexto);
        console.log(`🪞 Feedback ARIA ${plano.acao}: [${plano.chave}] ${plano.contexto}`);
      } catch (err) {
        console.error('[Scheduler] Erro ao registrar feedback ARIA:', err.message);
      }
    }
    if (feedbacksAria.length > 0) {
      console.log(`[Scheduler] 🪞 ${feedbacksAria.length} feedback(s) ARIA processado(s)`);
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
  // Pós-evento: paridade com o pré (não roda em Vercel serverless; disparo real
  // via cron-job.org → GET /api/cron/pos-evento a cada 5min).
  cron.schedule('*/5 * * * *', jobPosEvento, { timezone: 'America/Sao_Paulo' });

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

  // Weekly Review — sábado 07h BRT (Onda 1.5, primeiro disparo 23/05/2026)
  // Timezone Sao_Paulo (Bug #16 forward-compat — não criar débito novo em Bahia)
  cron.schedule('0 7 * * 6', () => jobWeeklyReview(CAROL_CHAT_ID), { timezone: 'America/Sao_Paulo' });

  console.log('[Scheduler] ✅ Jobs ativos:');
  console.log('  🌅 Briefing matinal: todo dia às 7h');
  console.log('  🎂 Aniversários: todo dia às 8h');
  console.log('  ⏰ Pré-evento: a cada 5min');
  console.log('  📊 Relatório semanal: domingo às 17h');
  console.log('  📅 Planejamento semanal: domingo às 18h');
  console.log('  🌙 Resumo noturno: todo dia às 22h');
  console.log('  📈 Relatório mensal: dia 1 às 9h');
  console.log('  🌙 Análise evolutiva (memória): todo dia às 2h');
  console.log('  🌅 Weekly Review: sábado às 7h America/Sao_Paulo');
};

module.exports = {
  iniciarScheduler,
  jobBriefingMatinal,
  jobCheckinTarde,
  jobPreEvento,
  jobPosEvento,
  jobResumoNoturno,
  jobPlanejamentoSemanal,
  jobAniversarios,
  jobRelatorioSemanal,
  jobRelatorioMensal,
  jobAnaliseNoturna,
  jobWeeklyReview,
};
