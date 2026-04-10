const { weeklyReflection, dailySummary } = require('./selfImprove');

// Verifica se deve rodar uma tarefa agendada
function checkSchedule() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = domingo

  // Resumo diário às 21h
  if (hour === 21) {
    const lastDaily = global._lastDailyRun;
    const today = now.toISOString().split('T')[0];
    if (lastDaily !== today) {
      global._lastDailyRun = today;
      console.log('⏰ [Scheduler] Rodando resumo diário...');
      dailySummary().catch(console.error);
    }
  }

  // Reflexão semanal todo domingo às 20h
  if (day === 0 && hour === 20) {
    const lastWeekly = global._lastWeeklyRun;
    const thisWeek = `${now.getFullYear()}-W${getWeekNumber(now)}`;
    if (lastWeekly !== thisWeek) {
      global._lastWeeklyRun = thisWeek;
      console.log('🔮 [Scheduler] Rodando reflexão semanal...');
      weeklyReflection().catch(console.error);
    }
  }
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Inicia o scheduler — verifica a cada 30 minutos
function startScheduler() {
  console.log('⏰ [Scheduler] Iniciado — verificando tarefas a cada 30min');
  setInterval(checkSchedule, 30 * 60 * 1000);
  checkSchedule(); // roda imediatamente ao iniciar
}

module.exports = { startScheduler, weeklyReflection, dailySummary };
