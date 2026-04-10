const axios = require("axios");

// PASSO 0: Converte tabelas Markdown → lista legível
function converterTabelas(texto) {
  const linhas = texto.split('\n');
  const resultado = [];
  let i = 0;

  while (i < linhas.length) {
    // Detecta início de tabela: linha com | e próxima com |---|
    if (
      linhas[i].includes('|') &&
      i + 1 < linhas.length &&
      /^\|?\s*[-:]+[-| :]*$/.test(linhas[i + 1])
    ) {
      // Extrai headers
      const headers = linhas[i]
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      // Pula a linha separadora
      i += 2;

      // Processa cada linha de dados
      while (i < linhas.length && linhas[i].includes('|') && !/^\|?\s*[-:]+[-| :]*$/.test(linhas[i])) {
        const celulas = linhas[i]
          .split('|')
          .map(c => c.trim())
          .filter(c => c.length > 0);

        // Formata como lista: "Header1: valor | Header2: valor"
        const partes = [];
        for (let j = 0; j < celulas.length; j++) {
          if (headers[j]) {
            partes.push(`<b>${headers[j]}</b>: ${celulas[j]}`);
          } else {
            partes.push(celulas[j]);
          }
        }
        resultado.push(partes.join(' | '));
        i++;
      }
      resultado.push(''); // linha vazia após tabela
    } else {
      resultado.push(linhas[i]);
      i++;
    }
  }

  return resultado.join('\n');
}

// PASSO 1: Limpa qualquer Markdown que o Claude ainda gere
function limparMarkdown(texto) {
  let t = texto;

  // Blocos de código ```lang\n...\n``` → <pre>...</pre>
  t = t.replace(/```[a-z]*\n?([\s\S]*?)```/g, '<pre>$1</pre>');

  // Headers: ## Texto / ### Texto / #### Texto → <b>Texto</b>
  t = t.replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>');

  // Separadores: --- ou *** ou ___ → linha vazia
  t = t.replace(/^[-*_]{3,}$/gm, '');

  // Blockquotes: > texto → texto
  t = t.replace(/^>\s?/gm, '');

  // Negrito itálico: ***texto*** ou **_texto_**
  t = t.replace(/\*{3}([^*]+)\*{3}/g, '<b><i>$1</i></b>');
  t = t.replace(/\*{2}_([^_]+)_\*{2}/g, '<b><i>$1</i></b>');

  // Negrito: **texto**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Negrito: *texto* (single)
  t = t.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  // Itálico: _texto_ (não dentro de palavras)
  t = t.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<i>$1</i>');

  // Código inline: `texto`
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');

  return t;
}

// PASSO 2: Escapa caracteres especiais do HTML que não são tags nossas
function escaparHTML(texto) {
  // Protege tags HTML válidas do Telegram
  const placeholder = [];
  let t = texto.replace(/<(\/?)(?:b|i|code|pre|u|s|a)(?:\s[^>]*)?\s*>/gi, (match) => {
    placeholder.push(match);
    return `%%TAG${placeholder.length - 1}%%`;
  });

  // Escapa & < > que não são parte das nossas tags
  t = t.replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;');
  t = t.replace(/</g, '&lt;');
  t = t.replace(/>/g, '&gt;');

  // Restaura tags protegidas
  t = t.replace(/%%TAG(\d+)%%/g, (_, i) => placeholder[Number(i)]);

  return t;
}

// Pipeline completa: tabelas → markdown → HTML Telegram
function prepararMensagem(texto) {
  const semTabelas = converterTabelas(texto);
  const limpo = limparMarkdown(semTabelas);
  return limpo;
}

