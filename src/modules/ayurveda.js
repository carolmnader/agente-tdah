// ─────────────────────────────────────────────
// AYURVEDA — Relógio dos Doshas + Cronobiologia TDAH
// Sem dependência de API externa
// ─────────────────────────────────────────────

const { getProfile } = require('./profile');

// Relógio dos 6 blocos de dosha (ciclo de 24h)
const BLOCOS_DOSHA = [
  { inicio: 2,  fim: 6,  dosha: 'vata',  nome: 'Vata Madrugada',  descricao: 'Criatividade e intuição no pico. Bom para meditação e ideias.' },
  { inicio: 6,  fim: 10, dosha: 'kapha', nome: 'Kapha Manhã',     descricao: 'Energia estável. Melhor momento para rotinas e tarefas pesadas.' },
  { inicio: 10, fim: 14, dosha: 'pitta', nome: 'Pitta Meio-dia',  descricao: 'Fogo digestivo e mental no máximo. Hora de executar e decidir.' },
  { inicio: 14, fim: 18, dosha: 'vata',  nome: 'Vata Tarde',      descricao: 'Energia dispersa. Ideal para tarefas leves e criativas.' },
  { inicio: 18, fim: 22, dosha: 'kapha', nome: 'Kapha Noite',     descricao: 'Desaceleração natural. Hora de fechar o dia e relaxar.' },
  { inicio: 22, fim: 2,  dosha: 'pitta', nome: 'Pitta Madrugada', descricao: 'Corpo se regenera. Melhor estar dormindo.' },
];

// Estratégias TDAH por dosha dominante do momento
const ESTRATEGIAS_TDAH = {
  vata: {
    energia: 'dispersa e criativa',
    riscos: ['hiperfoco em algo irrelevante', 'pular entre tarefas', 'esquecer do corpo'],
    estrategias: [
      'Escolha UMA coisa antes de começar',
      'Timer de 15 min — compromisso curto',
      'Anote ideias soltas num lugar só (não execute agora)',
      'Movimento físico leve para ancorar',
    ],
    alerta_tdah: 'Vata + TDAH = cérebro pipoca. Ancore antes de agir.',
  },
  pitta: {
    energia: 'focada e intensa',
    riscos: ['perfeccionismo', 'irritabilidade se interrompida', 'burnout por hiperfoco'],
    estrategias: [
      'Aproveite o foco — coloque a tarefa mais difícil agora',
      'Defina um ponto de parada ANTES de começar',
      'Hidrate e coma — pitta queima rápido',
      'Se irritada, pare 2 min e respire antes de responder',
    ],
    alerta_tdah: 'Pitta + TDAH = hiperfoco produtivo MAS pode virar burnout. Coloque alarme.',
  },
  kapha: {
    energia: 'lenta e estável',
    riscos: ['procrastinação', 'letargia', 'comfort zone'],
    estrategias: [
      'Comece com algo PEQUENO (regra dos 2 min)',
      'Movimento físico para ativar — 5 min de caminhada',
      'Body doubling: peça pra alguém ficar junto',
      'Não espere motivação — comece e ela vem',
    ],
    alerta_tdah: 'Kapha + TDAH = paralisia. O antídoto é micro-ação, não planejamento.',
  },
};

// Dicas de cronobiologia por dosha constitucional
const CRONOBIOLOGIA_DOSHA = {
  vata: {
    rotina_ideal: 'Acordar cedo, rotina matinal fixa, refeições em horários regulares',
    sono: 'Deitar até 22h — vata precisa de regularidade para não colapsar',
    alimentacao: 'Comidas quentes, oleosas, nutritivas. Evitar pular refeições.',
    exercicio: 'Yoga, caminhada, alongamento. Evitar exercício intenso à noite.',
    alerta: 'Vata constitucional + TDAH = precisa de MUITA estrutura externa. Rotina é remédio.',
  },
  pitta: {
    rotina_ideal: 'Manhã produtiva, almoço como maior refeição, noite leve',
    sono: 'Pode ser mais flexível mas evitar telas estimulantes à noite',
    alimentacao: 'Evitar excesso de cafeína e pimenta. Refeições regulares.',
    exercicio: 'Pode ser intenso mas não competitivo ao ponto de estressar.',
    alerta: 'Pitta + TDAH = risco de burnout por hiperfoco. Precisa de pausas forçadas.',
  },
  kapha: {
    rotina_ideal: 'Acordar cedo, exercício pela manhã, evitar sonecas longas',
    sono: 'Não dormir demais — excesso de sono piora kapha',
    alimentacao: 'Refeições leves, especiarias para ativar. Evitar comfort food em excesso.',
    exercicio: 'Precisa de exercício vigoroso regularmente para manter energia.',
    alerta: 'Kapha + TDAH = inércia. Precisa de estímulo externo para sair do lugar.',
  },
};

function getBlocoAtual(hora = null) {
  const h = hora !== null ? hora : new Date().getHours();
  const bloco = BLOCOS_DOSHA.find(b => {
    if (b.inicio < b.fim) {
      return h >= b.inicio && h < b.fim;
    }
    // Bloco que cruza meia-noite (22h-2h)
    return h >= b.inicio || h < b.fim;
  });
  return bloco || BLOCOS_DOSHA[0];
}

function getEstrategiaTDAH(doshaAtual) {
  return ESTRATEGIAS_TDAH[doshaAtual] || ESTRATEGIAS_TDAH.vata;
}

function getCronobiologia() {
  const perfil = getProfile();
  return CRONOBIOLOGIA_DOSHA[perfil.dosha] || CRONOBIOLOGIA_DOSHA.vata;
}

function getContextoAyurveda() {
  const bloco = getBlocoAtual();
  const estrategia = getEstrategiaTDAH(bloco.dosha);
  const crono = getCronobiologia();

  return {
    bloco,
    estrategia,
    cronobiologia: crono,
    resumo: `${bloco.nome}: ${bloco.descricao} | ${estrategia.alerta_tdah}`,
  };
}

// Alias para compatibilidade
function getContextoAyurvedico(agora = null) {
  const bloco = getBlocoAtual(agora ? agora.getHours() : null);
  const estrategia = getEstrategiaTDAH(bloco.dosha);
  const crono = getCronobiologia();
  return { bloco: { ...bloco, ideal_para: estrategia.estrategias, evitar: estrategia.riscos }, estrategia, cronobiologia: crono };
}

function getMensagemAyurvedica(agora = null) {
  const ctx = getContextoAyurvedico(agora);
  const hora = agora ? agora.getHours() : new Date().getHours();
  return `🕐 <b>${ctx.bloco.nome}</b> (${hora}h)\n${ctx.bloco.descricao}\n⚡ ${ctx.estrategia.alerta_tdah}\n💡 Ideal agora: ${ctx.estrategia.estrategias[0]}`;
}

module.exports = { getBlocoAtual, getEstrategiaTDAH, getCronobiologia, getContextoAyurveda, getContextoAyurvedico, getMensagemAyurvedica, BLOCOS_DOSHA };
