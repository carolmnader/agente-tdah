// ─────────────────────────────────────────────
// CONTEXTO HOLÍSTICO — Injeta ayurveda + lua + estado emocional no prompt
// ─────────────────────────────────────────────

const { getContextoAyurveda } = require('../modules/ayurveda');
const { getRespostaACT, getRespostaIFS } = require('../modules/holistic');

function buildHolisticContext({ lua, checkin, agora }) {
  const ayurveda = getContextoAyurveda();
  const hora = agora ? new Date(agora).getHours() : new Date().getHours();

  let contexto = `
━━━ CONTEXTO HOLÍSTICO ━━━

🕐 AYURVEDA (${ayurveda.bloco.nome} — ${hora}h):
${ayurveda.bloco.descricao}
Energia do momento: ${ayurveda.estrategia.energia}
Riscos TDAH agora: ${ayurveda.estrategia.riscos.join(', ')}
Estratégia recomendada: ${ayurveda.estrategia.estrategias[0]}
⚠️ ${ayurveda.estrategia.alerta_tdah}`;

  if (lua) {
    contexto += `

${lua.emoji} LUA (${lua.fase} — dia ${lua.dia_ciclo} do ciclo):
${lua.mensagem_tdah}
Energia lunar: ${lua.energia}`;
  }

  if (checkin) {
    contexto += `

💛 CHECK-IN DA CAROL:
Estado geral: ${checkin.estado} (média ${checkin.media.toFixed(1)}/5)
Ponto forte: ${checkin.maior.dimensao} (${checkin.maior.valor}/5)
Precisa de atenção: ${checkin.menor.dimensao} (${checkin.menor.valor}/5)`;

    if (checkin.recomendacoes.length > 0) {
      contexto += `\nRecomendações: ${checkin.recomendacoes.join(' | ')}`;
    }
  }

  contexto += `

CRONOBIOLOGIA VATA + TDAH:
${ayurveda.cronobiologia.alerta}`;

  return contexto;
}

function buildBloqueioContext() {
  const actResponse = getRespostaACT('paralysis');
  const ifsResponse = getRespostaIFS('protetor');

  return `
━━━ CAROL ESTÁ TRAVADA — PROTOCOLO DESBLOQUEIO ━━━

🧠 ACT (Aceitação e Compromisso):
${actResponse}

💛 IFS (Partes Internas):
${ifsResponse}

INSTRUÇÃO ESPECIAL:
- NÃO dê lista de tarefas
- NÃO pergunte "o que você precisa fazer"
- Valide primeiro, depois ofereça UMA micro-ação
- Use linguagem suave e acolhedora
- Se Carol mencionar parte crítica/cobrança, use abordagem IFS
- Se Carol parecer dissociada/desligada, use grounding (5 sentidos)`;
}

module.exports = { buildHolisticContext, buildBloqueioContext };
