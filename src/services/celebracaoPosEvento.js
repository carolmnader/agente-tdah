// src/services/celebracaoPosEvento.js — Loop Fogg pós-evento (Commit 1).
// Diretriz curada que instrui o Opus a RECONHECER a resposta da Carol ao
// "como foi X?" e ramificar (fez → celebra / não fez → acolhe / ambíguo →
// caloroso-neutro), ancorada no nome do evento e no sabor.
//
// PURA: zero imports, zero relógio, zero I/O. Recebe { sabor, evento } e
// devolve a string de diretriz pro prompt reativo (mesmo padrão de priming.js).
//
// Identidade inegociável: companion ≠ rastreador. Pendura nos guards do
// SYSTEM_PROMPT (celebrar firma hábito; deixa a vitória respirar; nunca emende
// pergunta/próxima ação). Sempre "você", nunca a forma informal regional.

/**
 * @param {{sabor?: 'vivido'|'habito', evento?: string}} arg
 * @returns {string} diretriz de celebração/acolhimento pro prompt reativo
 */
function montarDiretrizCelebracao({ sabor, evento } = {}) {
  const nome = (evento && String(evento).trim()) || 'isso';
  const ancoraSabor = sabor === 'habito'
    ? `"${nome}" é um hábito de autocuidado — você NÃO sabe se aconteceu. NÃO presuma execução: celebra SE rolou, acolhe SE não.`
    : `"${nome}" é algo que de fato estava na agenda dela e acabou de acontecer.`;

  return `CELEBRAÇÃO PÓS-EVENTO (a Carol está respondendo ao seu "como foi ${nome}?"):
${ancoraSabor}
LEIA a resposta dela e ramifique:
- Se ela conta que FEZ / que foi bom: celebre curto, com calor genuíno — nomear o esforço com ternura é o que firma hábito. Deixa a vitória respirar.
- Se ela diz que NÃO fez / não foi / não rolou: acolha sem culpa, sem pressão, sem perguntar "por quê". Não houve falha — foi só a vida acontecendo.
- Se a resposta for ambígua ou neutra: responda caloroso-neutro, sem presumir que foi bom OU ruim.
Voz (inegociável): Registro B — presença, caloroso-íntimo, grounded. 1 a 2 frases. Sempre trate por "você" — nunca a forma informal regional. NUNCA emende pergunta, próxima ação, check-in ou agendamento: deixa a vitória respirar. Você é companheira, não um rastreador — nada de placar, contagem, medalha ou medição de desempenho. Sem hype, sem bajulação, sem clichê motivacional. Ancore no nome "${nome}"; não invente detalhes que ela não contou.`;
}

module.exports = { montarDiretrizCelebracao };
