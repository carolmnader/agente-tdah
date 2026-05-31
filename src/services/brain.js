const Anthropic = require('@anthropic-ai/sdk');
const { getHistory, addMessage, getMemorySummary, addTask, addVictory, updateProfile, loadCarolProfile, extrairEsalvarFatos, buildMemoryContext, detectarHumor, salvarHumor } = require('./memorySupabase');
const { saveToObsidian } = require('./obsidian');
const { loadEvolvedPrompt } = require('./selfImprove');
const { isEmergencia, getModoEmergencia, gerarCheckin, getCheckinMatinal, interpretarCheckin, getRespostaACT } = require('../modules/holistic');
const { getFaseLunar, getContextoAstrologico } = require('../integrations/astrology');
const { getContextoAyurvedico, getMensagemAyurvedica } = require('../modules/ayurveda');
const { buildHolisticContext, buildBloqueioContext } = require('../prompts/holistic-context');
const { processarCalendar, sinalCalendarGuard, RE_FATO_PASSADO, RE_VERBO_IMPERATIVO_CALENDAR } = require('./calendarBrain');
const { montarDiretrizCelebracao, classificarRealizacao } = require('./celebracaoPosEvento');
const { getBrtNow, montarBlocoAgenda } = require('../utils/time');
const { buscarEventosTodos } = require('../integrations/calendar');

/**
 * Monta bloco "AGENDA REAL DE HOJE" pra injetar no system prompt reativo.
 * Replica janela 00:00-23:59:59 do dia (mesmo padrao do listarEventosHoje em
 * integrations/calendar.js — herda comportamento de TZ que ja roda em prod).
 * Falha silenciosa (null) se Calendar API estiver fora — padrao Oura.
 */
async function blocoAgendaReativo(now) {
  try {
    const inicio = new Date(now); inicio.setHours(0,0,0,0);
    const fim = new Date(now); fim.setHours(23,59,59,999);
    const eventos = await buscarEventosTodos(inicio, fim);
    return montarBlocoAgenda(eventos, now);
  } catch (e) {
    console.error('[agenda-reativa] Calendar falhou:', e?.message);
    return null;
  }
}
const { buscarPessoaInteligente, formatarPessoa, salvarOuAtualizarPessoa, buildPessoasContextoMensagem } = require('./crm');
const { registrarEvento, gerarInsightRapido, gerarRelatorioSemanal, gerarRelatorioMensal } = require('./analytics');
const { listarHipotesesValidadas } = require('./hipoteses');
const { listarSugestoesAbertas } = require('./sugestoes');
const { detectarEPropor } = require('../prompts/detectorPadroes');
const { validarImplicitamente } = require('./validadorImplicito');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache do check-in mais recente da Carol
let ultimoCheckin = null;

// ─── Helpers para detecção de nomes recentes (regra dos 3 turnos) ───
const NOMES_STOPWORDS = new Set([
  'ARIA','Carol','Saúde','Trabalho','Eventos','Selfcare','Lazer','Estudo',
  'Faculdade','Burocracia','Lar','Casa','Mercado','Banco','Bom','Boa','Olá'
]);

function extrairNomesDoTexto(texto) {
  const regex = /\b[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]{2,}(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]{2,})?\b/g;
  return [...new Set(texto.match(regex) || [])].filter(n => !NOMES_STOPWORDS.has(n.split(' ')[0]));
}

function getNomesRecentes(history, turnos = 3) {
  return history.slice(-turnos).flatMap(m => extrairNomesDoTexto(m.content || ''));
}

// ─────────────────────────────────────────────
// PASSO 1 — Analisa a mensagem (pensamento rápido)
// ─────────────────────────────────────────────
async function analyzeMessage(message) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analise esta mensagem de uma pessoa com TDAH e responda SOMENTE com JSON válido, sem markdown:

Mensagem: "${message}"

Responda exatamente neste formato:
{
  "intent": "dump|task|focus|emergency|report|question|chat|idea|schedule",
  "emotion": "calm|stressed|excited|overwhelmed|frustrated|happy|tired",
  "urgency": "low|medium|high",
  "has_task": true/false,
  "task_text": "texto da tarefa se houver, senão null",
  "has_victory": true/false,
  "victory_text": "texto da vitória se houver, senão null",
  "energy_mentioned": true/false,
  "energy_level": "low|medium|high|null",
  "thinking_note": "uma frase sobre o que Carol realmente precisa agora",
  "nomes_mencionados": ["primeiros nomes ou primeiro+último de PESSOAS mencionadas, [] se nenhuma"],
  "pessoas_pergunta_sobre": true/false
}

REGRAS para nomes_mencionados:
- Extraia apenas nomes próprios DE PESSOAS (não confunda com objetos, comidas, lugares).
- NUNCA inclua: "ARIA", "Carol", dias da semana (segunda, terça...), meses, calendários (Saúde, Trabalho, Eventos, Selfcare, Lazer, Estudo, Faculdade, Burocracia, Lar/Pets), saudações.
- Use o nome como Carol falou (ex: "Marcela", "Dr. João", "Ana Maria").
- Se não houver pessoa nenhuma, retorne [].

