// ─────────────────────────────────────────────
// MEMÓRIA PERMANENTE — Supabase
// ─────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { detectarContradicao } = require('./detectorContradicao');

// ━━━ MEMÓRIAS (preferências, fatos, padrões) ━━━

async function salvarMemoria(categoria, chave, valor, contexto = null) {
  // Upsert: atualiza se chave já existe na categoria
  const { data: existing } = await supabase
    .from('memorias')
    .select('id')
    .eq('categoria', categoria)
    .eq('chave', chave)
    .limit(1);

  if (existing?.length > 0) {
    const { error } = await supabase
      .from('memorias')
      .update({ valor, contexto, updated_at: new Date().toISOString() })
      .eq('id', existing[0].id);
    if (error) console.error('Erro ao atualizar memória:', error.message);
  } else {
    const { error } = await supabase
      .from('memorias')
      .insert({ categoria, chave, valor, contexto });
    if (error) console.error('Erro ao salvar memória:', error.message);
  }
}

/**
 * Salva fato novo COM trilha de auditoria. Usado pelo extrator de fatos.
 * Diferente de salvarMemoria (UPSERT destrutivo), esta função:
 *  1. INSERT do fato novo (sempre cria nova linha)
 *  1.5. Same-key auto-supersede: outras ativas com mesma (categoria, chave)
 *       viram obsoletas imediatamente
 *  2. Busca antigas ativas da mesma categoria (chaves diferentes)
 *  3. Haiku judge detecta contradições semânticas
 *  4. UPDATE nas antigas contraditas: superseded_at + superseded_by_id
 * Conservador: em erro, comportamento é INSERT puro sem marcar nada.
 */
async function salvarMemoriaComHistorico(categoria, chave, valor, contexto = null) {
  // 1. INSERT do fato novo
  const { data: novaMemoria, error: insertError } = await supabase
    .from('memorias')
    .insert({ categoria, chave, valor, contexto })
    .select('id')
    .single();

  if (insertError) {
    console.error('Erro ao inserir nova memória:', insertError.message);
    return;
  }

  // 1.5. Same-key auto-supersede
  // Mesma (categoria, chave) é ponteiro canônico — antigas viram
  // histórico automaticamente, sem depender do Haiku judge.
  const { error: sameKeyError } = await supabase
    .from('memorias')
    .update({
      superseded_at: new Date().toISOString(),
      superseded_by_id: novaMemoria.id
    })
    .eq('categoria', categoria)
    .eq('chave', chave)
    .neq('id', novaMemoria.id)
    .is('superseded_at', null);

  if (sameKeyError) {
    console.error('Erro em same-key auto-supersede:', sameKeyError.message);
  }

  // 2. Busca antigas ATIVAS da mesma categoria
  // buscarMemorias já filtra superseded_at IS NULL (Fase B)
  const antigas = await buscarMemorias(categoria, 10);
  const candidatas = antigas.filter(m => m.id !== novaMemoria.id);

  if (candidatas.length === 0) return; // primeira da categoria

  // 3. Haiku judge
  const idsContraditos = await detectarContradicao(
    { categoria, chave, valor, contexto },
    candidatas
  );

  if (idsContraditos.length === 0) return;

  // 4. Marca as antigas como superseded
  const { error: updateError } = await supabase
    .from('memorias')
    .update({
      superseded_at: new Date().toISOString(),
      superseded_by_id: novaMemoria.id
    })
    .in('id', idsContraditos);

  if (updateError) {
    console.error('Erro ao marcar memórias supersededs:', updateError.message);
  }
}

/**
 * Lista memórias ATIVAS (não supersededs) ordenadas por updated_at desc.
 * Para incluir memórias supersededs (auditoria, contradição), use SQL raw
 * ou buscarMemoriaPorChave.
 */
async function buscarMemorias(categoria = null, limite = 50) {
  let query = supabase
    .from('memorias')
    .select('*')
    .is('superseded_at', null)
    .order('updated_at', { ascending: false })
    .limit(limite);

  if (categoria) query = query.eq('categoria', categoria);

  const { data, error } = await query;
  if (error) { console.error('Erro ao buscar memórias:', error.message); return []; }
  return data || [];
}

