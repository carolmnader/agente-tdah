const fs = require('fs');
const path = require('path');

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || 'C:/Users/carol/OneDrive/Documentos/Obsidian Vault';

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function today() { return new Date().toISOString().split('T')[0]; }
function nowTime() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

function saveBrainDump(text) {
  const dir = path.join(VAULT_PATH, 'ARIA', 'Brain Dumps');
  ensureDir(dir);
  const file = path.join(dir, `Brain Dump ${today()}.md`);
  const entry = `\n## ${nowTime()}\n${text}\n`;
  if (fs.existsSync(file)) { fs.appendFileSync(file, entry, 'utf-8'); }
  else { fs.writeFileSync(file, `---\ndata: ${today()}\ntags: [brain-dump, aria]\n---\n\n# 🧠 Brain Dump — ${today()}\n${entry}`, 'utf-8'); }
  return `Brain Dump ${today()}.md`;
}

function saveThinkingLog(content) {
  const dir = path.join(VAULT_PATH, 'ARIA', 'Thinking Logs');
  ensureDir(dir);
  const file = path.join(dir, `Thinking Log ${today()}.md`);
  if (fs.existsSync(file)) { fs.appendFileSync(file, content, 'utf-8'); }
  else { fs.writeFileSync(file, `---\ndata: ${today()}\ntags: [thinking-log, aria]\n---\n\n# 🧠 Thinking Log — ${today()}\n\n> Fluxo de pensamento interno da ARIA\n${content}`, 'utf-8'); }
  return `Thinking Log ${today()}.md`;
}

function saveDailyNote(content) {
  const dir = path.join(VAULT_PATH, 'ARIA', 'Daily Notes');
  ensureDir(dir);
  const file = path.join(dir, `${today()}.md`);
  const entry = `\n### ${nowTime()}\n${content}\n`;
  if (fs.existsSync(file)) { fs.appendFileSync(file, entry, 'utf-8'); }
  else { fs.writeFileSync(file, `---\ndata: ${today()}\ntags: [daily, aria]\n---\n\n# 📅 ${today()}\n${entry}`, 'utf-8'); }
  return `${today()}.md`;
}

function saveTask(taskText, priority = 'média') {
  const dir = path.join(VAULT_PATH, 'ARIA');
  ensureDir(dir);
  const file = path.join(dir, 'Tarefas.md');
  const emoji = { alta: '🔴', média: '🟡', baixa: '🟢' }[priority] || '🟡';
  const newTask = `- [ ] ${emoji} ${taskText} _(${today()} ${nowTime()})_\n`;
  if (!fs.existsSync(file)) { fs.writeFileSync(file, `---\ntags: [tarefas, aria]\n---\n\n# ✅ Tarefas\n\n## 🔴 Alta\n\n## 🟡 Média\n\n## 🟢 Baixa\n\n`, 'utf-8'); }
  let c = fs.readFileSync(file, 'utf-8');
  const s = { alta: '## 🔴 Alta', média: '## 🟡 Média', baixa: '## 🟢 Baixa' };
  c = c.replace(s[priority] || s['média'], `${s[priority] || s['média']}\n${newTask}`);
  fs.writeFileSync(file, c, 'utf-8');
  return 'Tarefas.md';
}

function saveReport(text) {
  const dir = path.join(VAULT_PATH, 'ARIA', 'Relatórios');
  ensureDir(dir);
  const file = path.join(dir, `Relatório ${today()}.md`);
  fs.writeFileSync(file, `---\ndata: ${today()}\ntags: [relatorio, aria]\n---\n\n# 📊 Relatório — ${today()}\n\n${text}\n\n---\n_Gerado pela ARIA às ${nowTime()}_\n`, 'utf-8');
  return `Relatório ${today()}.md`;
}

function saveIdea(text) {
  const dir = path.join(VAULT_PATH, 'ARIA', 'Ideias');
  ensureDir(dir);
  const file = path.join(dir, 'Caixa de Ideias.md');
  const entry = `\n## 💡 ${today()} ${nowTime()}\n${text}\n`;
  if (fs.existsSync(file)) { fs.appendFileSync(file, entry, 'utf-8'); }
  else { fs.writeFileSync(file, `---\ntags: [ideias, aria]\n---\n\n# 💡 Caixa de Ideias\n${entry}`, 'utf-8'); }
  return 'Caixa de Ideias.md';
}

function saveToObsidian(type, content, extra = {}) {
  try {
    let fileName;
    switch (type) {
      case 'thinking': fileName = saveThinkingLog(content); break;
      case 'dump':     fileName = saveBrainDump(content); break;
      case 'daily':    fileName = saveDailyNote(content); break;
      case 'task':     fileName = saveTask(content, extra.priority); break;
      case 'report':   fileName = saveReport(content); break;
      case 'idea':     fileName = saveIdea(content); break;
      default:         fileName = saveBrainDump(content);
    }
    console.log(`📝 [Obsidian] → ${fileName}`);
    return { success: true, file: fileName };
  } catch (error) {
    console.error('Erro Obsidian:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { saveToObsidian };