REGRA para pessoas_pergunta_sobre:
- true se Carol está PERGUNTANDO sobre alguém ("quem é X", "lembra da Y", "fala da Z", "me conta da W").
- false se for uma menção em passagem ("almoço com Marcela", "vou ligar pra Ana").`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    return JSON.parse(text);
  } catch {
    return {
      intent: 'chat',
      emotion: 'calm',
      urgency: 'low',
      has_task: false,
      task_text: null,
      has_victory: false,
      victory_text: null,
      energy_mentioned: false,
      energy_level: null,
      thinking_note: 'Responder com atenção e cuidado',
      nomes_mencionados: [],
      pessoas_pergunta_sobre: false,
    };
  }
}

// ─────────────────────────────────────────────
// PASSO 2 — Escolhe a estratégia de resposta
// ─────────────────────────────────────────────
function chooseStrategy(analysis) {
  const strategies = {
    emergency: {
      name: 'Modo Emergência',
      instruction: 'Carol está sobrecarregada. PRIMEIRO valide o sentimento em 1 linha. DEPOIS ofereça UMA coisa minúscula para fazer agora. Máximo 4 linhas.',
    },
    dump: {
      name: 'Brain Dump',
      instruction: 'Organize o que Carol disse em bullets simples. Liste no máximo 3 itens mais importantes. Pergunte qual ela quer atacar primeiro.',
    },
    task: {
      name: 'Criação de Tarefa',
      instruction: 'Confirme a tarefa, quebre em 2-3 micro-passos de 5 min cada. Pergunte quando ela quer fazer.',
    },
    focus: {
      name: 'Modo Foco',
      instruction: 'Confirme a tarefa, inicie Pomodoro de 15 min. Seja animada e encorajadora. Diga que vai fazer check-in depois.',
    },
    idea: {
      name: 'Captura de Ideia',
      instruction: 'Celebre a ideia com entusiasmo genuíno. Salve e confirme. Ofereça desenvolver ou deixar para depois.',
    },
    schedule: {
      name: 'Agendamento',
      instruction: 'Extraia data/hora/duração. Adicione buffer de 30min. Confirme antes de criar.',
    },
    report: {
      name: 'Relatório',
      instruction: 'Pergunte sobre 3 vitórias do dia. Celebre cada uma. Gere resumo motivador.',
    },
    question: {
      name: 'Pergunta',
      instruction: 'Responda de forma direta e clara. Máximo 3 pontos. Use exemplo prático se ajudar.',
    },
    chat: {
      name: 'Conversa',
      instruction: 'Seja calorosa e presente. Resposta curta, máximo 3 linhas. Mostre que está ouvindo.',
    },
  };

  // Sobrescreve se emoção é forte
  if (analysis.emotion === 'overwhelmed' || analysis.emotion === 'frustrated') {
    return strategies.emergency;
  }

  return strategies[analysis.intent] || strategies.chat;
}

// ─────────────────────────────────────────────
// PASSO 3 — Gera a resposta final
// ─────────────────────────────────────────────
async function generateResponse(message, analysis, strategy, memorySummary, pessoasInfo = {}, extraDiretriz = '') {
  const { SYSTEM_PROMPT, normalizarTratamento } = require('../prompts/system');

  const evolvedAdditions = loadEvolvedPrompt();
  const carolProfile = loadCarolProfile();

  // Contexto holístico: ayurveda + lua + check-in + insight
  let holisticContext = '';
  try {
    const agora = new Date();
    const lua = await getFaseLunar();
    const ayurveda = getContextoAyurvedico(agora);
    const astro = await getContextoAstrologico(agora);

    holisticContext = buildHolisticContext({ lua, checkin: ultimoCheckin, agora });

    holisticContext += `\n\n━━━ DOSHA ATUAL ━━━\n${ayurveda.bloco.nome}: ${ayurveda.bloco.descricao}`;
    holisticContext += `\nIdeal agora: ${ayurveda.estrategia.estrategias[0]}`;
    holisticContext += `\nEvitar: ${ayurveda.estrategia.riscos[0]}`;

    // Se Carol tá travada/overwhelmed, adiciona protocolo de desbloqueio
    if (analysis.emotion === 'overwhelmed' || analysis.emotion === 'frustrated' || analysis.intent === 'emergency') {
      holisticContext += '\n' + buildBloqueioContext();
    }

    // Insight rápido do dia (se disponível)
    try {
      const insight = await gerarInsightRapido();
      if (insight) holisticContext += `\n\nINSIGHT DO DIA: ${insight.replace(/<[^>]*>/g, '')}`;
    } catch(e) {}
  } catch (err) {
    console.log('⚠️ [Brain] Erro ao gerar contexto holístico (continuando sem):', err.message);
  }

  let profileContext = '';
  if (carolProfile) {
    const p = carolProfile.profile || carolProfile.identidade || {};
    const h = carolProfile.health || carolProfile.saude || {};
    const tdah = carolProfile.tdah_profile || carolProfile.padroes_tdah || {};
    const prof = carolProfile.professional || carolProfile.vida_profissional || {};

    const nome = p.preferred_name || p.como_chamar || 'Carol';
    const idade = p.age || p.idade || '';
    const profissao = p.profession || p.profissao || '';
    const diagnosticos = h.diagnoses || h.diagnosticos || [];
    const meds = h.medications?.morning
      ? h.medications.morning.map(m => `${m.name} ${m.dose}`).join(', ')
      : (h.medicamentos || []).map(m => `${m.nome} ${m.dose}`).join(', ');
    const struggles = tdah.main_struggles || tdah.queixas_proprias || [];
    const works = tdah.what_works || tdah.o_que_melhora || [];
    const doesntWork = tdah.what_doesnt_work || tdah.o_que_piora || [];
    const energia = tdah.peak_energy_time || '';
    const meta = prof.financial_goal_2026 || prof.meta_2026 || '';
    const skills = prof.skills || [];

    profileContext = `
