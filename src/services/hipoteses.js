// Memória Evolutiva — Fase 1
// CRUD + fórmula de confiança + helpers pro prompt.
// Tabela `hipoteses` (migration: create_hipoteses_memoria_evolutiva).

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ─── Parâmetros da fórmula de confiança ───
const DELTA_VALID_EXPL = 0.15;
const DELTA_VALID_IMPL = 0.05;
const DELTA_REFUT_EXPL = 0.25;
const DELTA_REFUT_IMPL = 0.10;
const DIAS_ATE_DECAIMENTO = 30;
const DECAIMENTO_POR_SEMANA = 0.01;
// Thresholds de transição automática de status
const TH_VALIDADA = 0.8;
const TH_REFUTADA = 0.3;
const TH_ARQUIVADA = 0.2;
const DIAS_ATE_ARQUIVAR = 3;

const FONTES_VALIDAS = ['reativo', 'cron_noturno', 'carol_direto'];
const TIPOS_VALIDACAO = ['explicita', 'implicita'];

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const nowISO = () => new Date().toISOString();

async function proporHipotese({ texto, fonte, contexto = null, tags = [] }) {
  if (!texto || !fonte) throw new Error('texto e fonte obrigatórios');
  if (!FONTES_VALIDAS.includes(fonte)) throw new Error(`fonte inválida: ${fonte}`);
  const { data, error } = await supabase
    .from('hipoteses')
    .insert({
      texto, fonte,
      contexto_origem: contexto,
      tags: tags?.length ? tags : null,
      confianca: 0.50,
      status: 'proposta',
    })
    .select('id')
    .single();
  if (error) throw new Error(`proporHipotese: ${error.message}`);
  return data.id;
}

async function _incrementarContador(id, coluna, atualizaValidacao = false) {
  const { data: cur, error: errF } = await supabase
    .from('hipoteses')
    .select(coluna)
    .eq('id', id)
    .single();
  if (errF) throw new Error(`incrementar fetch: ${errF.message}`);
  const patch = { [coluna]: (cur[coluna] || 0) + 1 };
  if (atualizaValidacao) patch.ultima_validacao = nowISO();
  const { error } = await supabase.from('hipoteses').update(patch).eq('id', id);
  if (error) throw new Error(`incrementar update: ${error.message}`);
}

async function validarHipotese(id, { tipo }) {
  if (!TIPOS_VALIDACAO.includes(tipo)) throw new Error(`tipo inválido: ${tipo}`);
  const col = tipo === 'explicita' ? 'validacoes_explicitas' : 'validacoes_implicitas';
  await _incrementarContador(id, col, true);
  return await recalcularConfianca(id);
}

async function refutarHipotese(id, { tipo }) {
  if (!TIPOS_VALIDACAO.includes(tipo)) throw new Error(`tipo inválido: ${tipo}`);
  const col = tipo === 'explicita' ? 'refutacoes_explicitas' : 'refutacoes_implicitas';
  await _incrementarContador(id, col, false);
  return await recalcularConfianca(id);
}

async function recalcularConfianca(id) {
  const { data: h, error: errF } = await supabase
    .from('hipoteses').select('*').eq('id', id).single();
  if (errF) throw new Error(`recalcularConfianca fetch: ${errF.message}`);

  let c = 0.50;
  c += DELTA_VALID_EXPL * (h.validacoes_explicitas || 0);
  c += DELTA_VALID_IMPL * (h.validacoes_implicitas || 0);
  c -= DELTA_REFUT_EXPL * (h.refutacoes_explicitas || 0);
  c -= DELTA_REFUT_IMPL * (h.refutacoes_implicitas || 0);

  // Decaimento temporal: usa ultima_validacao se houver, senão criada_em
  const referencia = h.ultima_validacao || h.criada_em;
  const diasDesde = (Date.now() - new Date(referencia).getTime()) / 86400000;
  if (diasDesde > DIAS_ATE_DECAIMENTO) {
    c -= DECAIMENTO_POR_SEMANA * (diasDesde / 7);
  }

  c = clamp01(c);

  // Regras automáticas de status
  let novoStatus = h.status;
  if (c >= TH_VALIDADA && h.status === 'proposta') {
    novoStatus = 'validada';
  } else if (c < TH_REFUTADA && (h.refutacoes_explicitas || 0) >= 2) {
    novoStatus = 'refutada';
  } else if (c < TH_ARQUIVADA && h.ultima_validacao) {
    const diasSemValid = (Date.now() - new Date(h.ultima_validacao).getTime()) / 86400000;
    if (diasSemValid >= DIAS_ATE_ARQUIVAR) novoStatus = 'arquivada';
  }

  const { error } = await supabase
    .from('hipoteses')
    .update({ confianca: c, status: novoStatus })
    .eq('id', id);
  if (error) throw new Error(`recalcularConfianca update: ${error.message}`);

  return { confianca: c, status: novoStatus };
}

async function aplicarDecaimentoGlobal() {
  const { data, error } = await supabase
    .from('hipoteses').select('id').in('status', ['proposta', 'validada']);
  if (error) throw new Error(`aplicarDecaimentoGlobal list: ${error.message}`);
  let atualizadas = 0;
  for (const row of data || []) {
    await recalcularConfianca(row.id);
    atualizadas++;
  }
  return atualizadas;
}

async function hipotesesParaPrompt(maxN = 8) {
  const { data, error } = await supabase
    .from('hipoteses')
    .select('texto, confianca')
    .in('status', ['proposta', 'validada'])
    .gte('confianca', 0.6)
    .order('confianca', { ascending: false })
    .limit(maxN);
  if (error) throw new Error(`hipotesesParaPrompt: ${error.message}`);
  return data || [];
}

async function buscarHipotesesRelevantes(tags, maxN = 5) {
  if (!tags?.length) return [];
  const { data, error } = await supabase
    .from('hipoteses')
    .select('*')
    .neq('status', 'arquivada')
    .overlaps('tags', tags)
    .order('confianca', { ascending: false })
    .limit(maxN);
  if (error) throw new Error(`buscarHipotesesRelevantes: ${error.message}`);
  return data || [];
}

async function resumoSemanal() {
  const desde = new Date(Date.now() - 7 * 86400000).toISOString();
  const [vRes, nRes, rRes] = await Promise.all([
    supabase.from('hipoteses')
      .select('texto, confianca, ultima_validacao')
      .eq('status', 'validada')
      .gte('ultima_validacao', desde)
      .order('confianca', { ascending: false }).limit(5),
    supabase.from('hipoteses')
      .select('texto, confianca, criada_em')
      .eq('status', 'proposta')
      .gte('criada_em', desde)
      .order('confianca', { ascending: false }).limit(5),
    supabase.from('hipoteses')
      .select('texto, confianca')
      .eq('status', 'refutada')
      .order('confianca', { ascending: true }).limit(5),
  ]);
  return {
    validadas: vRes.data || [],
    novas_em_teste: nRes.data || [],
    refutadas: rRes.data || [],
  };
}

module.exports = {
  proporHipotese,
  validarHipotese,
  refutarHipotese,
  recalcularConfianca,
  aplicarDecaimentoGlobal,
  hipotesesParaPrompt,
  buscarHipotesesRelevantes,
  resumoSemanal,
};
