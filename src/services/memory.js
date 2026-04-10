const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(process.cwd(), 'data', 'memory.json');
const PROFILE_FILE = path.join(process.cwd(), 'data', 'carol-profile.json');

// Garante que a pasta data existe
function ensureDataDir() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Estrutura padrão de memória
function defaultMemory() {
  return {
    profile: {
      name: 'Carol',
      tdah_patterns: [],        // padrões detectados ao longo do tempo
      peak_energy_time: null,   // horário de mais energia
      biggest_struggles: [],    // dificuldades mais frequentes
      victories: [],            // vitórias registradas
      preferred_style: 'curto', // estilo de resposta preferido
    },
    conversations: [],          // histórico das últimas 30 mensagens
    open_tasks: [],             // tarefas em aberto
    weekly_insights: [],        // insights semanais
    last_updated: null,
  };
}

// Carrega memória do arquivo
function loadMemory() {
  ensureDataDir();
  if (!fs.existsSync(MEMORY_FILE)) {
    const mem = defaultMemory();
    saveMemory(mem);
    return mem;
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch {
    return defaultMemory();
  }
}

// Salva memória no arquivo
function saveMemory(memory) {
  ensureDataDir();
  memory.last_updated = new Date().toISOString();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
}

// Adiciona mensagem ao histórico (mantém últimas 30)
function addMessage(role, content) {
  const mem = loadMemory();
  mem.conversations.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  if (mem.conversations.length > 30) {
    mem.conversations = mem.conversations.slice(-30);
  }
  saveMemory(mem);
}

// Retorna histórico formatado para o Claude
function getHistory() {
  const mem = loadMemory();
  return mem.conversations.map(m => ({
    role: m.role,
    content: m.content,
  }));
}

// Atualiza perfil da Carol com novas informações detectadas
function updateProfile(updates) {
  const mem = loadMemory();
  Object.assign(mem.profile, updates);
  saveMemory(mem);
}

// Registra vitória
function addVictory(victory) {
  const mem = loadMemory();
  mem.profile.victories.push({
    text: victory,
    date: new Date().toISOString().split('T')[0],
  });
  // Guarda só as últimas 50 vitórias
  if (mem.profile.victories.length > 50) {
    mem.profile.victories = mem.profile.victories.slice(-50);
  }
  saveMemory(mem);
}

// Adiciona tarefa em aberto
function addTask(task, priority = 'média') {
  const mem = loadMemory();
  mem.open_tasks.push({
    id: Date.now(),
    text: task,
    priority,
    created: new Date().toISOString().split('T')[0],
    done: false,
  });
  saveMemory(mem);
}

// Marca tarefa como concluída
function completeTask(taskId) {
  const mem = loadMemory();
  const task = mem.open_tasks.find(t => t.id === taskId);
  if (task) {
    task.done = true;
    task.completed_at = new Date().toISOString().split('T')[0];
    addVictory(`Concluiu: ${task.text}`);
  }
  saveMemory(mem);
}

// Carrega o perfil completo da Carol
function loadCarolProfile() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

// Retorna resumo da memória para contexto
function getMemorySummary() {
  const mem = loadMemory();
  const profile = loadCarolProfile();
  const openTasks = mem.open_tasks.filter(t => !t.done).slice(-5);
  const recentVictories = mem.profile.victories.slice(-3);
  const patterns = mem.profile.tdah_patterns.slice(-3);

  let summary = '';

  if (profile) {
    const p = profile.profile || profile.identidade || {};
    const h = profile.health || profile.saude || {};
    const tdah = profile.tdah_profile || profile.padroes_tdah || {};

    const nome = p.preferred_name || p.como_chamar || 'Carol';
    const profissao = p.profession || p.profissao || '';
    const diagnosticos = h.diagnoses || h.diagnosticos || [];
    const meds = h.medications?.morning
      ? h.medications.morning.map(m => `${m.name} ${m.dose}`).join(', ')
      : (h.medicamentos || []).map(m => `${m.nome} ${m.dose}`).join(', ');
    const works = tdah.what_works || tdah.o_que_melhora || [];
    const doesntWork = tdah.what_doesnt_work || tdah.o_que_piora || [];
    const instrucoes = profile.aria_instructions || (profile.instrucoes_para_aria?.alertas || []).join(' | ');

    summary += `\n━━━ PERFIL DA CAROL ━━━`;
    summary += `\nNome: ${nome} (${profissao})`;
    summary += `\nDiagnósticos: ${diagnosticos.join(', ')}`;
    summary += `\nMedicação: ${meds}`;
    summary += `\nO que funciona: ${works.join(', ')}`;
    summary += `\nO que piora: ${doesntWork.join(', ')}`;
    summary += `\nInstruções: ${instrucoes}`;
  }

  if (openTasks.length > 0) {
    summary += `\nTarefas em aberto da Carol: ${openTasks.map(t => `"${t.text}" (${t.priority})`).join(', ')}`;
  }
  if (recentVictories.length > 0) {
    summary += `\nVitórias recentes: ${recentVictories.map(v => v.text).join(', ')}`;
  }
  if (patterns.length > 0) {
    summary += `\nPadrões TDAH observados: ${patterns.join(', ')}`;
  }
  if (mem.profile.peak_energy_time) {
    summary += `\nHorário de pico de energia: ${mem.profile.peak_energy_time}`;
  }

  return summary;
}

module.exports = {
  loadMemory,
  saveMemory,
  addMessage,
  getHistory,
  updateProfile,
  addVictory,
  addTask,
  completeTask,
  getMemorySummary,
  loadCarolProfile,
};