━━━ QUEM É A CAROL ━━━
${nome}, ${idade} anos, ${profissao}
Status: ${p.current_status || ''}
Diagnósticos: ${diagnosticos.join(', ')}
Medicação manhã: ${meds}
Medicação noite: ${h.medications?.night ? h.medications.night.map(m => `${m.name} ${m.dose}`).join(', ') : ''}
Energia pico: ${energia}
Dificuldades: ${struggles.slice(0, 4).join(' | ')}
O que funciona: ${works.join(', ')}
O que piora: ${doesntWork.join(', ')}
Skills: ${skills.join(', ')}
Meta 2026: ${meta}`;
  }

  const novasInstrucao = pessoasInfo?.novas?.length > 0
    ? `\n━━━ PESSOAS NOVAS DETECTADAS ━━━\nPessoas que Carol mencionou e ainda não conheço: ${pessoasInfo.novas.join(', ')}.\nTermine sua resposta com UMA linha curta perguntando quem é (ex: "💭 Quem é ${pessoasInfo.novas[0]}? Curiosa!").\nNão interrompa o fluxo principal — a pergunta vem DEPOIS da resposta normal.`
    : '';

  // Memória Evolutiva Fase 2 DESCONTINUADA (anti-deriva, Commit 15): hipóteses
  // NÃO voltam mais ao prompt reativo (cortado o loop gera→realimenta→performa, recon P1).
  const now = new Date();
  const agora = getBrtNow(now);
  const blocoAgenda = await blocoAgendaReativo(now);

  const systemWithMemory = `${SYSTEM_PROMPT}
${profileContext}
${holisticContext}

━━━ MEMÓRIA ATIVA ━━━
${memorySummary || 'Primeira conversa do dia.'}
${pessoasInfo?.contextoStr || ''}
${novasInstrucao}

━━━ APRENDIZADOS DA ARIA ━━━
${evolvedAdditions || 'Sem aprendizados adicionais ainda.'}

━━━ AGORA ━━━
Hora: ${agora.hora} BRT
Dia: ${agora.diaSemana}, ${agora.dataBR}
Período: ${agora.periodo}
Use essa âncora pra qualquer referência temporal (saudações, "hoje", "agora", "ontem"). NUNCA chute período por contexto.
${blocoAgenda ? `\n${blocoAgenda}\n` : ''}
━━━ INSTRUÇÃO DESTA RESPOSTA ━━━
Estratégia: ${strategy.name}
${strategy.instruction}

Estado emocional detectado: ${analysis.emotion}
Urgência: ${analysis.urgency}
Nota interna: ${analysis.thinking_note}
${extraDiretriz ? `\n${extraDiretriz}\n` : ''}`;

  const history = await getHistory();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemWithMemory,
    messages: [
      // Onda 1.7: sanitiza history pra remover created_at (vazado da Onda 1.6
      // COMMIT 2). Anthropic 400 "Extra inputs are not permitted" se passar.
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ],
  });

  const textoFinal = normalizarTratamento(response.content[0].text);

  // Onda 1.9 Layer 2: detector fire-and-forget de performance de subjetividade
  const { detectarPerformaSubjetividade } = require('./detectarPerformaSubjetividade');
  detectarPerformaSubjetividade(textoFinal, message, 'brain.generateResponse').catch(() => {});

  return textoFinal;
}

// ─────────────────────────────────────────────
// PASSO 4 — Salva o thinking log no Obsidian
// ─────────────────────────────────────────────
function saveThinkingLog(message, analysis, strategy, ariaResponse) {
  const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const log = `
## 🕐 ${timestamp}

**Carol disse:** ${message}

**Análise interna:**
- Intenção: \`${analysis.intent}\`
- Emoção: \`${analysis.emotion}\`
- Urgência: \`${analysis.urgency}\`
- Nota: _${analysis.thinking_note}_

**Estratégia escolhida:** ${strategy.name}

**ARIA respondeu:**
> ${ariaResponse.replace(/\n/g, '\n> ')}

---`;

  saveToObsidian('thinking', log);
}

