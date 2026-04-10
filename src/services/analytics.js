const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { getFaseLunarLocal } = require('../integrations/astrology');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const USER_ID = 'carol';

// ── Registro de eventos ───────────────────────────────────────────────────────

const registrarEvento = async (tipo, extras = {}) => {
  try {
    const agora = new Date();
    const lua = getFaseLunarLocal(agora);
    await supabase.from('analytics_eventos').insert({
      user_id: USER_ID,
      tipo,
      categoria: extras.categoria || null,
      hora_do_dia: agora.getHours(),
      dia_da_semana: agora.getDay(),
      humor: extras.humor || null,
      fase_lunar: lua.energia,
      duracao_segundos: extras.duracao || null,
      metadados: extras.metadados || null,
    });
  } catch(e) {
    // Silencioso — analytics nunca deve quebrar o fluxo principal
  }
};

// ── Busca de dados para análise ───────────────────────────────────────────────

const buscarDadosAnalise = async (dias = 30) => {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  const [eventos, mensagens, tarefas, humores] = await Promise.all([
    supabase.from('analytics_eventos').select('*').eq('user_id', USER_ID).gte('criado_em', desde),
    supabase.from('mensagens').select('role, humor, intent, created_at').gte('created_at', desde),
    supabase.from('tarefas').select('titulo, categoria, status, criado_em, concluida_em').eq('user_id', USER_ID).gte('criado_em', desde),
    supabase.from('humor_log').select('humor, created_at').gte('created_at', desde),
  ]);

  return {
    eventos: eventos.data || [],
    mensagens: mensagens.data || [],
    tarefas: tarefas.data || [],
    humores: humores.data || [],
  };
};

// ── Análise de padrões ────────────────────────────────────────────────────────

const analisarPadroes = async (dias = 30) => {
  const dados = await buscarDadosAnalise(dias);
  const { eventos, mensagens, tarefas, humores } = dados;

  const totalMensagensUser = mensagens.filter(c => c.role === 'user').length;
  if (totalMensagensUser < 5) return null; // Dados insuficientes

  // Padrão 1: Horários de maior uso
  const porHora = Array(24).fill(0);
  mensagens.filter(c => c.role === 'user').forEach(c => {
    const hora = new Date(c.created_at).getHours();
    porHora[hora]++;
  });
  const horasPico = porHora
    .map((count, hora) => ({ hora, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Padrão 2: Humor por dia da semana
  const humorPorDia = {};
  const diasNome = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  humores.forEach(h => {
    const dia = new Date(h.created_at).getDay();
    if (!humorPorDia[dia]) humorPorDia[dia] = [];
    humorPorDia[dia].push(h.humor);
  });

  // Padrão 3: Taxa de conclusão de tarefas
  const tarefasCriadas = tarefas.length;
  const tarefasConcluidas = tarefas.filter(t => t.status === 'concluida').length;
  const taxaConclusao = tarefasCriadas > 0 ? Math.round((tarefasConcluidas / tarefasCriadas) * 100) : 0;

  // Padrão 4: Categorias de tarefas não concluídas
  const naoConcluidasPorCategoria = {};
  tarefas.filter(t => t.status === 'pendente').forEach(t => {
    const cat = t.categoria || 'sem categoria';
    naoConcluidasPorCategoria[cat] = (naoConcluidasPorCategoria[cat] || 0) + 1;
  });

  // Padrão 5: Humor mais frequente
  const todosHumores = humores.map(h => h.humor);
  const frequenciaHumor = {};
  todosHumores.forEach(h => frequenciaHumor[h] = (frequenciaHumor[h] || 0) + 1);
  const humorDominante = Object.entries(frequenciaHumor).sort((a,b) => b[1]-a[1])[0] || null;

  // Padrão 6: Eventos analytics
  const eventosPorTipo = {};
  eventos.forEach(e => {
    eventosPorTipo[e.tipo] = (eventosPorTipo[e.tipo] || 0) + 1;
  });

  return {
    periodo_dias: dias,
    total_mensagens: totalMensagensUser,
    horas_pico: horasPico,
    humor_por_dia: humorPorDia,
    taxa_conclusao_tarefas: taxaConclusao,
    tarefas_criadas: tarefasCriadas,
    tarefas_concluidas: tarefasConcluidas,
    nao_concluidas_por_categoria: naoConcluidasPorCategoria,
    humor_dominante: humorDominante,
    eventos_por_tipo: eventosPorTipo,
    dias_semana_nomes: diasNome,
  };
};

// ── Gera relatório com Claude ─────────────────────────────────────────────────

const gerarRelatorioIA = async (padroes, tipo = 'semanal') => {
  if (!padroes) return '📊 Ainda estou coletando dados! Preciso de pelo menos 1 semana de conversas para identificar padrões.';

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Você é a ARIA analisando os padrões de comportamento da Carol com TDAH.

DADOS DOS ÚLTIMOS ${padroes.periodo_dias} DIAS:
${JSON.stringify(padroes, null, 2)}

Gere um relatório ${tipo} para o Telegram com:

1. 2-3 INSIGHTS mais importantes (padrões que Carol provavelmente não percebe)
2. 1 VITÓRIA para celebrar (algo positivo nos dados)
3. 1 SUGESTÃO específica e pequena para melhorar

REGRAS:
- Use HTML do Telegram: <b>negrito</b>, <i>itálico</i>
- Seja calorosa, específica e sem julgamento
- Cite números reais dos dados
- Máximo 25 linhas
- Tom de amiga inteligente que te conhece bem
- Termine com uma pergunta ou ação

Gere APENAS o relatório, sem explicações extras.`
    }]
  });

  return resp.content[0].text;
};

const gerarRelatorioSemanal = async () => {
  const padroes = await analisarPadroes(7);
  return await gerarRelatorioIA(padroes, 'semanal');
};

const gerarRelatorioMensal = async () => {
  const padroes = await analisarPadroes(30);
  return await gerarRelatorioIA(padroes, 'mensal');
};

// ── Insight rápido do dia ─────────────────────────────────────────────────────

const gerarInsightRapido = async () => {
  try {
    const padroes = await analisarPadroes(14);
    if (!padroes || padroes.total_mensagens < 5) return null;

    const agora = new Date();
    const horaAtual = agora.getHours();
    const diaAtual = agora.getDay();
    const diasNome = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    // Verifica se hoje é um dia problemático
    const humorHoje = padroes.humor_por_dia[diaAtual] || [];
    const ansiedadeHoje = humorHoje.filter(h => h === 'ansiosa').length;
    const totalHoje = humorHoje.length;
    const proporcaoAnsiedade = totalHoje > 0 ? ansiedadeHoje / totalHoje : 0;

    if (proporcaoAnsiedade > 0.5 && totalHoje >= 3) {
      return `💡 <b>Padrão detectado:</b> ${diasNome[diaAtual]}s costumam ser mais ansiosos para você. Que tal deixar a agenda mais leve hoje?`;
    }

    // Verifica se está no horário de pico
    const estaNoPico = padroes.horas_pico.some(h => Math.abs(h.hora - horaAtual) <= 1);
    if (estaNoPico) {
      return `⚡ <b>Você está no seu horário de pico!</b> Das ${horaAtual}h você costuma estar mais focada. Quer proteger essa janela?`;
    }

    return null;
  } catch(e) {
    return null;
  }
};

module.exports = {
  registrarEvento,
  analisarPadroes,
  gerarRelatorioSemanal,
  gerarRelatorioMensal,
  gerarInsightRapido,
};
