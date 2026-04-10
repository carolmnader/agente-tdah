const Groq = require('groq-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const baixarAudioTelegram = async (fileId) => {
  const infoResp = await axios.get(
    `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
  );
  const filePath = infoResp.data.result.file_path;
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${filePath}`;

  const localPath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
  const audioResp = await axios({ url, responseType: 'arraybuffer' });
  fs.writeFileSync(localPath, audioResp.data);
  return localPath;
};

const transcreverAudio = async (fileId) => {
  let localPath = null;
  try {
    localPath = await baixarAudioTelegram(fileId);

    const transcricao = await groq.audio.transcriptions.create({
      file: fs.createReadStream(localPath),
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'text',
    });

    return typeof transcricao === 'string' ? transcricao : transcricao.text;
  } catch(e) {
    console.error('[Audio] Erro ao transcrever:', e.message);
    throw e;
  } finally {
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
};

module.exports = { transcreverAudio };
