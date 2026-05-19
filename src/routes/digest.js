/**
 * ARIA · /api/daily-digest
 *
 * Recebe o payload da routine "Daily IA Digest" do Claude Code,
 * formata e envia para o Telegram da Ana Carolina.
 *
 * Env vars necessárias (Vercel):
 *   - DIGEST_SHARED_SECRET     (UUID/string aleatória; mesmo valor na routine)
 *   - TELEGRAM_CHAT_ID_CAROL   (chat_id pra onde mandar; renomear se já existir
 *                              outro nome no projeto)
 */

const express = require("express");
const { sendTelegramMessage } = require("../services/telegram");

const router = express.Router();

// Helpers ----------------------------------------------------------------

function escaparHTML(texto) {
  if (!texto) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function montarMensagem(payload) {
  const { date, summary, video_count, pdf_drive_url, highlights, harvest_stats } = payload;

  const dryNote = harvest_stats?.dry_day
    ? "\n\n⚠️ <i>Dia seco — colheita pobre.</i>"
    : "";

  const destaques = (highlights || [])
    .slice(0, 3)
    .map((h, i) => {
      const titulo = escaparHTML(h.title);
      const canal = escaparHTML(h.channel);
      const motivo = escaparHTML(h.why);
      return `${i + 1}. <a href="${h.url}">${titulo}</a> — <i>${canal}</i>\n   ${motivo}`;
    })
    .join("\n\n");

  return (
    `📰 <b>Daily IA Digest · ${escaparHTML(date)}</b>\n\n` +
    `${escaparHTML(summary)}${dryNote}\n\n` +
    (destaques ? `<b>Destaques:</b>\n${destaques}\n\n` : "") +
    `📊 ${video_count} vídeo(s) hoje\n` +
    (pdf_drive_url ? `📄 PDF completo: ${escaparHTML(pdf_drive_url)}` : "")
  );
}

// Handler ----------------------------------------------------------------

router.post("/daily-digest", async (req, res) => {
  console.log(`📰 [DailyDigest] Webhook recebido`);

  // 1. Auth via Bearer
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${process.env.DIGEST_SHARED_SECRET}`;
  if (!process.env.DIGEST_SHARED_SECRET || auth !== expected) {
    console.warn(`📰 [DailyDigest] Auth falhou — origem: ${req.ip}`);
    return res.status(401).json({ error: "unauthorized" });
  }

  // 2. Validação mínima do payload
  const payload = req.body;
  if (!payload || payload.type !== "youtube-digest") {
    console.warn(`📰 [DailyDigest] Payload inválido:`, payload?.type);
    return res.status(400).json({ error: "invalid_payload" });
  }

  // 3. Chat ID — env var dedicada
  const chatId = process.env.TELEGRAM_CHAT_ID_CAROL;
  if (!chatId) {
    console.error(`📰 [DailyDigest] TELEGRAM_CHAT_ID_CAROL não definida`);
    return res.status(500).json({ error: "misconfigured_server" });
  }

  // 4. Mandar mensagem (raw=true porque já formatamos HTML manualmente)
  try {
    const texto = montarMensagem(payload);
    await sendTelegramMessage(chatId, texto, { raw: true });
    console.log(
      `📰 [DailyDigest] Enviado para ${chatId} · ${payload.video_count} vídeos · dry=${payload.harvest_stats?.dry_day}`
    );
    return res.json({ status: "delivered" });
  } catch (err) {
    console.error(`📰 [DailyDigest] Erro ao enviar:`, err.message);
    return res.status(502).json({ error: "telegram_send_failed", detail: err.message });
  }
});

module.exports = router;

