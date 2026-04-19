const express = require("express");
const { think, thinkWithImage } = require("../services/brain");
const { enviarMensagemLonga, sendTelegramMessage } = require("../services/telegram");
const { downloadTelegramFile, imageToBase64, extractTextFromBuffer, isImage, isPdf, processPdf } = require("../services/fileReader");
const { transcreverAudio } = require("../services/audioTranscriber");

const router = express.Router();

router.post("/telegram", async (req, res) => {
  console.log(`🔔 [Telegram] Webhook recebido:`, JSON.stringify(req.body).substring(0, 300));
  const message = req.body.message;
  if (!message) {
    console.log(`🔔 [Telegram] Sem campo message, ignorando`);
    return res.sendStatus(200);
  }

 const chatId = message.chat.id;
  
  // Ignora mensagens com mais de 30 segundos
  const agora = Math.floor(Date.now() / 1000);
  if (agora - message.date > 300) {
    console.log(`🔔 [Telegram] Mensagem antiga ignorada (${agora - message.date}s atrás)`);
    return res.sendStatus(200);
  } console.log(`🔔 [Telegram] chatId=${chatId} | text=${!!message.text} | photo=${!!message.photo} | document=${!!message.document}`);

  try {
    // Áudio / mensagem de voz
    if (message.voice || message.audio) {
      const audio = message.voice || message.audio;
      console.log(`🎤 [Telegram] Áudio recebido de ${chatId} (${audio.duration}s, ${audio.file_size} bytes)`);

      try {
        await sendTelegramMessage(chatId, '🎤 <i>Transcrevendo seu áudio...</i>');

        const transcricao = await transcreverAudio(audio.file_id);
        console.log(`🎤 [Telegram] Transcrito: "${transcricao.substring(0, 100)}"`);

        await sendTelegramMessage(chatId, `📝 <b>Ouvi:</b> <i>"${transcricao}"</i>`);

        const reply = await think(transcricao, chatId);
        await enviarMensagemLonga(chatId, reply);
      } catch(e) {
        console.error('🎤 [Telegram] Erro áudio:', e.message);
        await sendTelegramMessage(chatId, '❌ Não consegui transcrever o áudio. Tenta de novo ou manda por texto.');
      }
      return res.sendStatus(200);
    }

    // Texto simples
    if (message.text) {
      const reply = await think(message.text, chatId);
      await enviarMensagemLonga(chatId, reply);
      return res.sendStatus(200);
    }

    // Foto
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1]; // maior resolução
      const caption = message.caption || "O que você vê nesta imagem?";
      console.log(`📷 [Telegram] Foto recebida de ${chatId}`);

      const { buffer, mimeType } = await downloadTelegramFile(photo.file_id);
      const imageContent = imageToBase64(buffer, mimeType);
      const reply = await thinkWithImage(caption, imageContent);
      await enviarMensagemLonga(chatId, reply);
      return res.sendStatus(200);
    }

    // Documento
    if (message.document) {
      const doc = message.document;
      const caption = message.caption || `Analise este arquivo: ${doc.file_name}`;
      console.log(`📄 [Telegram] Documento recebido: ${doc.file_name} (mime: ${doc.mime_type}, size: ${doc.file_size}) de ${chatId}`);

      console.log(`📄 [Telegram] Baixando arquivo ${doc.file_id}...`);
      const { buffer, fileName, mimeType } = await downloadTelegramFile(doc.file_id);
      console.log(`📄 [Telegram] Arquivo baixado: ${fileName} (${buffer.length} bytes, mimeType: ${mimeType})`);

      if (isImage(mimeType)) {
        console.log(`📄 [Telegram] Processando como IMAGEM`);
        const imageContent = imageToBase64(buffer, mimeType);
        const reply = await thinkWithImage(caption, imageContent);
        await enviarMensagemLonga(chatId, reply);
      } else if (isPdf(fileName)) {
        const result = await processPdf(buffer);

        if (result.mode === 'native') {
          // PDF pequeno — envia como document block nativo
          const reply = await thinkWithImage(caption, result.content);
          console.log(`📄 [Telegram] PDF nativo processado com sucesso`);
          await enviarMensagemLonga(chatId, reply);
        } else {
          // PDF grande — texto extraído via pdf-parse
          let prompt = `${caption}\n\n--- TEXTO EXTRAÍDO DO PDF "${fileName}" (${result.pages} páginas) ---\n${result.text}`;
          if (result.wasTruncated) {
            prompt += `\n\n[NOTA: PDF tinha ${result.originalLength} caracteres, truncado para 80.000]`;
          }
          const reply = await think(prompt, chatId);
          console.log(`📄 [Telegram] PDF grande processado via extração de texto`);
          await enviarMensagemLonga(chatId, reply);
        }
      } else {
        console.log(`📄 [Telegram] Processando como TEXTO (ext: ${fileName})`);
        const text = extractTextFromBuffer(buffer, fileName);
        if (text) {
          const prompt = `${caption}\n\n--- CONTEÚDO DO ARQUIVO ${fileName} ---\n${text.substring(0, 4000)}`;
          const reply = await think(prompt, chatId);
          await enviarMensagemLonga(chatId, reply);
        } else {
          console.log(`📄 [Telegram] Formato não suportado para leitura de texto`);
          await sendTelegramMessage(chatId, `Recebi o arquivo ${fileName}, mas ainda não consigo ler esse formato. Tenta mandar como PDF ou texto! 💜`);
        }
      }
      return res.sendStatus(200);
    }

    // Tipo não suportado
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ [Telegram] Erro completo:", err.message);
    console.error("❌ [Telegram] Stack:", err.stack);
    console.error("❌ [Telegram] Detalhes:", JSON.stringify(err.response?.data || err.error || {}, null, 2));
    try {
      await sendTelegramMessage(chatId, `Tive um erro ao processar: ${err.message}. Tenta de novo? 💜`);
    } catch {}
    res.sendStatus(200);
  }
});

module.exports = router;
