// Memória Evolutiva Fase 2 — Validador Implícito
// Valida/refuta hipóteses implicitamente a partir de cada mensagem da Carol.
// Peso menor que explícita (-0.10 vs -0.25 conforme fórmula em hipoteses.js).

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { validarHipotese, refutarHipotese } = require('./hipoteses');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const STOPWORDS = new Set([
  'o','a','os','as','um','uma','uns','umas','de','da','do','das','dos',
  'e','ou','que','para','pra','por','com','sem','em','na','no','nas','nos',
  'é','são','tô','tou','eu','voce','você','meu','minha','seus','suas',
  'mais','menos','muito','pouco','sim','nao','não','ja','já','tá','ta',
]);

// Normaliza texto → array de palavras: lowercase, sem acentos, sem pontuação, sem stopwords, min 3 chars
function normalizar(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

async function buscarHipotesesAtivas() {
  const { data, error } = await supabase
    .from('hipoteses')
    .select('id, texto, tags, confianca')
    .neq('status', 'arquivada')
    .not('tags', 'is', null);
  if (error) return [];
  return data || [];
}

// Filtra hipóteses cujas tags (normalizadas) interseccionam com palavras da mensagem
function compativeis(hipoteses, palavras) {
  const set = new Set(palavras);
  return hipoteses.filter(h => {
    const tagsNorm = (h.tags || []).flatMap(t => normalizar(t));
    return tagsNorm.some(t => set.has(t));
  });
}

// Chama Haiku pra julgar se msg confirma/refuta/nada em relação à hipótese
async function julgar(hipotese, message, ariaResponse) {
  const prompt = `Hipótese sobre Carol: "${hipotese.texto}"

Mensagem que Carol acabou de enviar: "${message}"
Resposta da ARIA: "${(ariaResponse || '').substring(0, 300)}"

A mensagem de Carol CONFIRMA, REFUTA, ou é NEUTRA em relação à hipótese?

Responda APENAS JSON: {"veredicto": "confirma|refuta|neutra"}
Só diga "confirma" ou "refuta" se houver sinal claro. Caso contrário, "neutra".`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const texto = r.content[0].text.trim().replace(/```json|```/g, '').trim();
    const j = JSON.parse(texto);
    return j.veredicto || 'neutra';
  } catch (e) {
    return 'neutra';
  }
}

async function validarImplicitamente(message, ariaResponse) {
  try {
    const palavras = normalizar(message);
    if (!palavras.length) return;
    const hipoteses = await buscarHipotesesAtivas();
    const candidatas = compativeis(hipoteses, palavras);
    if (!candidatas.length) return;

    // Máx 3 julgamentos por turno (limita custo/latência — fire-and-forget)
    for (const h of candidatas.slice(0, 3)) {
      const veredicto = await julgar(h, message, ariaResponse);
      if (veredicto === 'confirma') {
        await validarHipotese(h.id, { tipo: 'implicita' });
        console.log(`🧠 [Validador] ✓ implícita: "${h.texto.substring(0, 60)}"`);
      } else if (veredicto === 'refuta') {
        await refutarHipotese(h.id, { tipo: 'implicita' });
        console.log(`🧠 [Validador] ✗ implícita: "${h.texto.substring(0, 60)}"`);
      }
    }
  } catch (e) {
    console.log('🧠 [Validador] erro silenciado:', e.message);
  }
}

module.exports = { validarImplicitamente, normalizar, compativeis };
