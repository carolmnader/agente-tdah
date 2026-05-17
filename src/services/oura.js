// src/services/oura.js
// Integracao com Oura Ring API v2 - sono, readiness, atividade, stress, workouts
// Cache em memoria 1h. Tratamento de erro silencioso (mesmo padrao do Calendar).
// Documentacao: https://cloud.ouraring.com/v2/docs

const OURA_TOKEN = process.env.OURA_TOKEN;
const OURA_BASE = 'https://api.ouraring.com/v2/usercollection';

// Cache simples em memoria - TTL 1h
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.value;
  return null;
}

function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

// Data YYYY-MM-DD no timezone Sao_Paulo
function ymdSaoPaulo(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return formatter.format(date);
}

function ontemHoje() {
  const agora = new Date();
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  return { ontem: ymdSaoPaulo(ontem), hoje: ymdSaoPaulo(agora) };
}

// Wrapper generico de fetch ao Oura
async function ouraFetch(endpoint, params = {}) {
  if (!OURA_TOKEN) {
    console.log('🟡 [Oura] OURA_TOKEN ausente, pulando');
    return null;
  }

  const url = new URL(`${OURA_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${OURA_TOKEN}` }
    });
    if (!res.ok) {
      console.log(`🟡 [Oura] ${endpoint} retornou HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    setCached(cacheKey, data);
    return data;
  } catch (e) {
    console.log(`🟡 [Oura] erro em ${endpoint}:`, e.message);
    return null;
  }
}

/**
 * Sono da noite passada
 */
async function fetchSonoOntem() {
  const { ontem, hoje } = ontemHoje();
  const data = await ouraFetch('daily_sleep', { start_date: ontem, end_date: hoje });
  if (!data?.data?.length) return null;
  const ds = data.data.find(d => d.day === ontem) || data.data[data.data.length - 1];
  return {
    day: ds.day,
    score: ds.score ?? null,
    total_sleep_min: ds.contributors?.total_sleep ? Math.round(ds.contributors.total_sleep / 60) : null,
    deep_sleep_min: ds.contributors?.deep_sleep ? Math.round(ds.contributors.deep_sleep / 60) : null,
    rem_sleep_min: ds.contributors?.rem_sleep ? Math.round(ds.contributors.rem_sleep / 60) : null,
    efficiency: ds.contributors?.efficiency ?? null,
    latency_min: ds.contributors?.latency ? Math.round(ds.contributors.latency / 60) : null,
    restfulness: ds.contributors?.restfulness ?? null
  };
}

/**
 * Readiness do dia atual
 */
async function fetchReadinessHoje() {
  const { ontem, hoje } = ontemHoje();
  const data = await ouraFetch('daily_readiness', { start_date: ontem, end_date: hoje });
  if (!data?.data?.length) return null;
  const dr = data.data.find(d => d.day === hoje) || data.data[data.data.length - 1];
  return {
    day: dr.day,
    score: dr.score ?? null,
    temperature_deviation_c: dr.temperature_deviation ?? null,
    temperature_trend_deviation_c: dr.temperature_trend_deviation ?? null,
    activity_balance: dr.contributors?.activity_balance ?? null,
    body_temperature: dr.contributors?.body_temperature ?? null,
    hrv_balance: dr.contributors?.hrv_balance ?? null,
    previous_day_activity: dr.contributors?.previous_day_activity ?? null,
    previous_night: dr.contributors?.previous_night ?? null,
    recovery_index: dr.contributors?.recovery_index ?? null,
    resting_heart_rate: dr.contributors?.resting_heart_rate ?? null,
    sleep_balance: dr.contributors?.sleep_balance ?? null
  };
}

/**
 * Atividade do dia atual
 */
async function fetchAtividadeHoje() {
  const { hoje } = ontemHoje();
  const data = await ouraFetch('daily_activity', { start_date: hoje, end_date: hoje });
  if (!data?.data?.length) return null;
  const da = data.data.find(d => d.day === hoje) || data.data[data.data.length - 1];
  return {
    day: da.day,
    score: da.score ?? null,
    steps: da.steps ?? null,
    active_calories: da.active_calories ?? null,
    total_calories: da.total_calories ?? null,
    meeting_daily_targets: da.contributors?.meeting_daily_targets ?? null
  };
}

/**
 * Stress do dia atual
 */
async function fetchStressHoje() {
  const { hoje } = ontemHoje();
  const data = await ouraFetch('daily_stress', { start_date: hoje, end_date: hoje });
  if (!data?.data?.length) return null;
  const ds = data.data.find(d => d.day === hoje) || data.data[data.data.length - 1];
  return {
    day: ds.day,
    stress_high_seconds: ds.stress_high ?? null,
    recovery_high_seconds: ds.recovery_high ?? null,
    day_summary: ds.day_summary ?? null
  };
}

/**
 * Workouts detectados hoje
 */
async function fetchWorkoutsHoje() {
  const { hoje } = ontemHoje();
  const data = await ouraFetch('workout', { start_date: hoje, end_date: hoje });
  if (!data?.data?.length) return [];
  return data.data.map(w => ({
    activity: w.activity,
    intensity: w.intensity,
    start: w.start_datetime,
    end: w.end_datetime,
    duration_min: w.end_datetime && w.start_datetime
      ? Math.round((new Date(w.end_datetime) - new Date(w.start_datetime)) / 60000)
      : null,
    calories: w.calories ?? null,
    distance_m: w.distance ?? null,
    source: w.source ?? null
  }));
}

/**
 * Snapshot completo pra usar no briefing matinal e weekly review.
 * Retorna { sono, readiness, atividade, stress, workouts }.
 * Cada campo pode ser null se a chamada falhou ou se Oura nao tem o dado.
 */
async function snapshotMatinal() {
  const [sono, readiness, atividade, stress, workouts] = await Promise.all([
    fetchSonoOntem(),
    fetchReadinessHoje(),
    fetchAtividadeHoje(),
    fetchStressHoje(),
    fetchWorkoutsHoje()
  ]);
  return { sono, readiness, atividade, stress, workouts };
}

module.exports = {
  fetchSonoOntem,
  fetchReadinessHoje,
  fetchAtividadeHoje,
  fetchStressHoje,
  fetchWorkoutsHoje,
  snapshotMatinal
};
