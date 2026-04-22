// Serviço de seleção de micro-práticas. Pura lógica em cima de src/data/micropraticas.js.
// Nenhuma chamada Supabase ou Anthropic — determinístico.

const { MICROPRATICAS } = require('../data/micropraticas');

function blocoHorario(hora) {
  if (hora >= 5 && hora < 12) return 'manha';
  if (hora >= 12 && hora < 18) return 'tarde';
  return 'noite';
}

function listarMicropraticas(filtros = {}) {
  let r = MICROPRATICAS;
  if (filtros.categoria) r = r.filter(p => p.categoria === filtros.categoria);
  if (filtros.tags?.length) r = r.filter(p => filtros.tags.every(t => p.tags.includes(t)));
  if (filtros.bloco_ayurveda) r = r.filter(p => p.bloco_ayurveda.includes(filtros.bloco_ayurveda));
  return r;
}

function sugerirMicropratica({ hora, dosha = null, humor = null, ultimasUsadas = [] }) {
  const periodo = blocoHorario(hora);
  let candidatas = MICROPRATICAS.filter(p => p.tags.includes(periodo));

  if (dosha) {
    candidatas = candidatas.filter(p => p.bloco_ayurveda.includes(dosha));
  }

  if (humor) {
    const lower = String(humor).toLowerCase();
    const baixaSinais = /cansad|exaust|sem energia|desanimad|triste/.test(lower);
    const altaSinais = /ansios|estress|acelerad|agitad|irritad/.test(lower);
    if (baixaSinais) {
      const filtradas = candidatas.filter(p => p.tags.includes('energia_baixa'));
      if (filtradas.length) candidatas = filtradas;
    } else if (altaSinais) {
      const filtradas = candidatas.filter(p => p.tags.includes('energia_alta'));
      if (filtradas.length) candidatas = filtradas;
    }
  }

  candidatas = candidatas.filter(p => !ultimasUsadas.includes(p.id));

  if (!candidatas.length) return null;

  const agora = new Date();
  const seed = agora.getFullYear() * 10000 + (agora.getMonth() + 1) * 100 + agora.getDate() + hora * 7;
  const idx = seed % candidatas.length;
  return candidatas[idx];
}

function formatarMicropratica(p) {
  if (!p) return '';
  return `🌱 <b>${p.nome}</b>\n${p.descricao}\n<i>${p.duracao_min} min · ${p.fonte}</i>`;
}

module.exports = {
  listarMicropraticas,
  sugerirMicropratica,
  formatarMicropratica,
};
