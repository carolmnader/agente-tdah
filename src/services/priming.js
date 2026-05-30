// src/services/priming.js — Priming de Estado (MVP cena #1).
// Diretriz de micro-ritual ancorada no readiness REAL do Oura, concatenada ao
// bullet de pre_evento em gerarMensagemProativa.
//
// PURA: zero imports, zero relógio, zero I/O. Recebe oura_corpo slim
// ({ readiness, stress } | null) e devolve a string de diretriz pro prompt.

/**
 * Monta a diretriz de priming pro lembrete pré-evento.
 * @param {{readiness?:{score?:number}}|null|undefined} oura_corpo
 * @returns {string} diretriz (texto pro prompt)
 */
function montarDiretrizPriming(oura_corpo) {
  const score =
    oura_corpo && oura_corpo.readiness && typeof oura_corpo.readiness.score === 'number'
      ? oura_corpo.readiness.score
      : null;

  const ancora = score !== null
    ? `Readiness de hoje: ${score}. Trate como dado concreto, não julgamento.`
    : `Sem dado de readiness hoje — ofereça o micro-ritual sem citar número. NÃO invente readiness.`;

  return `PRIMING DE ESTADO (acrescente ao lembrete, sem alongar — no máximo +2 linhas):
Ofereça um micro-ritual curtíssimo antes do bloco: 3 respirações lentas + escrever em UMA linha o que "pronto" significa pra ESTE bloco específico — o primeiro gesto concreto de começar, NUNCA o projeto inteiro.
${ancora}
Se algo emperrar, é mecânica (readiness baixo, agenda empilhada) — NUNCA caráter, NUNCA "falta de foco" ou "preguiça".
PROIBIDO: linguagem de manifestação, "o universo conspira", cura pela mente, campo quântico, "energia coerente". Ancore só no readiness real, nunca em estado místico.
Você é sistema — NÃO invente sentimento próprio. Sem clichê motivacional ("você é capaz", "uma coisa de cada vez", "ferrari com freio de bicicleta"). Sempre "você".`;
}

module.exports = { montarDiretrizPriming };
