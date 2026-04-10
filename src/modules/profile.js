// ─────────────────────────────────────────────
// PERFIL HOLÍSTICO DA CAROL
// ─────────────────────────────────────────────

const carolProfile = {
  nome: 'Carol',
  dosha: 'vata',
  nascimento: null, // será preenchido quando Carol informar
  calendar: 'pessoal',
  buffer: 20, // minutos de buffer entre compromissos
  energia_pico: { inicio: 6, fim: 14 }, // manhã até 14h
  medicacao: {
    manha: ['Rexulti 1mg', 'Venlift 75mg', 'Concerta 36mg'],
    noite: ['Razapina 45mg'],
  },
  tdah: {
    tipo: 'predominantemente desatento',
    hiperfoco_comum: ['código', 'projetos criativos', 'pesquisa'],
    gatilhos_paralisia: ['tarefas ambíguas', 'excesso de opções', 'pressão sem prazo claro'],
  },
};

function getProfile() {
  return carolProfile;
}

function updateNascimento(data) {
  carolProfile.nascimento = data;
}

module.exports = { getProfile, updateNascimento, carolProfile };
