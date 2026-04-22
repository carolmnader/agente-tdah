// Auto-aperfeiçoamento Nível 2 — sugestões arquiteturais sobre A ARIA.
// Tabela `sugestoes_arquiteturais` (migration: create_sugestoes_arquiteturais).

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CATEGORIAS_VALIDAS = ['feature', 'bug', 'refactor', 'voice_calibration'];
const STATUS_VALIDOS = ['proposta', 'aceita', 'rejeitada', 'implementada'];

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

module.exports = {
  proporSugestao,
  listarSugestoesAbertas,
  marcarStatus,
};