// ─────────────────────────────────────────────
// ORQUESTRADOR PRINCIPAL — roda tudo em sequência
// ─────────────────────────────────────────────
async function think(message, chatId = null) {
  try {
    const lower = message.toLowerCase().trim();

    // Passo 0-PRE: Se ARIA ACABOU DE confirmar criação/edição de evento e Carol pergunta se funcionou
    // Bug anterior: regex era amplo demais (calendar/agenda/📅 qualquer + consegue/atualizou/verificar/teste)
    // → qualquer msg com "consegue" ou "atualizou" virava string hardcoded "Verifique seu Google Calendar".
    // Fix: exige marcador explícito de SUCESSO na última resposta + pergunta específica sobre o resultado.
    const history = await getHistory();
    const ultimaMsgAssistant = history.length >= 1 ? (history[history.length - 1]?.content || '') : '';
    const eraCalendarSucesso = /(✅|📅).*(agendad|criad|movid|reagendad|cancelad)/i.test(ultimaMsgAssistant);
    const perguntaSucesso = /\b(deu certo|funcionou|apareceu (no|na))\b/i.test(lower);
    if (eraCalendarSucesso && perguntaSucesso) {
      const resp = '📅 Verifique seu Google Calendar agora — abra o app e veja se o evento apareceu. Se não apareceu, me diz exatamente o que você pediu para agendar que eu tento novamente.';
      await addMessage('user', message);
      await addMessage('assistant', resp);
      return resp;
    }

    // Passo 0b: tenta parsear resposta de check-in (ex: "3 2 4 1")
    const checkinMatch = lower.match(/^(\d)\s+(\d)\s+(\d)\s+(\d)$/);
    if (checkinMatch) {
      const [, corpo, mente, emocao, energia] = checkinMatch.map(Number);
      if ([corpo, mente, emocao, energia].every(n => n >= 1 && n <= 5)) {
        ultimoCheckin = interpretarCheckin(corpo, mente, emocao, energia);
        await addMessage('user', message);
        // Continua para gerar resposta contextualizada com o check-in
      }
    }

    // Passo 0b2: Relatório / análise de padrões
    if (/relat[oó]rio|padr[oõ]es|an[aá]lise|como estou|como fui|meu progresso|minha evolu[çc][aã]o/i.test(lower)) {
      try {
        const relatorio = /m[eê]s|mensal|30 dias/i.test(lower)
          ? await gerarRelatorioMensal()
          : await gerarRelatorioSemanal();
        await addMessage('user', message);
        await addMessage('assistant', relatorio);
        return relatorio;
      } catch(e) {
        console.log('📊 [Analytics] Erro relatório:', e.message);
      }
    }

    // Passo 0c: /sugestoes — lista sugestões arquiteturais abertas (sem Opus)
    if (/^\/?sugest[oõ]es?$/i.test(lower)) {
      const sugs = await listarSugestoesAbertas(5);
      let resp;
      if (!sugs.length) {
        resp = '🔧 Nenhuma sugestão arquitetural aberta no momento. Quando eu gerar algo novo à noite, vai aparecer aqui.';
      } else {
        const itens = sugs.map((s, i) =>
          `<b>${i + 1}. ${s.titulo}</b>\n<i>${s.categoria} · P${s.prioridade} · conf ${Number(s.confianca).toFixed(2)}</i>\n${s.descricao}`
        ).join('\n\n');
        resp = `🔧 <b>${sugs.length} sugestão(ões) aberta(s):</b>\n\n${itens}\n\n<i>Aceitar/rejeitar: no Supabase Studio (ainda).</i>`;
      }
      await addMessage('user', message);
      await addMessage('assistant', resp);
      return resp;
    }

    // Passo 0d: /aprendizados — lista hipóteses validadas
    if (/^\/?aprendizados?$/i.test(lower)) {
      const aps = await listarHipotesesValidadas(10);
      let resp;
      if (!aps.length) {
        resp = '🧠 Ainda não tenho nada validado com segurança sobre você. Quando eu tiver, aparece aqui.';
      } else {
        const itens = aps.map((h, i) =>
          `<b>${i + 1}.</b> ${h.texto}\n<i>conf ${Number(h.confianca).toFixed(2)}</i>`
        ).join('\n\n');
        resp = `🧠 <b>${aps.length} coisa(s) que aprendi sobre você:</b>\n\n${itens}`;
      }
      await addMessage('user', message);
      await addMessage('assistant', resp);
      return resp;
    }

    // Passo 0e: /ajuda — lista comandos disponíveis
    if (/^\/?(ajuda|help)$/i.test(lower)) {
      const resp = `🗂️ <b>Comandos disponíveis:</b>

<b>/sugestoes</b> — o que eu proponho melhorar em mim mesma
<b>/aprendizados</b> — o que aprendi sobre você com segurança
<b>/checkin</b> ou <b>bom dia</b> — check-in 4D (corpo, mente, emoção, energia)
<b>/relatorio</b> — análise de padrões TDAH da semana

Fora comandos, é só conversar normal. Eu leio contexto, agenda, humor.`;
      await addMessage('user', message);
      await addMessage('assistant', resp);
      return resp;
    }

    // Passo 0f-pos: resposta a check-in PÓS-EVENTO (loop Fogg — Commit 1).
    // Liga a resposta da Carol ao evento que disparou o "como foi X?" e
    // celebra/acolhe ancorado nele. ANTES do processarCalendar pra "Não fui" não
    // virar cancelamento. Single-shot + TTL 3h. Lido ANTES do bloco weekly
    // (cuja leitura default de 5min deletaria um pendente pos_evento mais velho).
    if (chatId) {
      const { buscarAcaoPendente, limparAcaoPendente } = require('./memorySupabase');
      const POS_EVENTO_TTL_MS = 3 * 60 * 60 * 1000; // 3h — resposta pode ser lenta
      const pendPos = await buscarAcaoPendente(chatId, POS_EVENTO_TTL_MS);
      if (pendPos?.tipo === 'pos_evento') {
        if (sinalCalendarGuard(message)) {
          // Comando de calendário legítimo ("cancela yoga", "marca X") NÃO é
          // sequestrado: solta o pendente (single-shot) e deixa fluir p/ calendarBrain.
          await limparAcaoPendente(chatId);
        } else if (!isEmergencia(message)) {
          // Emergência tem prioridade (cai no Passo 0b3). Senão: celebra/acolhe.
          const diretriz = montarDiretrizCelebracao({ sabor: pendPos.params?.sabor, evento: pendPos.params?.evento });
          const analysisPos = await analyzeMessage(message);
          const strategyPos = chooseStrategy(analysisPos);
          const memoryPos = await getMemorySummary();
          const ariaResp = await generateResponse(message, analysisPos, strategyPos, memoryPos, {}, diretriz);
          await addMessage('user', message);
          await addMessage('assistant', ariaResp);
          await limparAcaoPendente(chatId);
          console.log(`🎉 [Brain] Celebração pós-evento: "${pendPos.params?.evento}" (${pendPos.params?.sabor})`);
          // Commit 2 (Fogg): persiste o realizado na linha de dedup (registro
          // INTERNO — nunca vira cobrança; a celebração já foi enviada acima).
          // Best-effort: nunca derruba o turno nem a fala.
          try {
            const { registrarRealizacao } = require('./eventosNotificados');
            const tipoNotif = pendPos.params?.sabor === 'habito' ? 'pos_evento_habito' : 'pos_evento_vivido';
            await registrarRealizacao(pendPos.params?.evento_id, tipoNotif, {
              realizado: classificarRealizacao(message),
              contextoResposta: message,
            });
          } catch (e) {
            console.error('[Brain] registrarRealizacao pós-evento falhou (best-effort):', e.message);
          }
          return ariaResp;
        }
      }
    }

    // Passo 0f-weekly: respostas a Weekly Review (Onda 1.5)
    // Parser "1 pinar" / "2 arquivar" / "3 ler" / "todas pinar" / "todas arquivar" / "pulo essa semana"
    // Lê acoes_pendentes tipo='weekly_sugestoes' (params.sugestoes = array de IDs)
    if (chatId) {
      const { buscarAcaoPendente, limparAcaoPendente } = require('./memorySupabase');
      const pendente = await buscarAcaoPendente(chatId);
      if (pendente?.tipo === 'weekly_sugestoes') {
        const matchSingle = lower.match(/^([1-3])\s+(pinar|arquivar|ler)$/i);
        const matchTodas = lower.match(/^todas\s+(pinar|arquivar)$/i);
        const matchPulo = /^pul[oa]\s+essa\s+semana$/i.test(lower);

        if (matchSingle) {
          const idx = parseInt(matchSingle[1], 10) - 1;
          const acao = matchSingle[2].toLowerCase();
          const sugestaoId = pendente.params?.sugestoes?.[idx];
          if (!sugestaoId) {
            const resp = `Não achei a sugestão ${matchSingle[1]} na lista. Tenta de novo ou "todas arquivar".`;
            await addMessage('user', message);
            await addMessage('assistant', resp);
            return resp;
          }

          if (acao === 'ler') {
            const { buscarSugestaoPorId } = require('./sugestoes');
            const detalhe = await buscarSugestaoPorId(sugestaoId);
            const resp = `<b>${detalhe.titulo}</b>\n\n${detalhe.descricao}\n\n` +
              `<i>Confiança: ${Number(detalhe.confianca).toFixed(2)} · ${detalhe.categoria} · P${detalhe.prioridade}. Manda "${matchSingle[1]} pinar" ou "${matchSingle[1]} arquivar" pra decidir.</i>`;
            await addMessage('user', message);
            await addMessage('assistant', resp);
            return resp;
          }

          // pinar ou arquivar
          const novoStatus = acao === 'pinar' ? 'pinada' : 'arquivada';
          const { marcarStatus } = require('./sugestoes');
          await marcarStatus(sugestaoId, novoStatus);
          const resp = `${acao === 'pinar' ? '📌' : '🗑️'} Sugestão ${matchSingle[1]} ${novoStatus}.`;
          await addMessage('user', message);
          await addMessage('assistant', resp);
          return resp;
        }

        if (matchTodas) {
          const acao = matchTodas[1].toLowerCase();
          const novoStatus = acao === 'pinar' ? 'pinada' : 'arquivada';
          const { marcarStatus } = require('./sugestoes');
          const ids = pendente.params?.sugestoes || [];
          for (const id of ids) {
            try { await marcarStatus(id, novoStatus); } catch (e) { console.log('🟡 [0f-weekly] marcarStatus falhou:', e.message); }
          }
          await limparAcaoPendente(chatId);
          const { marcarWeeklyRespondida } = require('./weeklyReview');
          await marcarWeeklyRespondida(chatId, `todas_${acao}`);
          const resp = `${acao === 'pinar' ? '📌' : '🗑️'} ${ids.length} sugestões ${novoStatus}.`;
          await addMessage('user', message);
          await addMessage('assistant', resp);
          return resp;
        }

        if (matchPulo) {
          await limparAcaoPendente(chatId);
          // NÃO marca respondida — pulo conta como skip pra weekly_review_log
          const resp = 'Ok, pulei essa semana. Próximo sábado eu volto.';
          await addMessage('user', message);
          await addMessage('assistant', resp);
          return resp;
        }
        // Nenhum match — segue fluxo normal; TTL 5min de acoes_pendentes resolve
      }
    }

    // Passo 0b3: emergência → protocolo 3 passos direto (ANTES do Calendar para não gastar tokens)
    if (isEmergencia(message)) {
      const emergenciaMsg = getModoEmergencia();
      await addMessage('user', message);
      await addMessage('assistant', emergenciaMsg);
      saveToObsidian('thinking', `⚠️ EMERGÊNCIA detectada: "${message}" → Protocolo 3 passos ativado`);
      return emergenciaMsg;
    }

    // Passo 0c-pre: CRM — consulta sobre pessoas
    if (/quem [eé]|informa[çc][oõ]es sobre|contato d[oa]|n[uú]mero d[oa]|como chama|lembra d[oa]|me fala d[oa]/i.test(lower)) {
      const termoMatch = message.match(/(?:quem [eé]|sobre|contato d[oa]|n[uú]mero d[oa]|lembra d[oa]|me fala d[oa])\s+([a-záéíóúâêîôûãõç\s]+)/i);
      if (termoMatch) {
        const termo = termoMatch[1].trim();
        try {
          const pessoas = await buscarPessoaInteligente(termo);
          if (pessoas.length > 0) {
            const resp = pessoas.map(formatarPessoa).join('\n\n');
            await addMessage('user', message);
            await addMessage('assistant', resp);
            return resp;
          }
        } catch(e) {
          console.log('👥 [CRM] Erro na busca:', e.message);
        }
      }
    }

    // Passo 0c: Calendar inteligente (NLP via Claude)
    // Bug #13: erros de Calendar não são engolidos aqui — propagam pro catch-all do think()
    // que diferencia tipo e devolve mensagem específica em vez de "probleminha técnico" genérico.
    console.log(`=== BRAIN RECEBEU: "${message.substring(0, 50)}"`);
    const respostaCalendar = await processarCalendar(message, await getHistory(), chatId);
    if (respostaCalendar !== null) {
      console.log('📅 [CalendarBrain] Resposta interceptada pelo Calendar');
      await addMessage('user', message);
      await addMessage('assistant', respostaCalendar);
      return respostaCalendar;
    }
    console.log('=== PASSOU DO CALENDAR (não é agenda)');

    // Passo 1: analisa
    const analysis = await analyzeMessage(message);
    console.log(`🧠 [Brain] Intenção: ${analysis.intent} | Emoção: ${analysis.emotion}`);

    // Passo 2: escolhe estratégia
    const strategy = chooseStrategy(analysis);
    console.log(`🎯 [Brain] Estratégia: ${strategy.name}`);

    // Passo 2.5: resolução de pessoas mencionadas (lookup, stub se nova, ambiguidade)
    const pessoasInfo = { contextoStr: '', novas: [], ambiguos: [] };
    if (analysis.nomes_mencionados?.length > 0 && !analysis.pessoas_pergunta_sobre) {
      const nomesRecentes = getNomesRecentes(await getHistory(), 3);

      for (const nome of analysis.nomes_mencionados) {
        const matches = await buscarPessoaInteligente(nome);
        if (matches.length === 0) {
          await salvarOuAtualizarPessoa({
            nome,
            notas: `Mencionada em: "${message.substring(0, 100)}"`,
          });
          pessoasInfo.novas.push(nome);
        } else if (matches.length > 1) {
          const recente = matches.find(p =>
            nomesRecentes.some(r => r.toLowerCase() === p.nome.toLowerCase())
          );
          if (!recente) pessoasInfo.ambiguos.push({ nome, opcoes: matches });
          else {
            pessoasInfo.preferidas = pessoasInfo.preferidas || {};
            pessoasInfo.preferidas[nome.toLowerCase()] = recente;
          }
        }
      }

      // Short-circuit em ambiguidade não resolvida pelos últimos 3 turnos
      if (pessoasInfo.ambiguos.length > 0) {
        const a = pessoasInfo.ambiguos[0];
        const opcoes = a.opcoes.map(p => `• ${p.nome} (${p.relacionamento || 'sem relação cadastrada'})`).join('\n');
        const resp = `🤔 Qual <b>${a.nome}</b> você fala?\n\n${opcoes}\n\nMe diz pra eu não confundir.`;
        await addMessage('user', message);
        await addMessage('assistant', resp);
        return resp;
      }

      pessoasInfo.contextoStr = await buildPessoasContextoMensagem(analysis.nomes_mencionados, pessoasInfo.preferidas || {});
      console.log(`👥 [Brain] Pessoas: ${analysis.nomes_mencionados.length} mencionadas, ${pessoasInfo.novas.length} novas`);
    }

    // Passo 3: carrega memória (Supabase + local)
    const memorySummary = await getMemorySummary();

    // Passo 4: gera resposta
    // #19 (Commit B): se a Carol relata que NÃO fez algo (negativa SEM verbo
    // imperativo de Calendar), injeta diretriz determinística pra ARIA não
    // inverter a negação ("não fiz" → "que bom que você fez"). Mesmo predicado do
    // bypass de fato-passado (calendarBrain L534). Custo zero quando não é negativa.
    const ehRelatoNegativo = RE_FATO_PASSADO.test(message) && !RE_VERBO_IMPERATIVO_CALENDAR.test(message);
    const diretrizNegativa = ehRelatoNegativo
      ? 'A Carol está relatando que NÃO fez/não foi a uma atividade. Reflita isso com PRECISÃO — NUNCA responda como se ela tivesse feito (não inverta a negação). Acolha sem culpa, sem cobrança, sem perguntar "por quê", sem emendar pergunta ou próxima ação. Sempre "você". 1 a 2 frases.'
      : '';
    const ariaResponse = await generateResponse(message, analysis, strategy, memorySummary, pessoasInfo, diretrizNegativa);

    // Passo 5: salva na memória (Supabase + local)
    await addMessage('user', message);
    await addMessage('assistant', ariaResponse);

    // Passo 6: processa ações automáticas
    if (analysis.has_task && analysis.task_text) {
      await addTask(analysis.task_text, analysis.urgency === 'high' ? 'alta' : 'média');
      saveToObsidian('task', analysis.task_text, { priority: analysis.urgency === 'high' ? 'alta' : 'média' });
    }
    if (analysis.has_victory && analysis.victory_text) {
      await addVictory(analysis.victory_text);
    }
    if (analysis.energy_mentioned && analysis.energy_level) {
      await updateProfile({ last_energy: analysis.energy_level, last_energy_time: new Date().getHours() + 'h' });
    }

    // Passo 7: salva thinking log no Obsidian
    saveThinkingLog(message, analysis, strategy, ariaResponse);

    // Passo 8: extrai fatos automaticamente (fire-and-forget)
    extrairEsalvarFatos(message, ariaResponse).catch(e => console.log('🧠 Extração async:', e.message));

    // Passo 8.5: memória evolutiva — validador implícito (fire-and-forget)
    // Gerador de hipoteses DECOMISSIONADO (estourou 2x; gerava teoria nao-validada).
    // Dormente por padrao. Auto-aperfeicoamento sera reconstruido como item 5 (schema fechado + humano-no-loop).
    if (process.env.ARIA_GERAR_HIPOTESES === 'on') {
      detectarEPropor(message, ariaResponse, history).catch(e => console.log('🧠 Detector:', e.message));
    }
    validarImplicitamente(message, ariaResponse).catch(e => console.log('🧠 Validador:', e.message));

    // Passo 9: analytics (fire-and-forget)
    registrarEvento('mensagem', { humor: detectarHumor(message), categoria: analysis.intent }).catch(() => {});

    return ariaResponse;

  } catch (error) {
    // Bug #13: log estruturado com tipo, status e cause — para Vercel logs ficarem úteis
    console.error('Erro no Brain:', {
      name: error?.constructor?.name || error?.name,
      message: error?.message,
      status: error?.status,
      type: error?.type,
      cause: error?.cause?.message,
      stack: error?.stack,
    });
    const fallback = classifyBrainError(error);
    await addMessage('user', message).catch(() => {});
    await addMessage('assistant', fallback).catch(() => {});
    return fallback;
  }
}

