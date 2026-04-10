const axios = require('axios');
const path = require('path');
const pdfParse = require('pdf-parse-fork');

const MAX_PDF_NATIVE = 25 * 1024 * 1024; // 25 MB — limite da API Claude para document block

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

// Baixa arquivo do Telegram e retorna { buffer, fileName, mimeType }
async function downloadTelegramFile(fileId) {
  const fileInfo = await axios.get(`${TELEGRAM_API}/getFile`, {
    params: { file_id: fileId },
  });

  const filePath = fileInfo.data.result.file_path;
  const fileName = path.basename(filePath);
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${filePath}`;

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);

  const ext = path.extname(fileName).toLowerCase();
  const mimeType = getMimeType(ext);

  return { buffer, fileName, mimeType };
}

// Converte imagem para base64 para enviar ao Claude (vision)
function imageToBase64(buffer, mimeType) {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mimeType,
      data: buffer.toString('base64'),
    },
  };
}

// Extrai texto de documento (TXT, MD, etc.)
function extractTextFromBuffer(buffer, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const textExts = ['.txt', '.md', '.csv', '.json', '.js', '.py', '.html', '.css', '.ts', '.jsx', '.tsx'];

  if (textExts.includes(ext)) {
    return buffer.toString('utf-8');
  }

  return null; // null = formato não legível como texto
}

// Converte PDF para content block do Claude (suporte nativo)
function pdfToDocumentBlock(buffer) {
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: buffer.toString('base64'),
    },
  };
}

// Extrai texto de um PDF usando pdf-parse
async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pages: data.numpages,
    info: data.info,
  };
}

// Processa PDF: nativo se pequeno, extração de texto se grande
async function processPdf(buffer) {
  if (buffer.length <= MAX_PDF_NATIVE) {
    console.log(`📄 [fileReader] PDF ${(buffer.length / 1024 / 1024).toFixed(1)} MB — enviando como document block nativo`);
    return { mode: 'native', content: pdfToDocumentBlock(buffer) };
  }

  console.log(`📄 [fileReader] PDF ${(buffer.length / 1024 / 1024).toFixed(1)} MB — extraindo texto (excede limite nativo de 25 MB)`);
  const { text, pages } = await extractPdfText(buffer);
  const truncated = text.substring(0, 80000); // ~80k chars cabe no contexto do Claude
  const wasTruncated = text.length > 80000;
  console.log(`📄 [fileReader] Texto extraído: ${pages} páginas, ${text.length} chars${wasTruncated ? ' (truncado para 80k)' : ''}`);
  return { mode: 'text', text: truncated, pages, wasTruncated, originalLength: text.length };
}

function isPdf(fileName) {
  return path.extname(fileName).toLowerCase() === '.pdf';
}

function getMimeType(ext) {
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function isImage(mimeType) {
  return mimeType.startsWith('image/');
}

module.exports = { downloadTelegramFile, imageToBase64, extractTextFromBuffer, isImage, pdfToDocumentBlock, isPdf, processPdf };