async function buscarMemoriaPorChave(chave) {
  const { data } = await supabase
    .from('memorias')
    .select('*')
    .ilike('chave', `%${chave}%`)
    .limit(5);
  return data || [];
}

// ━━━ MENSAGENS (histórico de conversa) ━━━

async function salvarMensagem(role, content, extras = {}) {
  const { error } = await supabase
    .from('mensagens')
    .insert({
      role,
      content: content.substring(0, 10000), // limita tamanho
      humor: extras.humor || null,
      intent: extras.intent || null,
      extras: extras.dados || {},
    });
  if (error) console.error('Erro ao salvar mensagem:', error.message);
}

async function buscarHistorico(limite = 20) {
  // Pega as N mais RECENTES (DESC + LIMIT) e devolve em ordem cronológica (ASC) pro Claude.
  // Bug anterior: ASC + LIMIT retornava as N MAIS ANTIGAS, fazendo a ARIA conversar com histórico congelado.
  const { data, error } = await supabase
    .from('mensagens')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (error) { console.error('Erro ao buscar histórico:', error.message); return []; }

  return (data || []).reverse().map(m => ({
    role: m.role,
    content: m.content,
  }));
}

async function buscarHistoricoRecente(horas = 24) {
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('mensagens')
    .select('role, content, humor, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true });

  if (error) { console.error('Erro ao buscar histórico recente:', error.message); return []; }
  return data || [];
}

// ━━━ TAREFAS ━━━

async function salvarTarefa(titulo, categoria = 'geral', prioridade = 'média', prazo = null) {
  // Converte prioridade text → int (tabela usa integer)
  const prioMap = { 'baixa': 1, 'média': 2, 'alta': 3, 'urgente': 4 };
  const prioInt = prioMap[prioridade] || 2;
  const { data, error } = await supabase
    .from('tarefas')
    .insert({ titulo, categoria, prioridade: prioInt, prazo, status: 'pendente' })
    .select();
  if (error) console.error('Erro ao salvar tarefa:', error.message);
  return data?.[0] || null;
}

async function listarTarefas(status = 'pendente') {
  const { data, error } = await supabase
    .from('tarefas')
    .select('*')
    .eq('status', status)
    .order('criado_em', { ascending: false })
    .limit(20);
  if (error) { console.error('Erro ao listar tarefas:', error.message); return []; }
  return data || [];
}

async function concluirTarefa(termoBusca) {
  const { data: tarefas } = await supabase
    .from('tarefas')
    .select('*')
    .eq('status', 'pendente')
    .ilike('titulo', `%${termoBusca}%`)
    .limit(5);

  if (!tarefas?.length) return null;

  const tarefa = tarefas[0];
  const { error } = await supabase
    .from('tarefas')
    .update({ status: 'concluida', concluida_em: new Date().toISOString() })
    .eq('id', tarefa.id);

  if (error) { console.error('Erro ao concluir tarefa:', error.message); return null; }

  // Salva vitória na memória
  await salvarMemoria('vitoria', `concluiu_${Date.now()}`, tarefa.titulo, 'Tarefa concluída');

  return tarefa;
}

// ━━━ PESSOAS ━━━

async function salvarPessoa(nome, relacionamento = null, extras = {}) {
  // Schema real de pessoas tem 'notas' (text), não 'detalhes' (jsonb).
  // Serializa extras → string e faz append em notas.
  const notasNova = (extras && typeof extras === 'object' && Object.keys(extras).length)
    ? Object.entries(extras).map(([k, v]) => `${k}: ${v}`).join('; ')
    : '';
  const { data: existing } = await supabase
    .from('pessoas')
    .select('id, notas')
    .ilike('nome', nome)
    .limit(1);

  if (existing?.length > 0) {
    const notasAtuais = existing[0].notas || '';
    const { error } = await supabase
      .from('pessoas')
      .update({
        relacionamento: relacionamento || undefined,
        notas: notasNova ? (notasAtuais ? `${notasAtuais}\n${notasNova}` : notasNova) : notasAtuais,
      })
      .eq('id', existing[0].id);
    if (error) console.error('Erro ao atualizar pessoa:', error.message);
  } else {
    const { error } = await supabase
      .from('pessoas')
      .insert({ nome, relacionamento, notas: notasNova || null });
    if (error) console.error('Erro ao salvar pessoa:', error.message);
  }
}

async function buscarPessoa(termo) {
  const { data } = await supabase
    .from('pessoas')
    .select('*')
    .ilike('nome', `%${termo}%`)
    .limit(5);
  return data || [];
}

// ━━━ HUMOR ━━━

function detectarHumor(texto) {
  const t = texto.toLowerCase();
  if (/ansiosa|ansiedade|nervosa|preocupada|apreensiva|inquieta|agitada/i.test(t)) return 'ansiosa';
  if (/cansada|exausta|sem energia|esgotada|morta|acabada|dormindo/i.test(t)) return 'cansada';
  if (/animada|empolgada|feliz|top|incrível|maravilh|show|demais|amando/i.test(t)) return 'animada';
  if (/triste|mal|chorando|chorei|down|péssim|horrível|deprimida/i.test(t)) return 'triste';
  if (/travada|paralisia|não consigo|bloqueada|shutdown|procrastin|emperr/i.test(t)) return 'travada';
  if (/estressada|stress|pânico|surto|pirand|enlouquecend/i.test(t)) return 'estressada';
  if (/bem|ok|tranquila|de boa|suave|leve|calma/i.test(t)) return 'calma';
  return null;
}

async function salvarHumor(humor, energia = null, contexto = null) {
  const { error } = await supabase
    .from('humor_log')
    .insert({ humor, energia, contexto });
  if (error) console.error('Erro ao salvar humor:', error.message);
}

// ━━━ EXTRAÇÃO AUTOMÁTICA DE FATOS ━━━

const SYSTEM_EXTRATOR = `Você é o extrator de memória da ARIA. Sua missão: identificar fatos sobre a Carol que valham a pena lembrar, usando CHAVES CANÔNICAS estáveis por tópico, nunca inventando chaves novas quando uma canônica existe.

CATEGORIAS (use SOMENTE estas):
- saude        → corpo, prática física, terapia, medicação, sintomas, diagnóstico
- rotina       → hábitos, horários recorrentes, ritmos do dia
- preferencia  → gostos, valores, modos de fazer, estilo
- trabalho     → empresa, função, projetos, ferramentas, clientes
- meta         → intenções, planos de futuro, desejos declarados
- emocao       → estados emocionais nomeados
- pessoa       → identidade de terceiros (nomes, relações, atributos)

CHAVES CANÔNICAS — use SEMPRE estas quando o tópico aparecer:

saude: yoga, exercicio, alimentacao, sono, agua, medicacao, psicologo, psiquiatra, terapia, diagnostico_tdah, sintoma_X
rotina: horario_acordar, horario_dormir, manha, tarde, noite, fim_de_semana, ritual_X
preferencia: comida, musica, leitura, ambiente_trabalho, comunicacao, decisao, ritmo, lente_X
trabalho: empresa, funcao, software_principal, projeto_atual, cliente_X, parceiro_X
meta: objetivo_curto, objetivo_medio, objetivo_longo, plano_X
emocao: estado_atual, padrao_X
pessoa: nome_X, relacao_X, atributo_X

REGRAS DE CHAVE:

1. Se o tópico existe na lista canônica, USE essa chave EXATA.
   "Voltou a fazer yoga essa semana" → chave: "yoga"
   "Está sem fazer yoga há semanas" → chave: "yoga" (mesma!)

2. Se o tópico é genuinamente novo e não tem chave canônica:
   - use snake_case curto, substantivo do tópico, SEM adjetivos
   - SEM verbos ("pratica_X", "fez_X" são proibidos)
   - SEM datas ou números na chave
   - Errado: "pratica_yoga", "yoga_35min", "retomou_yoga"
   - Certo: "yoga"

3. O VALOR carrega o estado atual; a chave é o ponteiro permanente.
   Se Carol mudou de opinião, mude o VALOR — a chave continua a mesma.

REGRA HUMOR — CRÍTICO (não inferir além do que ela disse):

humor_detectado SÓ tem valor não-null quando a mensagem da Carol contém AUTORREPORTE EMOCIONAL EXPLÍCITO sobre o estado dela AGORA.

Autorreporte explícito (humor preenchido):
- "to ansiosa" → ansiosa
- "me sinto travada" → travada
- "tô empolgada" → animada
- "cansada hoje" → cansada
- "tô bem" com tom positivo claro → calma

NÃO é autorreporte (humor=null):
- Falar SOBRE emoção como tópico ("padrão de ansiedade", "comentar com psicólogo sobre X") → null
- Frases neutras de descarte ("Nada", "Tá bem", "5", "ok", "sim") → null
- Refletir sobre comportamento sem declarar estado ("não tenho feito X e isso me incomoda") → null
- Mensagens factuais sobre o dia ("fiz yoga 40 min", "voltei pra casa") → null
- Falar sobre observação de padrão próprio ("percebi que faço X") → null

EXCEÇÃO: empolgação clara em conquista pode marcar animada ("voltei a fazer yoga!", "consegui!", "deu certo!"). Só se tom inequívoco.

EM DÚVIDA, retorne null. Falso null é melhor que falso humor — humor inferido errado vira ruído no briefing e quebra confiança da Carol.

EXEMPLOS:

Mensagem: "Não tenho feito yoga há semanas e isso me incomoda."
ERRADO: {"categoria": "rotina", "chave": "pulou_yoga_semanas", "valor": "está sem fazer há semanas"}
CERTO:  {"categoria": "saude", "chave": "yoga", "valor": "está sem praticar há semanas, sente incômodo"}

Mensagem: "Voltei a fazer yoga essa semana, segunda e quarta."
CERTO:  {"categoria": "saude", "chave": "yoga", "valor": "voltou a praticar esta semana, fez segunda e quarta"}

Mensagem: "Meu psicólogo se chama Claudecy."
CERTO:  [
  {"categoria": "saude", "chave": "psicologo", "valor": "faz acompanhamento, psicólogo se chama Claudecy"},
  {"categoria": "pessoa", "chave": "nome_claudecy", "valor": "psicólogo da Carol"}
]

Mensagem: "Tô usando Archicad no projeto Doutorama."
CERTO:  [
  {"categoria": "trabalho", "chave": "software_principal", "valor": "Archicad"},
  {"categoria": "trabalho", "chave": "projeto_atual", "valor": "Doutorama"}
]

PRINCÍPIO FINAL: chave estável + valor que evolui = memória que não fragmenta.`;

async function extrairEsalvarFatos(mensagem, resposta) {
  try {
    const result = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      system: SYSTEM_EXTRATOR,
      messages: [{
        role: 'user',
        content: `Mensagem da Carol: "${mensagem}"
Resposta da ARIA: "${resposta.substring(0, 200)}"

Extraia SOMENTE fatos novos ou que atualizam algo conhecido. Se nada relevante, retorne {"fatos":[]}.

Responda APENAS com JSON válido:
{
  "fatos": [
    {"categoria": "...", "chave": "...", "valor": "...", "contexto": "como soube"}
  ],
  "pessoas_mencionadas": [{"nome": "...", "relacionamento": "..."}],
  "humor_detectado": "ansiosa|cansada|animada|triste|travada|estressada|calma|null"
}`
      }]
    });

    const texto = result.content[0].text.trim().replace(/```json|```/g,'').trim();
    const dados = JSON.parse(texto);

    // Salva fatos
    if (dados.fatos?.length > 0) {
      for (const f of dados.fatos) {
        await salvarMemoriaComHistorico(f.categoria, f.chave, f.valor, f.contexto);
      }
      console.log(`🧠 [Memória] ${dados.fatos.length} fato(s) salvo(s)`);
    }

    // Salva pessoas via CRM (mais inteligente)
    if (dados.pessoas_mencionadas?.length > 0) {
      try {
        const { salvarOuAtualizarPessoa, extrairPessoasDaMensagem } = require('./crm');
        const pessoasDetalhadas = await extrairPessoasDaMensagem(mensagem);
        if (pessoasDetalhadas) {
          for (const p of pessoasDetalhadas) {
            await salvarOuAtualizarPessoa(p);
          }
          console.log(`👥 [CRM] ${pessoasDetalhadas.length} pessoa(s) salva(s)`);
        } else {
          // Fallback: salva básico
          for (const p of dados.pessoas_mencionadas) {
            if (p.nome && p.nome.toLowerCase() !== 'carol') {
              await salvarOuAtualizarPessoa({ nome: p.nome, relacionamento: p.relacionamento });
            }
          }
        }
      } catch(e) {
        // Fallback antigo
        for (const p of dados.pessoas_mencionadas) {
          if (p.nome && p.nome.toLowerCase() !== 'carol') {
            await salvarPessoa(p.nome, p.relacionamento);
          }
        }
      }
    }

    // Salva humor
    if (dados.humor_detectado) {
      await salvarHumor(dados.humor_detectado, null, mensagem.substring(0, 100));
    }

  } catch(e) {
    // Silencia erros — extração é best-effort
    console.log('🧠 [Memória] Extração não processada:', e.message);
  }
}

