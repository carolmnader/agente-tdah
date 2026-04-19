// Teste isolado do Bug #8 (idempotência por update_id).
// Sobe Express com router real + mocks de think/telegram/etc, dispara POSTs HTTP
// com mesmo/diferente/sem update_id, valida que retry (mesmo update_id) NÃO
// invoca think() na 2ª chamada.
//
// Rodar: node test-idempotencia.js
require('dotenv').config();

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

let thinkCallCount = 0;

// Mocks injetados ANTES de carregar o router
mockModule('./src/services/brain', {
  think: async () => { thinkCallCount++; return 'mocked reply'; },
  thinkWithImage: async () => 'mocked image reply',
});
mockModule('./src/services/telegram', {
  enviarMensagemLonga: async () => 'sent',
  sendTelegramMessage: async () => 'sent',
});
mockModule('./src/services/fileReader', {
  downloadTelegramFile: async () => ({ buffer: Buffer.from(''), mimeType: 'image/jpeg' }),
  imageToBase64: () => ({}),
  extractTextFromBuffer: () => '',
  isImage: () => false,
  isPdf: () => false,
  processPdf: async () => ({ mode: 'native', content: {} }),
});
mockModule('./src/services/audioTranscriber', { transcreverAudio: async () => 'mocked' });

const express = require('express');
const router = require('./src/routes/telegram');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// IDs de teste — escolhidos altos pra não colidir com Telegram real (~9 dígitos)
const TEST_UPDATE_IDS = [9000000001, 9000000002, 9000000003];

const app = express();
app.use(express.json());
app.use('/', router);
let server, port;

let passed = 0, failed = 0;
function assert(cond, label, info = '') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   ${info}`); }
}

function buildBody(updateId) {
  const body = {
    message: { chat: { id: 8660725782 }, date: Math.floor(Date.now() / 1000), text: 'oi teste' },
  };
  if (updateId !== null) body.update_id = updateId;
  return body;
}

async function postWebhook(updateId) {
  const r = await fetch(`http://localhost:${port}/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(updateId)),
  });
  return r.status;
}

async function cleanupTestRows() {
  await supabase.from('webhook_updates').delete().in('update_id', TEST_UPDATE_IDS);
}

async function run() {
  await cleanupTestRows();
  server = app.listen(0);
  port = server.address().port;

  try {
    // ── C1: 2x mesmo update_id ──
    thinkCallCount = 0;
    const s1a = await postWebhook(TEST_UPDATE_IDS[0]);
    const countAfter1a = thinkCallCount;
    const s1b = await postWebhook(TEST_UPDATE_IDS[0]);
    const countAfter1b = thinkCallCount;
    assert(
      s1a === 200 && s1b === 200 && countAfter1a === 1 && countAfter1b === 1,
      'C1) 2x mesmo update_id: ambos retornam 200, mas think() invocado SÓ 1x (retry ignorado)',
      `s1a=${s1a}, s1b=${s1b}, count após 1a=${countAfter1a}, após 1b=${countAfter1b}`
    );

    // ── C2: update_id diferente ──
    const s2 = await postWebhook(TEST_UPDATE_IDS[1]);
    assert(
      s2 === 200 && thinkCallCount === 2,
      'C2) update_id diferente: 200 + think() invocado (count vai pra 2)',
      `s2=${s2}, count=${thinkCallCount}`
    );

    // ── C3: sem update_id (fail-open) ──
    const s3 = await postWebhook(null);
    assert(
      s3 === 200 && thinkCallCount === 3,
      'C3) Sem update_id: ainda processa (fail-open), 200 + think() invocado',
      `s3=${s3}, count=${thinkCallCount}`
    );

  } finally {
    if (server) server.close();
    await cleanupTestRows();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} passou  |  ❌ ${failed} falhou  (de ${passed + failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async e => {
  console.error('💥 erro fatal:', e);
  if (server) server.close();
  await cleanupTestRows();
  process.exit(1);
});
