const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

module.exports = { tentarMarcarNotificado, limparAntigos };