// ━━━ BUILD MEMORY CONTEXT ━━━

async function buildMemoryContext() {
  let ctx = '';

  // Memórias recentes por categoria
  const memorias = await buscarMemorias(null, 30);
  if (memorias.length > 0) {
    const porCategoria = {};
    memorias.forEach(m => {
      if (!porCategoria[m.categoria]) porCategoria[m.categoria] = [];
      porCategoria[m.categoria].push(`${m.chave}: ${m.valor}`);
    });

    ctx += '\n━━━ MEMÓRIA PERMANENTE DA CAROL ━━━';
    for (const [cat, items] of Object.entries(porCategoria)) {
      ctx += `\n[${cat.toUpperCase()}] ${items.slice(0, 5).join(' | ')}`;
    }
  }

  // Tarefas abertas
  const tarefas = await listarTarefas('aberta');
  if (tarefas.length > 0) {
    ctx += '\n\n━━━ TAREFAS PENDENTES ━━━';
    tarefas.slice(0, 5).forEach(t => {
      ctx += `\n• ${t.titulo} (${t.prioridade})`;
    });
  }

  // Humor recente
  const { data: humores } = await supabase
    .from('humor_log')
    .select('humor, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  if (humores?.length > 0) {
    const ultimo = humores[0];
    ctx += `\n\n━━━ ESTADO EMOCIONAL ━━━`;
    ctx += `\nÚltimo humor detectado: ${ultimo.humor}`;
    if (humores.length > 1) {
      ctx += ` (antes: ${humores.slice(1).map(h => h.humor).join(', ')})`;
    }
  }

  // Pessoas: agora injetadas contextualmente em generateResponse via
  // crm.buildPessoasContextoMensagem(nomes), filtrando só as mencionadas no turno atual.

  return ctx;
}

