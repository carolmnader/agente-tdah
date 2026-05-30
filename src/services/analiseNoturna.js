// Memória Evolutiva Fase 3 — Orquestrador da análise noturna
// Coleta dados das últimas 24h (msgs + humor + eventos + hipóteses cadastradas)
// e delega ao prompt dedicado em src/prompts/analiseNoturna.js.

const { createClient } = require('@supabase/supabase-js');
const { chamarAnaliseNoturna } = require('../prompts/analiseNoturna');
const { hipotesesParaPrompt } = require('./hipoteses');
const { buscarMemorias } = require('./memorySupabase');
const { listarEventosHoje } = require('../integrations/calendar');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function buscarMensagens24h() {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('mensagens')
    .select('role, content, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true });
  if (!data?.length) return null;
  return data.map(m => `[${m.role}] ${(m.content || '').substring(0, 200)}`).join('\n');
}

async function buscarHumor3dias() {
  const desde = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('humor_log')
    .select('humor, energia, contexto, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true });
  if (!data?.length) return null;
  return data.map(h => `${h.created_at?.substring(0, 10)} ${h.humor}${h.energia ? ` (energia ${h.energia})` : ''}`).join('\n');
}

async function buscarEventosHoje() {
  try {
    const txt = await listarEventosHoje();
    return txt.replace(/<[^>]*>/g, '').substring(0, 800);
  } catch {
    return null;
  }
}

async function buscarHipotesesCadastradas() {
  const todas = await hipotesesParaPrompt(20, 0).catch(() => []);
  if (!todas.length) return null;
  return todas.map(h => `- ${h.texto} (conf: ${parseFloat(h.confianca).toFixed(2)})`).join('\n');
}

async function buscarFeedbacksAriaExistentes() {
  const data = await buscarMemorias('feedback_aria', 20).catch(() => []);
  if (!data?.length) return null;
  return data
    .map(m => `- [${m.chave}] ${m.valor} (${m.contexto || 'reincidencia:1'})`)
    .join('\n');
}

async function analisarNoturno() {
  const [mensagens, humor, eventos, hipotesesExistentes, feedbacksAriaExistentes] = await Promise.all([
    buscarMensagens24h(),
    buscarHumor3dias(),
    buscarEventosHoje(),
    buscarHipotesesCadastradas(),
    buscarFeedbacksAriaExistentes(),
  ]);
  return await chamarAnaliseNoturna({ mensagens, humor, eventos, hipotesesExistentes, feedbacksAriaExistentes });
}

module.exports = {
  analisarNoturno,
  buscarMensagens24h,
  buscarHumor3dias,
  buscarEventosHoje,
  buscarHipotesesCadastradas,
  buscarFeedbacksAriaExistentes,
};
