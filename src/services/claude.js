const Anthropic = require("@anthropic-ai/sdk");
const { SYSTEM_PROMPT } = require("../prompts/system");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

module.exports = { getAriaResponse };