// ━━━ AÇÕES PENDENTES (guard de confirmação para Calendar) ━━━

const ACAO_PENDENTE_TIMEOUT_MS = 5 * 60 * 1000;

async function salvarAcaoPendente(chatId, { tipo, params }) {
  const { error } = await supabase
    .from('acoes_pendentes')
    .upsert({
      chat_id: chatId,
      tipo,
      params,
      criada_em: new Date().toISOString(),
    }, { onConflict: 'chat_id' });
  if (error) console.error('Erro ao salvar ação pendente:', error.message);
}

async function buscarAcaoPendente(chatId) {
  const { data, error } = await supabase
    .from('acoes_pendentes')
    .select('tipo, params, criada_em')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) { console.error('Erro ao buscar ação pendente:', error.message); return null; }
  if (!data) return null;
  const idade = Date.now() - new Date(data.criada_em).getTime();
  if (idade > ACAO_PENDENTE_TIMEOUT_MS) {
    await limparAcaoPendente(chatId);
    return null;
  }
  return { tipo: data.tipo, params: data.params, criadaEm: data.criada_em };
}

async function limparAcaoPendente(chatId) {
  const { error } = await supabase
    .from('acoes_pendentes')
    .delete()
    .eq('chat_id', chatId);
  if (error) console.error('Erro ao limpar ação pendente:', error.message);
}

