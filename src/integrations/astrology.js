// ─────────────────────────────────────────────
// ASTROLOGIA — Fase lunar local + RapidAPI fallback
// Ciclo sinódico: 29.53 dias desde lua nova referência 2000-01-06
// ─────────────────────────────────────────────

const FASES = [
  {
    nome: 'Lua Nova',
    emoji: '🌑',
    inicio: 0,
    fim: 3.69,
    mensagem_tdah: 'Lua Nova: momento de plantar sementes. Não force produtividade — planeje e sonhe.',
    energia: 'introspecção',
    dica: 'Boa hora para brain dump e definir intenções. Sem pressão de executar.',
  },
  {
    nome: 'Lua Crescente',
    emoji: '🌒',
    inicio: 3.69,
    fim: 7.38,
    mensagem_tdah: 'Crescente: energia começando a subir. Inicie aquele projeto que tá na gaveta — pequenos passos.',
    energia: 'construção',
    dica: 'Comece coisas novas. Quebre em micro-tarefas e vá fazendo.',
  },
  {
    nome: 'Quarto Crescente',
    emoji: '🌓',
    inicio: 7.38,
    fim: 11.07,
    mensagem_tdah: 'Quarto Crescente: hora de agir e ajustar. Se algo não tá funcionando, mude a abordagem.',
    energia: 'ação',
    dica: 'Tome decisões. Enfrente os obstáculos. Energia de fazer acontecer.',
  },
  {
    nome: 'Gibosa Crescente',
    emoji: '🌔',
    inicio: 11.07,
    fim: 14.76,
    mensagem_tdah: 'Gibosa: refine e ajuste. A energia tá subindo pro pico — aproveite o foco.',
    energia: 'refinamento',
    dica: 'Polir projetos, revisar, melhorar. Boa fase para detalhes.',
  },
  {
    nome: 'Lua Cheia',
    emoji: '🌕',
    inicio: 14.76,
    fim: 18.46,
    mensagem_tdah: '⚠️ Lua Cheia: energia intensa! Possível agitação, hiperfoco ou insônia. Cuidado com impulsividade.',
    energia: 'pico',
    dica: 'Celebre conquistas. CUIDADO: emoções amplificadas + TDAH = decisões impulsivas. Respire antes de agir.',
  },
  {
    nome: 'Gibosa Minguante',
    emoji: '🌖',
    inicio: 18.46,
    fim: 22.15,
    mensagem_tdah: 'Gibosa Minguante: hora de compartilhar e agradecer. Revise suas vitórias da semana.',
    energia: 'gratidão',
    dica: 'Compartilhe o que aprendeu. Ensinar é a melhor forma de aprender.',
  },
  {
    nome: 'Quarto Minguante',
    emoji: '🌗',
    inicio: 22.15,
    fim: 25.84,
    mensagem_tdah: 'Quarto Minguante: solte o que não serve mais. Limpe gavetas, delete apps, feche abas.',
    energia: 'release',
    dica: 'Desapegar. Fechar ciclos. Limpar espaço físico e mental.',
  },
  {
    nome: 'Lua Balsâmica',
    emoji: '🌘',
    inicio: 25.84,
    fim: 29.53,
    mensagem_tdah: 'Lua Balsâmica: descanso profundo. Seu cérebro TDAH precisa recarregar. Sem culpa.',
    energia: 'descanso',
    dica: 'Descanse. Medite. Durma mais. Prepare-se para o novo ciclo.',
  },
];

// Referência: Lua Nova em 6 de janeiro de 2000 às 18:14 UTC
const LUA_NOVA_REF = new Date('2000-01-06T18:14:00Z').getTime();
const CICLO_SINODICO = 29.53058867; // dias

function getFaseLunarLocal(data = null) {
  const agora = data ? new Date(data).getTime() : Date.now();
  const diasDesdeRef = (agora - LUA_NOVA_REF) / (1000 * 60 * 60 * 24);
  const diaNoCiclo = ((diasDesdeRef % CICLO_SINODICO) + CICLO_SINODICO) % CICLO_SINODICO;

  const fase = FASES.find(f => diaNoCiclo >= f.inicio && diaNoCiclo < f.fim) || FASES[0];

  return {
    fase: fase.nome,
    emoji: fase.emoji,
    dia_ciclo: Math.round(diaNoCiclo * 10) / 10,
    mensagem_tdah: fase.mensagem_tdah,
    energia: fase.energia,
    dica: fase.dica,
    fonte: 'calculo_local',
  };
}

async function getFaseLunarAPI() {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;

  try {
    const response = await fetch('https://moon-phase.p.rapidapi.com/advanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': key,
        'x-rapidapi-host': 'moon-phase.p.rapidapi.com',
      },
      body: JSON.stringify({
        style: { moonStyle: 'default', backgroundStyle: 'solid' },
        observer: { latitude: -23.55, longitude: -46.63, date: new Date().toISOString().split('T')[0] },
        view: { type: 'landscape-simple' },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch {
    return null;
  }
}

async function getFaseLunar(data = null) {
  // Tenta API se key existir
  if (process.env.RAPIDAPI_KEY && !data) {
    const apiResult = await getFaseLunarAPI();
    if (apiResult?.moonInfo?.phase) {
      const phaseName = apiResult.moonInfo.phase;
      const local = getFaseLunarLocal();
      return {
        ...local,
        fase_api: phaseName,
        fonte: 'rapidapi',
      };
    }
  }

  // Fallback: cálculo local
  return getFaseLunarLocal(data);
}

function getInterpretacaoLua(faseLunar) {
  const fase = faseLunar.fase;
  const isLuaCheia = fase === 'Lua Cheia';

  let interpretacao = `${faseLunar.emoji} ${fase} — ${faseLunar.dica}`;

  if (isLuaCheia) {
    interpretacao += '\n\n⚡ ALERTA LUA CHEIA + TDAH: Energia intensa hoje! Possível agitação, hiperfoco descontrolado ou dificuldade pra dormir. Antes de tomar qualquer decisão grande, respira e espera 24h.';
  }

  return interpretacao;
}

async function getContextoAstrologico(agora = null) {
  const lua = getFaseLunarLocal(agora);
  return {
    lua: {
      ...lua,
      mensagem: lua.mensagem_tdah,
      tdah: lua.dica,
    },
    mensagem_whatsapp: `${lua.emoji} ${lua.fase} — ${lua.mensagem_tdah}`,
  };
}

module.exports = { getFaseLunarLocal, getFaseLunar, getInterpretacaoLua, getContextoAstrologico, FASES };
