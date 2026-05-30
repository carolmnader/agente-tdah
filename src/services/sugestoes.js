// Auto-aperfeiçoamento Nível 2 — sugestões arquiteturais sobre A ARIA.
// Tabela `sugestoes_arquiteturais` (migration: create_sugestoes_arquiteturais).

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CATEGORIAS_VALIDAS = ['feature', 'bug', 'refactor', 'voice_calibration'];
// Bug G família removeu CHECK constraint do banco (19/05/2026) — lista
// canônica vive aqui no código. 'pinada'/'arquivada' adicionados pra Weekly
// Review (Onda 1.5).
const STATUS_VALIDOS = ['proposta', 'aceita', 'rejeitada', 'implementada', 'pinada', 'arquivada'];

async function proporSugestao({ titulo, descricao, categoria, prioridade = 3, confianca = 0.5, origem, contexto = {} }) {
  if (!titulo || !descricao || !categoria || !origem) {
    throw new Error('proporSugestao: titulo, descricao, categoria e origem são obrigatórios');
  }
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .insert({ titulo, descricao, categoria, prioridade, confianca, origem, contexto })
    .select('*')
    .single();
  if (error) throw new Error(`proporSugestao: ${error.message}`);
  return data;
}

async function listarSugestoesAbertas(limite = 10) {
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .select('*')
    .eq('status', 'proposta')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`listarSugestoesAbertas: ${error.message}`);
  return data || [];
}

async function marcarStatus(id, novoStatus) {
  if (!STATUS_VALIDOS.includes(novoStatus)) {
    throw new Error(`marcarStatus: status inválido (${novoStatus})`);
  }
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .update({ status: novoStatus })
    .eq('id', id)
    .select('id, status')
    .single();
  if (error) throw new Error(`marcarStatus: ${error.message}`);
  return data;
}

/**
 * Busca sugestões com status='proposta' criadas nos últimos `diasAtras` dias.
 * Diferente de listarSugestoesAbertas (sem janela), aplica filtro temporal
 * para o Weekly Review enxergar só o que apareceu na semana corrente.
 * @param {number} diasAtras - janela em dias (default 7)
 * @returns {Promise<Array<{id, titulo, descricao, confianca, categoria, prioridade}>>}
 */
async function buscarPropostaJanela(diasAtras = 7) {
  const desde = new Date(Date.now() - diasAtras * 86400000).toISOString();
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .select('id, titulo, descricao, confianca, categoria, prioridade')
    .eq('status', 'proposta')
    .gte('created_at', desde)
    .order('confianca', { ascending: false })
    .limit(10);
  if (error) throw new Error(`buscarPropostaJanela: ${error.message}`);
  return data || [];
}

/**
 * Busca sugestões com status='pinada'. Retorna campo derivado
 * weeks_since_pinned (semanas desde created_at). Usado pra D5: pinada
 * >6 semanas ARIA só nomeia gentil no Pin Board do Weekly Review.
 * @returns {Promise<Array<{id, titulo, descricao, confianca, weeks_since_pinned}>>}
 */
async function buscarPinadas() {
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .select('id, titulo, descricao, confianca, created_at')
    .eq('status', 'pinada')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`buscarPinadas: ${error.message}`);
  const agora = Date.now();
  return (data || []).map(s => ({
    id: s.id,
    titulo: s.titulo,
    descricao: s.descricao,
    confianca: s.confianca,
    weeks_since_pinned: Math.floor((agora - new Date(s.created_at).getTime()) / (7 * 86400000))
  }));
}

/**
 * Busca sugestão única pelo ID. Usado pelo handler 0f-weekly em brain.js
 * pra expandir "3 ler" — Carol pede detalhe completo no chat.
 * @param {number} id
 * @returns {Promise<{id, titulo, descricao, confianca, categoria, prioridade}>}
 */
async function buscarSugestaoPorId(id) {
  const { data, error } = await supabase
    .from('sugestoes_arquiteturais')
    .select('id, titulo, descricao, confianca, categoria, prioridade')
    .eq('id', id)
    .single();
  if (error) throw new Error(`buscarSugestaoPorId: ${error.message}`);
  return data;
}

module.exports = {
  proporSugestao,
  listarSugestoesAbertas,
  marcarStatus,
  buscarPropostaJanela,
  buscarPinadas,
  buscarSugestaoPorId,
};