// ━━━ IDEMPOTÊNCIA WEBHOOK (Bug #8) ━━━

// INSERT atômico via PK conflict. Retorna { duplicado: true } se update_id já
// foi processado, { duplicado: false } se é primeira vez.
// Lazy cleanup: 1% das chamadas, deleta rows > 24h (não-bloqueante).
async function marcarUpdateProcessado(updateId) {
  if (!updateId) return { duplicado: false }; // fail-open se falta update_id
  const { error } = await supabase
    .from('webhook_updates')
    .insert({ update_id: updateId })
    .select()
    .single();

  if (error?.code === '23505') return { duplicado: true }; // PK conflict = retry Telegram
  if (error) console.error('Erro idempotência webhook (não-bloqueante):', error.message);

  // Lazy cleanup (1% das vezes, fire-and-forget)
  if (Math.random() < 0.01) {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    supabase.from('webhook_updates').delete().lt('processado_em', limite)
      .then(({ error: e }) => { if (e) console.error('Cleanup webhook_updates:', e.message); });
  }

  return { duplicado: false };
}

// ━━━ COMPATIBILIDADE — funções do memory.js antigo ━━━

const fs = require('fs');
const path = require('path');
const PROFILE_FILE = path.join(process.cwd(), 'data', 'carol-profile.json');