// Anda a cadeia de .cause procurando erro de CÓDIGO (TypeError/ReferenceError/
// RangeError/SyntaxError) — distingue bug interno (que hoje era mascarado como
// "Calendar não respondeu") de falha real do Google. Viola "nunca mente" dizer
// que o Calendar caiu quando foi o código que quebrou.
function _temCausaDeCodigo(err, depth = 0) {
  if (!err || depth > 5) return false;
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError) return true;
  return _temCausaDeCodigo(err.cause, depth + 1);
}

// Bug #13: roteador puro de erro → fallback. Pure function, fácil de testar.
// Duck-typing (não instanceof) pra ser robusto a versão do SDK Anthropic.
function classifyBrainError(error) {
  const anthropicType = error?.type;
  if (anthropicType === 'invalid_request_error') {
    return 'Carol, API Anthropic retornou invalid_request_error. Saldo zerado? Verifica console.anthropic.com/settings/billing.';
  }
  if (anthropicType === 'authentication_error') {
    return 'Carol, autenticação Anthropic falhou. Verifica ANTHROPIC_API_KEY no Vercel.';
  }
  if (anthropicType === 'rate_limit_error') {
    return 'Carol, rate limit Anthropic. Espera uns segundos.';
  }
  if (anthropicType === 'overloaded_error') {
    return 'Anthropic sobrecarregada agora. Tenta de novo em 1min.';
  }
  if (anthropicType) {
    return `Carol, erro Anthropic ${error?.status || '?'}: ${anthropicType}. Olha o log.`;
  }
  if (error?.name === 'CalendarOperationError' || error?.name === 'CalendarInsertError') {
    if (_temCausaDeCodigo(error.cause)) {
      console.error('[classifyBrainError] ERRO DE CODIGO mascarado como Calendar:', { name: error.cause?.name, message: error.cause?.message, stack: error.cause?.stack });
      return 'Opa — tropecei num erro interno meu agora, não foi o Calendar. Já registrei aqui pra investigar. Tenta de novo daqui a pouco? 💜';
    }
    return '📅 Calendar não respondeu agora. Tenta de novo daqui a pouco.';
  }
  if (error?.code?.startsWith?.('PGRST') || /supabase/i.test(error?.message || '')) {
    return '🗄️ Banco fora do ar. Tenta de novo daqui a pouco.';
  }
  return 'Ei, estou aqui! Tive um probleminha técnico agora. Pode repetir? 💜';
}

