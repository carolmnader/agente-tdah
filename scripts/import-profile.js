require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadMemory, saveMemory } = require('../src/services/memory');

const profilePath = path.join(process.cwd(), 'data', 'carol-profile.json');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

console.log('📥 Importando perfil da Carol para a memória da ARIA...\n');

const memory = loadMemory();

// Atualiza o perfil completo
memory.profile = {
  ...memory.profile,
  name: profile.profile.preferred_name,
  full_name: profile.profile.full_name,
  birth_date: profile.profile.birth_date,
  birth_time: profile.profile.birth_time,
  birth_city: profile.profile.birth_city,
  age: profile.profile.age,
  current_cities: profile.profile.current_cities,
  profession: profile.profile.profession,
  current_status: profile.profile.current_status,

  // Saúde
  medications: profile.health.medications,
  health_team: profile.health.health_team,
  diagnoses: profile.health.diagnoses,

  // TDAH
  tdah_struggles: profile.tdah_profile.main_struggles,
  tdah_what_works: profile.tdah_profile.what_works,
  peak_energy_time: profile.tdah_profile.peak_energy_time,
  energy_pattern: profile.tdah_profile.energy_pattern,
  overload_triggers: profile.tdah_profile.overload_triggers,

  // Profissional
  learning_goals: profile.professional.learning_goals,
  financial_goal: profile.professional.financial_goal_2026,
  skills: profile.professional.skills,

  // Pessoal
  interests: profile.personal.interests,
  family: profile.personal.family,
  close_friends: profile.personal.close_friends,

  // Instruções especiais
  aria_instructions: profile.aria_instructions,

  // Padrões já conhecidos
  tdah_patterns: profile.tdah_profile.main_struggles,
  preferred_style: 'visual e conciso',
};

saveMemory(memory);

console.log('✅ Perfil importado com sucesso!\n');
console.log('📋 O que a ARIA agora sabe sobre Carol:');
console.log(`   Nome: ${memory.profile.name}`);
console.log(`   Nascimento: ${memory.profile.birth_date} às ${memory.profile.birth_time}`);
console.log(`   Cidade: ${memory.profile.current_cities?.join(' / ')}`);
console.log(`   Status: ${memory.profile.current_status}`);
console.log(`   Energia: ${memory.profile.peak_energy_time}`);
console.log(`   Medicamentos manhã: Rexulti 1mg + Venlift 75mg + Concerta 36mg`);
console.log(`   Medicamento noite: Razapina 45mg`);
console.log(`   Psicólogo: sextas 13h`);
console.log(`   Aprendendo: ${memory.profile.learning_goals?.join(', ')}`);
console.log('\n💜 ARIA está pronta para conhecer Carol profundamente!');
