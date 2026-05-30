// (C) Feedbacks reincidentes — bookkeeping PURO.
// Sem imports, sem IO, sem relógio. Só decide insert vs incrementar count.
//
// A detecção semântica (novo vs recorrência) é do LLM da analiseNoturna; aqui
// só planejamos a gravação em memorias categoria 'feedback_aria', honrando a
// instrução LITERAL e repetida da Carol — obediência, não auto-invenção.
//
// A contagem de reincidência vive no campo `contexto` no formato "reincidencia:N".

function lerCount(contexto) {
  const m = /reincidencia:(\d+)/i.exec(contexto || '');
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * @param {object} p
 * @param {object} p.item - { instrucao_canonica, chave_sugerida, match_chave|null }
 * @param {object|null} p.memoriaExistente - linha de memorias já registrada (ou null)
 * @returns {{ acao: 'insert'|'increment', chave: string, valor: string, contexto: string }}
 */
function planejarUpsertFeedback({ item, memoriaExistente }) {
  if (!memoriaExistente) {
    // Primeira vez: insere a instrução LITERAL, count = 1.
    return {
      acao: 'insert',
      chave: item.chave_sugerida,
      valor: item.instrucao_canonica,
      contexto: 'reincidencia:1',
    };
  }

  // Recorrência: incrementa count. Chave estável (= a existente). Valor preserva
  // a instrução literal já registrada — NÃO reescreve.
  const count = lerCount(memoriaExistente.contexto) + 1;
  return {
    acao: 'increment',
    chave: memoriaExistente.chave || item.match_chave || item.chave_sugerida,
    valor: memoriaExistente.valor != null ? memoriaExistente.valor : item.instrucao_canonica,
    contexto: `reincidencia:${count}`,
  };
}

module.exports = { planejarUpsertFeedback };
