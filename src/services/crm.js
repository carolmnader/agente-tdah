const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const USER_ID = 'carol';

// ── CRUD de pessoas ──────────────────────────────────────────────────────────

const salvarOuAtualizarPessoa = async (dados) => {
  const { data: existente } = await supabase
    .from('pessoas').select('*')
    .eq('user_id', USER_ID)
    .ilike('nome', dados.nome)
    .single();

  if (existente) {
    const atualizado = {
      ...existente,
      apelidos: [...new Set([...(existente.apelidos || []), ...(dados.apelidos || [])])],
      notas: dados.notas ? (existente.notas ? existente.notas + '\n' + dados.notas : dados.notas) : existente.notas,
      contato: dados.contato || existente.contato,
      aniversario: dados.aniversario || existente.aniversario,
      relacionamento: dados.relacionamento || existente.relacionamento,
      ultimo_contato: new Date().toISOString(),
    };
    await supabase.from('pessoas').update(atualizado).eq('id', existente.id);
    return { acao: 'atualizado', pessoa: atualizado };
  } else {
    const nova = { user_id: USER_ID, ...dados, ultimo_contato: new Date().toISOString() };
    const { data } = await supabase.from('pessoas').insert(nova).select().single();
    return { acao: 'criado', pessoa: data };
  }
};

const buscarPessoaInteligente = async (termo) => {
  const { data } = await supabase.from('pessoas')
    .select('*')
    .eq('user_id', USER_ID)
    .or(`nome.ilike.%${termo}%,notas.ilike.%${termo}%`);

  if (data?.length) return data;

  // Busca em apelidos (array)
  const { data: todos } = await supabase.from('pessoas')
    .select('*').eq('user_id', USER_ID);

  return (todos || []).filter(p =>
    (p.apelidos || []).some(a => a.toLowerCase().includes(termo.toLowerCase()))
  );
};

const listarPessoas = async () => {
  const { data } = await supabase.from('pessoas')
    .select('*').eq('user_id', USER_ID)
    .order('ultimo_contato', { ascending: false });
  return data || [];
};

const buscarAniversariosProximos = async (dias = 7) => {
  const hoje = new Date();
  const pessoas = await listarPessoas();

  return pessoas.filter(p => {
    if (!p.aniversario) return false;
    const aniv = new Date(p.aniversario);
    const proxAniv = new Date(hoje.getFullYear(), aniv.getMonth(), aniv.getDate());
    if (proxAniv < hoje) proxAniv.setFullYear(hoje.getFullYear() + 1);
    const diff = (proxAniv - hoje) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= dias;
  });
};

// ── Extração automática de pessoas das mensagens ──────────────────────────────

const extrairPessoasDaMensagem = async (mensagem) => {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Analise esta mensagem e extraia informações sobre pessoas mencionadas. Retorne APENAS JSON válido ou null.

Mensagem: "${mensagem}"

Se houver pessoas mencionadas com informações novas, retorne array:
[{
  "nome": "Nome da Pessoa",
  "apelidos": ["apelido1"],
  "relacionamento": "amiga|familiar|profissional|medico|outro",
  "contato": "telefone ou email se mencionado",
  "aniversario": "YYYY-MM-DD se mencionado",
  "notas": "informação relevante sobre a pessoa"
}]

Exemplos:
- "meu psicólogo Dr. João atende sexta às 13h" → [{"nome":"Dr. João","relacionamento":"profissional","notas":"psicólogo, atende sexta às 13h"}]
- "almoço com minha amiga Marcela" → [{"nome":"Marcela","relacionamento":"amiga"}]
- "aniversário da Ana é dia 15/05" → [{"nome":"Ana","aniversario":"2026-05-15"}]

Retorne null se não houver pessoas novas para salvar. Não inclua "Carol" como pessoa.`
      }]
    });

    const texto = resp.content[0].text.trim().replace(/```json|```/g, '').trim();
    if (texto === 'null' || !texto.startsWith('[')) return null;
    return JSON.parse(texto);
  } catch(e) {
    return null;
  }
};

// ── Contexto de pessoas para o prompt ────────────────────────────────────────

const buildPessoasContext = async () => {
  const pessoas = await listarPessoas();
  if (!pessoas.length) return '';

  let ctx = '\n━━━ PESSOAS IMPORTANTES ━━━\n';
  pessoas.slice(0, 15).forEach(p => {
    ctx += `• ${p.nome} (${p.relacionamento || 'contato'})`;
    if (p.contato) ctx += ` | 📞 ${p.contato}`;
    if (p.notas) ctx += ` | ${p.notas.substring(0, 80)}`;
    ctx += '\n';
  });
  return ctx;
};

// ── Contexto contextual (apenas pessoas mencionadas na conversa atual) ──────

const buildPessoasContextoMensagem = async (nomes, preferidas = {}) => {
  if (!nomes?.length) return '';
  const pessoas = [];
  for (const nome of nomes) {
    const pref = preferidas[nome.toLowerCase()];
    if (pref) { pessoas.push(pref); continue; }
    const matches = await buscarPessoaInteligente(nome);
    if (matches.length > 0) pessoas.push(matches[0]);
  }
  if (!pessoas.length) return '';

  let ctx = '\n━━━ PESSOAS NESTA CONVERSA ━━━\n';
  pessoas.forEach(p => {
    ctx += `• ${p.nome}`;
    if (p.relacionamento) ctx += ` (${p.relacionamento})`;
    if (p.notas) ctx += ` — ${p.notas.substring(0, 120)}`;
    if (p.ultimo_contato) {
      ctx += ` | última menção: ${new Date(p.ultimo_contato).toLocaleDateString('pt-BR')}`;
    }
    ctx += '\n';
  });
  return ctx;
};

// ── Resposta pós-evento ───────────────────────────────────────────────────────

const gerarPerguntaPosEvento = async (nomeEvento) => {
  return `✨ Como foi <b>${nomeEvento}</b>?\n\nQuer que eu salve alguma memória ou informação sobre o evento? Pode me contar em áudio ou texto! 💙`;
};

// ── Formatação para Telegram ──────────────────────────────────────────────────

const formatarPessoa = (p) => {
  let txt = `👤 <b>${p.nome}</b>`;
  if (p.relacionamento) txt += ` (${p.relacionamento})`;
  if (p.contato) txt += `\n📞 ${p.contato}`;
  if (p.aniversario) {
    const aniv = new Date(p.aniversario);
    txt += `\n🎂 ${aniv.toLocaleDateString('pt-BR', {day:'numeric', month:'long'})}`;
  }
  if (p.notas) txt += `\n📝 ${p.notas.substring(0, 150)}`;
  if (p.ultimo_contato) {
    const ult = new Date(p.ultimo_contato);
    txt += `\n🕐 Último contato: ${ult.toLocaleDateString('pt-BR')}`;
  }
  return txt;
};

module.exports = {
  salvarOuAtualizarPessoa, buscarPessoaInteligente, listarPessoas,
  buscarAniversariosProximos, extrairPessoasDaMensagem,
  buildPessoasContext, buildPessoasContextoMensagem,
  gerarPerguntaPosEvento, formatarPessoa
};
