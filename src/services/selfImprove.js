const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { loadMemory, saveMemory } = require('./memory');
const { saveToObsidian } = require('./obsidian');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EVOLVED_PROMPT_FILE = path.join(process.cwd(), 'data', 'evolved-prompt.json');

// ─────────────────────────────────────────────
// Carrega o prompt evoluído (ou usa o padrão)
// ─────────────────────────────────────────────
function loadEvolvedPrompt() {
  try {
    if (fs.existsSync(EVOLVED_PROMPT_FILE)) {
      const data = JSON.parse(fs.readFileSync(EVOLVED_PROMPT_FILE, 'utf-8'));
      return data.additions || '';
    }
  } catch {}
  return '';
}

// ─────────────────────────────────────────────
// REFLEXÃO SEMANAL — ARIA analisa a si mesma
// ─────────────────────────────────────────────
async function weeklyReflection() {
  console.log('🔮 [SelfImprove] Iniciando reflexão semanal...');
  const memory = loadMemory();

  if (memory.conversations.length < 5) {
    console.log('🔮 [SelfImprove] Poucas conversas para refletir ainda.');
    return;
  }

  const recentConversations = memory.conversations.slice(-40)
    .map(m => `${m.role}: ${m.content.substring(0, 200)}`)
    .join('\n');

  const victories = memory.profile.victories.slice(-10)
    .map(v => `- ${v.text} (${v.date})`).join('\n');

  const prompt = `Você é ARIA, uma assistente de IA para Carol, uma empreendedora com TDAH.

Analise estas conversas recentes e gere uma reflexão profunda:

CONVERSAS RECENTES:
${recentConversations}

VITÓRIAS REGISTRADAS:
${victories || 'Nenhuma ainda'}

PADRÕES JÁ IDENTIFICADOS:
${memory.profile.tdah_patterns.join(', ') || 'Nenhum ainda'}

Responda em JSON válido sem markdown:
{
  "padroes_novos": ["padrão 1", "padrão 2"],
  "o_que_funcionou": ["estratégia 1", "estratégia 2"],
  "o_que_nao_funcionou": ["problema 1"],
  "horario_pico_energia": "manhã|tarde|noite|variável",
  "gatilhos_sobrecarga": ["gatilho 1", "gatilho 2"],
  "vitoria_da_semana": "descrição da maior vitória",
  "adicoes_ao_prompt": "instruções específicas para melhorar como atendo Carol baseado nos padrões observados — máximo 200 palavras",
  "mensagem_para_carol": "mensagem carinhosa sobre o progresso dela esta semana — máximo 3 linhas",
  "resumo_obsidian": "resumo detalhado da semana para salvar no Obsidian — pode ser longo"
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0].text.trim();
    const reflection = JSON.parse(text);

    // Atualiza memória com novos padrões
    if (reflection.padroes_novos?.length) {
      const existingPatterns = memory.profile.tdah_patterns || [];
      const allPatterns = [...new Set([...existingPatterns, ...reflection.padroes_novos])];
      memory.profile.tdah_patterns = allPatterns.slice(-20);
    }

    if (reflection.horario_pico_energia) {
      memory.profile.peak_energy_time = reflection.horario_pico_energia;
    }

    if (reflection.gatilhos_sobrecarga?.length) {
      memory.profile.overload_triggers = reflection.gatilhos_sobrecarga;
    }

    // Salva insights semanais
    const weekInsight = {
      week: new Date().toISOString().split('T')[0],
      o_que_funcionou: reflection.o_que_funcionou,
      o_que_nao_funcionou: reflection.o_que_nao_funcionou,
      vitoria: reflection.vitoria_da_semana,
    };
    memory.weekly_insights = [...(memory.weekly_insights || []), weekInsight].slice(-12);
    saveMemory(memory);

    // Atualiza o prompt evoluído
    if (reflection.adicoes_ao_prompt) {
      const evolved = { additions: reflection.adicoes_ao_prompt, updated: new Date().toISOString() };
      const dir = path.dirname(EVOLVED_PROMPT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(EVOLVED_PROMPT_FILE, JSON.stringify(evolved, null, 2));
    }

    // Salva reflexão no Obsidian
    const obsidianContent = `
## 🔮 Reflexão Semanal — ${new Date().toLocaleDateString('pt-BR')}

### 🏆 Vitória da semana
${reflection.vitoria_da_semana || 'Não identificada'}

### ✅ O que funcionou
${(reflection.o_que_funcionou || []).map(i => `- ${i}`).join('\n')}

### ⚠️ O que não funcionou
${(reflection.o_que_nao_funcionou || []).map(i => `- ${i}`).join('\n')}

### 🧠 Padrões TDAH identificados
${(reflection.padroes_novos || []).map(i => `- ${i}`).join('\n')}

### ⚡ Horário de pico de energia
${reflection.horario_pico_energia || 'Não identificado'}

### 🔥 Gatilhos de sobrecarga
${(reflection.gatilhos_sobrecarga || []).map(i => `- ${i}`).join('\n')}

### 📝 Detalhes
${reflection.resumo_obsidian || ''}

---
_Reflexão gerada automaticamente pela ARIA_
`;

    saveToObsidian('thinking', obsidianContent);

    // Salva também em pasta própria
    const reflDir = path.join(process.env.OBSIDIAN_VAULT_PATH, 'ARIA', 'Reflexões Semanais');
    if (!fs.existsSync(reflDir)) fs.mkdirSync(reflDir, { recursive: true });
    const reflFile = path.join(reflDir, `Reflexão ${new Date().toISOString().split('T')[0]}.md`);
    fs.writeFileSync(reflFile, `---\ndata: ${new Date().toISOString().split('T')[0]}\ntags: [reflexao, aria, semanal]\n---\n${obsidianContent}`, 'utf-8');

    console.log('✅ [SelfImprove] Reflexão semanal concluída!');
    return reflection.mensagem_para_carol;

  } catch (error) {
    console.error('Erro na reflexão semanal:', error.message);
  }
}

// ─────────────────────────────────────────────
// RESUMO DIÁRIO — todo dia às 21h
// ─────────────────────────────────────────────
async function dailySummary() {
  const memory = loadMemory();
  const today = new Date().toISOString().split('T')[0];

  const todayMessages = memory.conversations.filter(m => m.timestamp?.startsWith(today));
  if (todayMessages.length < 2) return;

  const victories = memory.profile.victories
    .filter(v => v.date === today)
    .map(v => v.text);

  const summary = `
## 📊 Resumo do dia — ${new Date().toLocaleDateString('pt-BR')}

**Mensagens hoje:** ${todayMessages.length}
**Vitórias:** ${victories.length > 0 ? victories.join(', ') : 'Nenhuma registrada hoje — mas amanhã é outro dia! 💜'}
**Tarefas abertas:** ${memory.open_tasks.filter(t => !t.done).length}
`;

  saveToObsidian('daily', summary);
  console.log('📊 [SelfImprove] Resumo diário salvo no Obsidian');
}

module.exports = { weeklyReflection, dailySummary, loadEvolvedPrompt };
