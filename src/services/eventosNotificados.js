const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Tenta marcar evento como notificado. Retorna true se foi a 1a vez (deve notificar),
 * false se já estava marcado (NÃO deve notificar).
 * Usa INSERT ... ON CONFLICT DO NOTHING — atômico, sem race conditions.
 */
async function tentarMarcarNotificado(eventoId, tipo = 'pre_evento_30min') {
  if (!eventoId) {
    console.log('⚠️ tentarMarcarNotificado: eventoId vazio, retornando false');
    return false;
  }

  const { data, error } = await supabase
    .from('eventos_notificados')
    .insert({ evento_id: eventoId, tipo_notificacao: tipo })
    .select()
    .maybeSingle();

  if (error) {
    // Conflito (PK duplicada) = já notificado
    if (error.code === '23505') return false;
    console.error('🚨 tentarMarcarNotificado erro:', error.message);
    return false; // Em caso de erro, NÃO notifica (failsafe seguro)
  }

  return !!data; // Se inseriu, é primeira vez
}

/**
 * Verifica se evento ja foi notificado, sem inserir.
 * Use ANTES de tentar enviar a notificacao (check-then-act).
 */
async function jaNotificado(eventoId, tipo = 'pre_evento_30min') {
  if (!eventoId) return false;
  const { data, error } = await supabase
    .from('eventos_notificados')
    .select('evento_id')
    .eq('evento_id', eventoId)
    .eq('tipo_notificacao', tipo)
    .maybeSingle();
  if (error) {
    console.error('[eventosNotificados] jaNotificado erro:', { code: error.code, message: error.message });
    return false; // failsafe: prefere enviar 2x a nao enviar
  }
  return !!data;
}

/**
 * Marca evento como notificado. Use APOS envio bem-sucedido.
 * Retorna true se inseriu OU se ja existia (PK conflict = race tratada como sucesso).
 */
async function marcarNotificado(eventoId, tipo = 'pre_evento_30min') {
  if (!eventoId) return false;
  const { data, error } = await supabase
    .from('eventos_notificados')
    .insert({ evento_id: eventoId, tipo_notificacao: tipo })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return true; // PK conflict = ja notificado (race), ok
    console.error('[eventosNotificados] marcarNotificado erro:', { code: error.code, message: error.message });
    return false;
  }
  return !!data;
}

/**
 * Limpeza diária: remove registros > 48h.
 */
async function limparAntigos() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('eventos_notificados')
    .delete({ count: 'exact' })
    .lt('notificado_em', cutoff);

  if (error) {
    console.error('🚨 limparAntigos erro:', error.message);
    return 0;
  }
  return count || 0;
}

/**
 * Conta notificações de um tipo enviadas HOJE (início do dia em BRT = UTC-3,
 * sem horário de verão no Brasil desde 2019). Coluna real = notificado_em
 * (não há created_at nesta tabela). Em ERRO → 0 (leitura falha não cala a ARIA).
 */
async function contarNotificadosHoje(tipo) {
  try {
    const agoraBRT = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const inicioDiaBRT = new Date(Date.UTC(
      agoraBRT.getUTCFullYear(), agoraBRT.getUTCMonth(), agoraBRT.getUTCDate(), 3, 0, 0
    )); // 00:00 BRT = 03:00 UTC daquele dia
    const { count, error } = await supabase
      .from('eventos_notificados')
      .select('evento_id', { count: 'exact', head: true })
      .eq('tipo_notificacao', tipo)
      .gte('notificado_em', inicioDiaBRT.toISOString());
    if (error) {
      console.error('[eventosNotificados] contarNotificadosHoje erro:', { code: error.code, message: error.message });
      return 0;
    }
    return count || 0;
  } catch (e) {
    console.error('[eventosNotificados] contarNotificadosHoje exceção:', e.message);
    return 0;
  }
}

module.exports = { tentarMarcarNotificado, jaNotificado, marcarNotificado, limparAntigos, contarNotificadosHoje };
