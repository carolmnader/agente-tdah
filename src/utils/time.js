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

module.exports = { getBrtNow, TIMEZONE };
