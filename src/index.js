require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { think } = require("./services/brain");
const { startScheduler } = require("./services/scheduler");
const { iniciarScheduler } = require("./jobs/scheduler");
const telegramRoutes = require("./routes/telegram");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Rotas Telegram
app.use("/api", telegramRoutes);
app.use("/webhook", telegramRoutes);
// Rota de debug
app.get("/test", (req, res) => {
  res.json({ status: "ok", WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "NÃO DEFINIDO" });
});

// Verificação do webhook WhatsApp (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    return res.status(200).type("text/plain").send(challenge);
  }

  console.log("Falha na verificação do webhook.");
  return res.sendStatus(403);
});

// Enviar mensagem WhatsApp
async function sendWhatsAppMessage(to, text) {
  try {
    console.log(`Enviando mensagem para ${to}...`);
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("WhatsApp API resposta:", response.status, JSON.stringify(response.data));
  } catch (err) {
    console.error("ERRO WhatsApp API:", err.response?.status, err.response?.statusText);
    console.error("Detalhes WhatsApp:", JSON.stringify({
      data: err.response?.data,
      headers: err.response?.headers,
      message: err.message,
    }, null, 2));
    throw err;
  }
}

// Receber mensagens do WhatsApp (POST)
app.post("/webhook", async (req, res) => {
  console.log("BODY RECEBIDO:", JSON.stringify(req.body));
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const entries = body.entry || [];
    const tasks = [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const messages = change.value?.messages || [];
        for (const message of messages) {
          const from = message.from;
          const type = message.type;
          const text = message.text?.body || "";

          console.log(`Mensagem recebida de ${from} (${type}): ${text}`);

          if (type === "text" && text) {
            tasks.push(
              think(text)
                .then((reply) => sendWhatsAppMessage(from, reply))
                .then(() => console.log(`Resposta enviada para ${from}`))
                .catch((err) => console.error("Erro ao responder:", err.message))
            );
          }
        }
      }
    }

    await Promise.all(tasks);
    return res.sendStatus(200);
  }

  return res.sendStatus(404);
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    startScheduler();
    iniciarScheduler();
  });
}

module.exports = app;