// Envia uma única mensagem. Recebe texto já formatado ou cru.
// Se raw=true, não aplica prepararMensagem (já veio formatado do enviarMensagemLonga)
async function sendTelegramMessage(chatId, text, { raw = false } = {}) {
  try {
    console.log(`Enviando mensagem Telegram para ${chatId} (${text.length} chars)...`);
    const formatted = raw ? text : prepararMensagem(text);
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: chatId, text: formatted, parse_mode: 'HTML' }
    );
    console.log(`Mensagem Telegram enviada para ${chatId}`);
  } catch (err) {
    console.error("ERRO Telegram API:", err.response?.status, err.message);
    // Fallback: envia sem parse_mode se HTML inválido (400)
    if (err.response?.status === 400) {
      console.log("Fallback: enviando sem formatação HTML...");
      const textoLimpo = (raw ? text : prepararMensagem(text)).replace(/<[^>]+>/g, '');
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        { chat_id: chatId, text: textoLimpo }
      );
      return;
    }
    throw err;
  }
}

// Divide mensagem longa em partes respeitando HTML e palavras
function dividirMensagem(texto, limite = 3800) {
  if (texto.length <= limite) return [texto];

  const partes = [];
  let restante = texto;

  while (restante.length > 0) {
    if (restante.length <= limite) {
      partes.push(restante);
      break;
    }

    let corte = -1;
    const trecho = restante.substring(0, limite);

    // 1. Tenta quebrar em parágrafo (\n\n)
    const ultimoParagrafo = trecho.lastIndexOf('\n\n');
    if (ultimoParagrafo > limite * 0.3) {
      corte = ultimoParagrafo;
    }

    // 2. Se não deu, tenta quebrar em linha (\n)
    if (corte === -1) {
      const ultimaLinha = trecho.lastIndexOf('\n');
      if (ultimaLinha > limite * 0.3) {
        corte = ultimaLinha;
      }
    }

    // 3. Se não deu, quebra no último espaço (nunca no meio de palavra)
    if (corte === -1) {
      const ultimoEspaco = trecho.lastIndexOf(' ');
      if (ultimoEspaco > limite * 0.3) {
        corte = ultimoEspaco;
      }
    }

    // 4. Fallback: corta no limite (raro, só se não tiver espaços)
    if (corte === -1) {
      corte = limite;
    }

    // Verifica se não estamos cortando no meio de uma tag HTML
    const parte = restante.substring(0, corte);
    const tagAberta = (parte.match(/<[^/][^>]*>/g) || []).length;
    const tagFechada = (parte.match(/<\/[^>]+>/g) || []).length;

    // Se tags abertas > fechadas, fecha elas no fim da parte
    let parteFinal = parte;
    if (tagAberta > tagFechada) {
      // Encontra tags abertas sem fechar
      const tagsAbertas = [];
      const regex = /<(b|i|code|pre|u|s)(?:\s[^>]*)?>/gi;
      const regexFecha = /<\/(b|i|code|pre|u|s)>/gi;
      let m;
      while ((m = regex.exec(parte)) !== null) tagsAbertas.push(m[1].toLowerCase());
      while ((m = regexFecha.exec(parte)) !== null) {
        const idx = tagsAbertas.lastIndexOf(m[1].toLowerCase());
        if (idx !== -1) tagsAbertas.splice(idx, 1);
      }
      // Fecha tags pendentes na ordem reversa
      for (let i = tagsAbertas.length - 1; i >= 0; i--) {
        parteFinal += `</${tagsAbertas[i]}>`;
      }
    }

    partes.push(parteFinal + '\n\n<i>continua... ⬇️</i>');
    restante = restante.substring(corte).replace(/^\n+/, '');
  }

  return partes;
}

// Envia mensagem longa em partes com pausa entre elas
async function enviarMensagemLonga(chatId, texto) {
  const formatado = prepararMensagem(texto);
  const partes = dividirMensagem(formatado, 3800);
  for (let i = 0; i < partes.length; i++) {
    await sendTelegramMessage(chatId, partes[i], { raw: true }); // já formatado
    if (i < partes.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

module.exports = { sendTelegramMessage, enviarMensagemLonga, limparMarkdown, prepararMensagem, dividirMensagem };
