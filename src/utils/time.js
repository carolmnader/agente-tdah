// src/utils/time.js — helper centralizado de horario BRT pra injecao em prompts.
//
// timeZone explicito em todas chamadas: remove dependencia de process.env.TZ
// (que so esta setado quando src/index.js carrega — testes podem rodar sem).

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Retorna hora atual em BRT formatada pra injecao em prompts.
 * Nao retorna saudacao: saudacao e' diretriz do prompt (parte da voz), nao template.
 * Aceita `date` opcional pra testabilidade (forca horario sem mockar Date global).
 */
function getBrtNow(date = new Date()) {
  const hora = date.toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
  });
  const diaSemana = date.toLocaleDateString('pt-BR', {
    timeZone: TIMEZONE, weekday: 'long'
  });
  const dataBR = date.toLocaleDateString('pt-BR', {
    timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const horaNum = parseInt(date.toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE, hour: '2-digit', hour12: false
  }).slice(0, 2), 10);

  let periodo;
  if (horaNum >= 5 && horaNum < 12) periodo = 'manhã';
  else if (horaNum >= 12 && horaNum < 18) periodo = 'tarde';
  else if (horaNum >= 18 && horaNum < 21) periodo = 'noite';
  else if (horaNum >= 21 && horaNum < 24) periodo = 'noite tardia';
  else periodo = 'madrugada'; // 0h-4h59

  return { hora, diaSemana, dataBR, horaNum, periodo };
}

/**
 * Calcula minutos entre agora e o startISO de um evento.
 * Negativo se evento ja passou. Retorna integer arredondado.
 */
function minutosAteEvento(startISO, now = new Date()) {
  return Math.round((new Date(startISO).getTime() - now.getTime()) / 60000);
}

function _fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function _fmtFalta(min) {
  if (min <= 0) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `em ${h}h` : `em ${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Monta bloco textual "AGENDA REAL DE HOJE" pra injecao em prompts reativos.
 * Recebe array de eventos do Google Calendar API (shape: summary, start.dateTime
 * pra timed OU start.date pra all-day).
 *
 * Retorna null se eventos for vazio/invalido — caller decide se anexa ou nao
 * (padrao Oura: ausencia de dado = nao inventa).
 */
function montarBlocoAgenda(eventos, now = new Date()) {
  if (!Array.isArray(eventos) || eventos.length === 0) return null;
  const linhas = [], timed = [];
  for (const ev of eventos) {
    const summary = ev.summary || '(sem título)';
    const dt = ev.start && ev.start.dateTime;   // all-day usa ev.start.date
    if (dt) { timed.push({ summary, startISO: dt }); linhas.push(`- ${_fmtHora(dt)} — ${summary}`); }
    else { linhas.push(`- dia todo — ${summary}`); }
  }
  timed.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
  const prox = timed.find(e => minutosAteEvento(e.startISO, now) >= 0);
  let bloco = `━━━ AGENDA REAL DE HOJE (fonte factual — não invente nada além disto) ━━━\n${linhas.join('\n')}`;
  bloco += prox
    ? `\nPRÓXIMO COMPROMISSO: ${prox.summary} às ${_fmtHora(prox.startISO)} (${_fmtFalta(minutosAteEvento(prox.startISO, now))})`
    : `\nPRÓXIMO COMPROMISSO: nenhum mais hoje.`;
  bloco += `\nAntes de sugerir qualquer atividade com duração, olhe o PRÓXIMO COMPROMISSO e quanto falta. Ajuste a sugestão ao tempo real que cabe. Use os horários acima, não suponha.`;
  return bloco;
}

module.exports = { getBrtNow, TIMEZONE, minutosAteEvento, montarBlocoAgenda };