function loadCarolProfile() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

// getHistory agora busca do Supabase (com fallback pro JSON local)
async function getHistory() {
  try {
    const hist = await buscarHistorico(20);
    if (hist.length > 0) return hist;
  } catch(e) {
    console.log('⚠️ Fallback para histórico local');
  }
  // Fallback: JSON local
  const MEMORY_FILE = path.join(process.cwd(), 'data', 'memory.json');
  try {
    const mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    return (mem.conversations || []).map(m => ({ role: m.role, content: m.content }));
  } catch { return []; }
}

// addMessage agora salva em ambos (Supabase + JSON local)
async function addMessage(role, content) {
  // Supabase
  const humor = detectarHumor(content);
  await salvarMensagem(role, content, { humor });
  if (humor && role === 'user') await salvarHumor(humor, null, content.substring(0, 100));

  // JSON local (compatibilidade)
  const MEMORY_FILE = path.join(process.cwd(), 'data', 'memory.json');
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let mem;
    try { mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { mem = { conversations: [] }; }
    mem.conversations.push({ role, content, timestamp: new Date().toISOString() });
    if (mem.conversations.length > 30) mem.conversations = mem.conversations.slice(-30);
    mem.last_updated = new Date().toISOString();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf-8');
  } catch(e) {}
}

// getMemorySummary agora inclui Supabase
async function getMemorySummary() {
  const supabaseCtx = await buildMemoryContext();

  // Perfil do JSON local
  const profile = loadCarolProfile();
  let profileCtx = '';
  if (profile) {
    const p = profile.profile || profile.identidade || {};
    const h = profile.health || profile.saude || {};
    const tdah = profile.tdah_profile || profile.padroes_tdah || {};
    const nome = p.preferred_name || p.como_chamar || 'Carol';
    const profissao = p.profession || p.profissao || '';
    const diagnosticos = h.diagnoses || h.diagnosticos || [];
    const works = tdah.what_works || tdah.o_que_melhora || [];

    profileCtx = `\n━━━ PERFIL ━━━\n${nome}, ${profissao}\nDiagnósticos: ${diagnosticos.join(', ')}\nO que funciona: ${works.join(', ')}`;
  }

  return profileCtx + supabaseCtx;
}

module.exports = {
  // Novas funções Supabase
  salvarMemoria,
  salvarMemoriaComHistorico,
  buscarMemorias,
  buscarMemoriaPorChave,
  salvarMensagem,
  buscarHistorico,
  buscarHistoricoRecente,
  salvarTarefa,
  listarTarefas,
  concluirTarefa,
  salvarPessoa,
  buscarPessoa,
  extrairEsalvarFatos,
  buildMemoryContext,
  detectarHumor,
  salvarHumor,
  salvarAcaoPendente,
  buscarAcaoPendente,
  limparAcaoPendente,
  marcarUpdateProcessado,
  // Compatibilidade
  addMessage,
  getHistory,
  getMemorySummary,
  loadCarolProfile,
  // Re-export do antigo (para não quebrar imports existentes)
  addVictory: async (v) => await salvarMemoria('vitoria', `vitoria_${Date.now()}`, v, 'registrada pela ARIA'),
  addTask: async (t, p) => await salvarTarefa(t, 'geral', p || 'média'),
  updateProfile: async (u) => { for (const [k,v] of Object.entries(u)) { await salvarMemoria('perfil', k, String(v)); } },
};
