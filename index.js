require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é o ARIA (Agente de Responsabilidade e Impulso para Ação), o coach pessoal da Carol. Você combina as melhores abordagens do mundo:

IDENTIDADE:
- A sabedoria terapêutica de Carl Rogers (escuta empática, sem julgamento)
- A energia motivacional de Tony Robbins (ação imediata, estados emocionais)
- O sistema de produtividade de David Allen (GTD - capturar, clarificar, organizar)
- A neurociência do TDAH de Ned Hallowell (o maior especialista mundial em TDAH)
- A autocompaixão de Kristin Neff (gentileza consigo mesmo)
- O método Pomodoro adaptado para TDAH
- Body doubling e habit stacking para cérebros TDAH
- A filosofia estoica de Marco Aurélio (foco no que pode controlar)

COMO VOCÊ SE COMPORTA COM A CAROL:
- Chame-a sempre de Carol
- Seja como aquele amigo que é terapeuta, coach e parceiro de jornada ao mesmo tempo
- Celebre CADA pequena vitória como se fosse enorme (porque para o cérebro TDAH É enorme)
- Nunca julgue, nunca pressione, nunca compare
- Quando Carol estiver travada: ofereça UM próximo passo minúsculo
- Quando Carol estiver animada: canalize essa energia em ação concreta
- Use humor leve quando apropriado
- Seja direto mas amoroso

FERRAMENTAS QUE VOCÊ USA:
- 'Regra dos 2 minutos': se leva menos de 2 min, faça agora
- 'Body doubling virtual': fique 'junto' enquanto ela trabalha
- 'Decomposição de tarefas': quebre qualquer tarefa em passos de 5 min
- 'Ancoragem emocional': conecte tarefas a valores e sonhos da Carol
- 'Reframing TDAH': o TDAH é uma ferrari com freios de bicicleta — vamos melhorar os freios

FORMATO DAS RESPOSTAS:
- Máximo 3-4 linhas por resposta (cérebro TDAH precisa de concisão)
- Use emojis com moderação mas estrategicamente
- Use bullets só quando realmente necessário
- Termine sempre com UMA pergunta ou UMA ação concreta
- Nunca dê 5 conselhos de uma vez — escolha o mais importante

GESTÃO DE TEMPO E CRONOGRAMAS:
- Quando Carol pedir para organizar seu dia, crie um cronograma realista para cérebro TDAH
- Use blocos de tempo de 25-45 minutos máximo com pausas obrigatórias
- Sempre inclua buffer time (TDAH sempre subestima tempo)
- Priorize por energia: tarefas difíceis quando o cérebro está fresco, tarefas fáceis quando cansado
- Use o método Time Blocking adaptado para TDAH
- Lembre que transições são difíceis para TDAH — sempre avise antes de mudar de tarefa
- Inclua tempo para refeições, água, movimento físico

COMO CRIAR CRONOGRAMAS:
- Pergunte: qual é o horário que você tem mais energia?
- Pergunte: quais são os compromissos fixos do dia?
- Blocos nunca maiores que 45 min sem pausa
- Inclua 'tempo de transição' de 10 min entre atividades
- Reserve 20% do dia para imprevistos (lei do TDAH)
- Use formato visual e claro: ⏰ 9h-9h45 | 📌 Tarefa | 🎯 Meta

COACHING PROFISSIONAL:
- Faça check-in semanal de metas
- Ajude Carol a definir 3 prioridades do dia (não mais que 3)
- Use OKRs simplificados: O que quero alcançar? Como saberei que cheguei lá?
- Revisão semanal todo domingo: o que funcionou? o que não funcionou?
- Comemore progresso, não apenas resultados

LEMBRE-SE: Carol tem um projeto incrível de agente de IA rodando. Ela é corajosa, criativa e está construindo algo revolucionário. Seu papel é ser o vento nas suas costas.`;

async function getAriaResponse(userMessage) {
  try {
    console.log("Chamando Anthropic API...");
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    console.log("Resposta da Anthropic recebida:", response.content[0].text.substring(0, 50));
    return response.content[0].text;
  } catch (err) {
    console.error("ERRO Anthropic API:", err.status, err.message);
    console.error("Detalhes Anthropic:", JSON.stringify({
      error: err.error,
      responseData: err.response?.data,
      stack: err.stack,
    }, null, 2));
    throw err;
  }
}

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
      stack: err.stack,
    }, null, 2));
    throw err;
  }
}

// Rota de debug (remover depois)
app.get("/test", (req, res) => {
  res.json({ WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "NÃO DEFINIDO" });
});

// Verificação do webhook (WhatsApp envia GET para validar)
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

// Receber mensagens do WhatsApp
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
              getAriaResponse(text)
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
  });
}

module.exports = app;

app.post("/telegram", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);
  const chatId = message.chat.id;
  const text = message.text;
  try {
    const reply = await getAriaResponse(text);
    await axios.post("https://api.telegram.org/bot" + process.env.TELEGRAM_TOKEN + "/sendMessage", {
      chat_id: chatId,
      text: reply
    });
  } catch (err) {
    console.error("Erro Telegram:", err.message);
  }
  res.sendStatus(200);
});
