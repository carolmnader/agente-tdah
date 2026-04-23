// Endpoints HTTP pra cron-job.org disparar os jobs (Bug #20).
// node-cron em scheduler.js não roda em Vercel serverless — execução real é via HTTP.

const express = require('express');
const router = express.Router();
const jobs = require('../jobs/scheduler');

// Healthcheck público (sem auth) — antes do middleware
router.get('/health', (req, res) => res.json({ ok: true, service: 'cron' }));

function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[Cron] CRON_SECRET não configurado');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${expected}`) {
    console.warn('[Cron] tentativa não autorizada');
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

router.use(requireCronSecret);

function wrapJob(nome, fn) {
  return async (req, res) => {
    try {
      console.log(`[Cron] ${nome} iniciando`);
      await fn(req);
      console.log(`[Cron] ${nome} concluído`);
      res.json({ ok: true, job: nome });
    } catch (e) {
      console.error(`[Cron/${nome}] erro`, e.message);
      res.status(500).json({ error: e.message });
    }
  };
}

router.get('/briefing', wrapJob('briefing', () => jobs.jobBriefingMatinal()));
router.get('/checkin-tarde', wrapJob('checkin-tarde', (req) => {
  const hora = parseInt(req.query.hora, 10);
  if (![12, 15, 18].includes(hora)) throw new Error('hora inválida (12/15/18)');
  return jobs.jobCheckinTarde(hora);
}));
router.get('/pre-evento', wrapJob('pre-evento', () => jobs.jobPreEvento()));
router.get('/resumo', wrapJob('resumo', () => jobs.jobResumoNoturno()));
router.get('/semanal', wrapJob('semanal', () => jobs.jobPlanejamentoSemanal()));
router.get('/aniversarios', wrapJob('aniversarios', () => jobs.jobAniversarios()));
router.get('/relatorio-semanal', wrapJob('relatorio-semanal', () => jobs.jobRelatorioSemanal()));
router.get('/relatorio-mensal', wrapJob('relatorio-mensal', () => jobs.jobRelatorioMensal()));
// Análise Noturna — fire-and-forget (Bug #21). Job pode durar >30s (Haiku
// + múltiplos Supabase calls). Cron-job.org só precisa saber que chegou.
router.get('/noturno', (req, res) => {
  res.json({ ok: true, job: 'noturno', mode: 'async' });
  console.log('[Cron] noturno iniciando (async)');
  jobs.jobAnaliseNoturna()
    .then(() => console.log('[Cron] noturno concluído (async)'))
    .catch(e => console.error('[Cron/noturno] erro async:', e.message));
});

module.exports = router;
