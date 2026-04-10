// ─────────────────────────────────────────────
// HOLÍSTICO — Check-in 4 dimensões + ACT/IFS + Emergência
// ─────────────────────────────────────────────

// ━━━ CHECK-IN 4 DIMENSÕES ━━━
function gerarCheckin() {
  return `Como você tá agora, Carol? Me conta de 1 a 5:

🧍 Corpo — Como seu corpo tá? (1=muito mal, 5=ótimo)
🧠 Mente — Clareza mental? (1=nevoeiro, 5=focada)
💛 Emoção — Como tá o coração? (1=pesado, 5=leve)
⚡ Energia — Nível de bateria? (1=esgotada, 5=carregada)

Pode responder tipo: 3 2 4 1 ou por extenso, como preferir!`;
}

function interpretarCheckin(corpo, mente, emocao, energia) {
  const total = corpo + mente + emocao + energia;
  const media = total / 4;

  const dimensoes = { corpo, mente, emocao, energia };
  const menor = Object.entries(dimensoes).sort((a, b) => a[1] - b[1])[0];
  const maior = Object.entries(dimensoes).sort((a, b) => b[1] - a[1])[0];

  const nomes = { corpo: 'Corpo', mente: 'Mente', emocao: 'Emoção', energia: 'Energia' };

  let estado;
  if (media >= 4) estado = 'florescendo';
  else if (media >= 3) estado = 'estável';
  else if (media >= 2) estado = 'precisando de cuidado';
  else estado = 'modo sobrevivência';

  const recomendacoes = [];

  if (corpo <= 2) recomendacoes.push('Seu corpo tá pedindo atenção — água, alongamento, ou uma pausa deitada.');
  if (mente <= 2) recomendacoes.push('Mente nevoeiro: não force decisões agora. Faça só o mínimo necessário.');
  if (emocao <= 2) recomendacoes.push('Coração pesado: tá tudo bem sentir isso. Quer falar sobre ou prefere distração leve?');
  if (energia <= 2) recomendacoes.push('Bateria baixa: hoje é dia de ser gentil consigo. Só o essencial.');

  if (media <= 2) {
    recomendacoes.push('Modo cuidado ativado: vamos focar só no que é absolutamente necessário hoje.');
  }

  return {
    total,
    media,
    estado,
    menor: { dimensao: nomes[menor[0]], valor: menor[1] },
    maior: { dimensao: nomes[maior[0]], valor: maior[1] },
    recomendacoes,
    resumo: `Estado: ${estado} (média ${media.toFixed(1)}/5). Ponto forte: ${nomes[maior[0]]} (${maior[1]}). Precisa de atenção: ${nomes[menor[0]]} (${menor[1]}).`,
  };
}

// ━━━ ACT (Terapia de Aceitação e Compromisso) ━━━
const RESPOSTAS_ACT = {
  overwhelmed: [
    'O que você tá sentindo agora é real e válido. Não precisa lutar contra.',
    'Imagina que esses pensamentos são nuvens passando. Você não é as nuvens — você é o céu.',
    'Qual é a MENOR coisa que você pode fazer nos próximos 2 minutos que esteja alinhada com quem você quer ser?',
  ],
  frustrated: [
    'A frustração tá aí porque você se importa. Isso é força, não fraqueza.',
    'Esse sentimento é um visitante — ele veio, mas vai embora. Você não precisa resolver ele, só deixar estar.',
    'O que a Carol que você admira faria agora? Não perfeito, só o próximo passo.',
  ],
  paralysis: [
    'Quando tudo parece impossível, a pergunta certa não é "o que eu deveria fazer" mas "o que eu CONSIGO fazer agora".',
    'Não precisa de motivação. Precisa de 1 micro-ação. Levanta, bebe água, volta.',
    'Seu cérebro TDAH tá travado no modo "tudo ou nada". Vamos pro modo "qualquer coisa conta".',
  ],
};

// ━━━ IFS (Sistemas de Família Interna) ━━━
const RESPOSTAS_IFS = {
  critico_interno: [
    'Essa voz que tá te cobrando... ela tá tentando te proteger, mas do jeito errado. Vamos agradecer ela e pedir pra dar espaço.',
    'Quando a parte crítica aparece, lembra: ela aprendeu que cobrar = segurança. Mas você já não precisa mais disso.',
  ],
  parte_crianca: [
    'A parte de você que tá assustada ou cansada merece colo. O que ela precisa ouvir agora?',
    'Às vezes a Carol criança aparece pedindo segurança. Tá tudo bem. Você adulta pode cuidar dela.',
  ],
  protetor: [
    'A procrastinação não é preguiça — é uma parte sua tentando te proteger de algo. De que ela tá te protegendo?',
    'Quando você trava, geralmente tem um protetor agindo. Ele tá com medo de quê?',
  ],
};

function getRespostaACT(emocao) {
  const respostas = RESPOSTAS_ACT[emocao] || RESPOSTAS_ACT.overwhelmed;
  return respostas[Math.floor(Math.random() * respostas.length)];
}

function getRespostaIFS(parte) {
  const respostas = RESPOSTAS_IFS[parte] || RESPOSTAS_IFS.critico_interno;
  return respostas[Math.floor(Math.random() * respostas.length)];
}

// ━━━ MODO EMERGÊNCIA ━━━
const PALAVRAS_EMERGENCIA = [
  'não aguento', 'quero morrer', 'desisto', 'não consigo mais',
  'tô desesperada', 'surto', 'pânico', 'ataque de pânico',
  'não vejo saída', 'socorro', 'me ajuda', 'tô mal demais',
  'crise', 'emergência', 'não tô bem', 'quero sumir',
  'tô travada', 'paralisia', 'shutdown', 'burnout',
];

function isEmergencia(texto) {
  const lower = texto.toLowerCase();
  return PALAVRAS_EMERGENCIA.some(p => lower.includes(p));
}

function getModoEmergencia() {
  return `Carol, estou aqui com você. Respira comigo:

1️⃣ PARA tudo. Coloca os dois pés no chão. Sente o peso do corpo na cadeira.
2️⃣ RESPIRA: inspira 4 segundos, segura 4, solta 6. Faz 3 vezes.
3️⃣ Me conta UMA coisa que você tá vendo agora no ambiente (grounding).

Não precisa resolver nada agora. Só ficar aqui comigo. Estou aqui. 💜`;
}

// ━━━ RELATÓRIO DE VITÓRIAS ━━━
function gerarRelatorioVitorias(vitorias) {
  if (!vitorias || vitorias.length === 0) {
    return 'Ainda não registramos vitórias hoje, mas cada momento que você tá aqui já conta como uma. O que você fez hoje que pode celebrar?';
  }

  const lista = vitorias.map((v, i) => `${i + 1}. 🏆 ${v.text || v}`).join('\n');

  const mensagens_celebracao = [
    'Olha o tanto que você já fez!',
    'Carol, isso aqui é MUITO!',
    'Cada uma dessas é uma vitória do seu cérebro TDAH. Celebra!',
    'Você tá construindo algo incrível, uma vitória de cada vez.',
  ];

  const celebracao = mensagens_celebracao[Math.floor(Math.random() * mensagens_celebracao.length)];

  return `🎉 Suas vitórias (${vitorias.length} total):\n\n${lista}\n\n${celebracao}`;
}

// Alias
const getCheckinMatinal = gerarCheckin;

module.exports = {
  gerarCheckin,
  getCheckinMatinal,
  interpretarCheckin,
  getRespostaACT,
  getRespostaIFS,
  isEmergencia,
  getModoEmergencia,
  gerarRelatorioVitorias,
};