// ─────────────────────────────────────────────
// THINK COM IMAGEM — para fotos e documentos visuais
// ─────────────────────────────────────────────
async function thinkWithImage(message, imageContent) {
  try {
    const { SYSTEM_PROMPT, normalizarTratamento } = require('../prompts/system');
    const evolvedAdditions = loadEvolvedPrompt();
    const carolProfile = loadCarolProfile();
    const memorySummary = await getMemorySummary();

    let profileContext = '';
    if (carolProfile) {
      profileContext = `\n━━━ QUEM É A CAROL ━━━\n${carolProfile.profile?.preferred_name || 'Carol'}, ${carolProfile.profile?.profession || 'Arquiteta'}`;
    }

    const now = new Date();
    const agora = getBrtNow(now);
    const blocoAgenda = await blocoAgendaReativo(now);

    const systemWithMemory = `${SYSTEM_PROMPT}
${profileContext}

━━━ MEMÓRIA ATIVA ━━━
${memorySummary || 'Primeira conversa do dia.'}

━━━ APRENDIZADOS DA ARIA ━━━
${evolvedAdditions || 'Sem aprendizados adicionais ainda.'}

━━━ AGORA ━━━
Hora: ${agora.hora} BRT
Dia: ${agora.diaSemana}, ${agora.dataBR}
Período: ${agora.periodo}
Use essa âncora pra qualquer referência temporal (saudações, "hoje", "agora", "ontem"). NUNCA chute período por contexto.
${blocoAgenda ? `\n${blocoAgenda}\n` : ''}
━━━ INSTRUÇÃO ━━━
Carol enviou uma imagem. Analise visualmente e responda de forma útil, conectando com o contexto dela se relevante.`;

    const history = await getHistory();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemWithMemory,
      messages: [
        // Onda 1.7: sanitiza history (mesmo motivo de generateResponse acima).
        ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: message },
          ],
        },
      ],
    });

    const ariaResponse = normalizarTratamento(response.content[0].text);

    // Onda 1.9 Layer 2: detector fire-and-forget de performance de subjetividade
    const { detectarPerformaSubjetividade } = require('./detectarPerformaSubjetividade');
    detectarPerformaSubjetividade(ariaResponse, message, 'brain.thinkWithImage').catch(() => {});

    await addMessage('user', `[Imagem] ${message}`);
    await addMessage('assistant', ariaResponse);

    return ariaResponse;
  } catch (error) {
    console.error('Erro no Brain (imagem):', error.status, error.message);
    console.error('Detalhes:', JSON.stringify(error.error || error.response?.data, null, 2));
    if (error.status === 413) {
      return 'Esse arquivo é grande demais pra eu processar de uma vez. Tenta mandar um menor ou me conta o que tem nele? 💜';
    }
    return 'Recebi seu arquivo mas tive um probleminha técnico. Pode mandar de novo? 💜';
  }
}

module.exports = { think, thinkWithImage, classifyBrainError };