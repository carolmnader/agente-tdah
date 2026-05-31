// src/services/citacoes.js — "Citação do dia" do briefing matinal.
// Lê de public.citacoes (já semeada, 50 linhas). Seleção no-repeat + apresentação
// que respeita a regra NUNCA-MENTE (✓ verbatim entre aspas · ≈ ideia atribuída).
// Mesmo padrão de client dos módulos irmãos (eventosNotificados.js): createClient
// com SERVICE_ROLE. Sem dep nova, sem Notion.

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Texto ATUAL do bloco PROVOCAÇÃO CULTURAL (scheduler.js 47-68) — fallback intacto
// quando não há citação disponível (preserva 100% o comportamento anterior).
const BLOCO_FALLBACK = `  PROVOCAÇÃO CULTURAL (opcional — no máximo UMA linha, só se conectar de verdade com o dia/estação/tema; se não conectar, OMITE):

  Puxe de UMA figura desta curadoria e PARAFRASEIE uma ideia documentada dela, atribuindo o autor ("como X pensava…", "na visão de X…"). Tom de registro, não de motivação — provocação que faz pensar, nunca frase de efeito de coach.

  REGRA ANTI-MENTIRA (inegociável): NUNCA invente frase entre aspas na boca de ninguém. Parafraseie a IDEIA e atribua o autor. Com figuras públicas reais (Mujica, Krenak, Arendt…) isso vale dobrado — frase falsa é mentira e desrespeito. A ÚNICA citação verbatim permitida é a canônica do Niemeyer ("Não é o ângulo reto que me atrai, nem a linha reta, dura, inflexível…"). Qualquer outra coisa: paráfrase atribuída.

  NÃO use pop-filosofia de palco (ex.: Cortella) como sabedoria. A curadoria é séria.

  Curadoria (paleta — varie, não repita sempre os mesmos):
  - Arquitetura/espaço: Bachelard, Pallasmaa, Tanizaki, Lina Bo Bardi, Niemeyer, Louis Kahn, Aldo Van Eyck, Manfredo Tafuri, Henri Lefebvre
  - Literatura: Clarice Lispector, Hilda Hilst, Hermann Hesse, Cortázar, Camus, João Cabral, Dante, Stefan Zweig, Saint-Exupéry, Calvino, Borges, Drummond, Bauman
  - Cinema: Francis Ford Coppola, Sofia Coppola, Woody Allen, Agnès Varda, Joachim Trier, Godard, Scorsese, Cronenberg, Tarkóvski, Chris Marker, Kieślowski, Glauber Rocha, Wong Kar-wai
  - Música: Bach, Chopin, Prokófiev, Chostakóvitch, Pierre Henry, Stockhausen, Chico Science, Nino Rota
  - Pintura: Chagall
  - História/pensamento: Hannah Arendt, Carlos Lemos, Roberto Pompeu de Toledo, Eduardo Giannetti, Hobsbawm, Braudel, Carlo Ginzburg, Eduardo Galeano
  - Política como filosofia de vida: Ailton Krenak, Davi Kopenawa, Eduardo Viveiros de Castro, Pepe Mujica, Václav Havel
  - Grandes mentes: Nietzsche, Schopenhauer, Edith Stein, Jung, Simone Weil, Byung-Chul Han, Susan Sontag
  Exemplos de tom (referência, não copiar):
  ✓ "Quatro reuniões. Bachelard chamava a casa de abrigo do devaneio — você vai ter pouco devaneio hoje. Marca um intervalo."
  ✓ "Lua nova, Vata pesado. Tanizaki escrevia sobre o valor das sombras — hoje permite a manhã ser menos brilhante."
  ✗ "Boa segunda! Como diria Clarice, 'eu sou tudo aquilo que aconteceu comigo'!" (frase textual inventada, motivacional)
  ✗ "Você é capaz! Niemeyer dizia pra acreditar nas curvas!" (clichê motivacional)`;

/**
 * PURO. Recebe as citações ATIVAS, aplica o contrato no-repeat e devolve UMA
 * (ou null se não houver nenhuma ativa).
 * Disponível = ativa && usada_em == null → sorteia entre as disponíveis.
 * Pool esgotado → recicla a ativa com usada_em MAIS ANTIGO.
 * @param {Array} rows  citações (idealmente já filtradas por ativa=true)
 * @param {() => number} rng  injetável p/ teste (default Math.random)
 */
function escolherCitacao(rows, rng = Math.random) {
  const ativas = (Array.isArray(rows) ? rows : []).filter(r => r && r.ativa === true);
  if (ativas.length === 0) return null;

  const disponiveis = ativas.filter(r => r.usada_em == null);
  if (disponiveis.length > 0) {
    const i = Math.min(disponiveis.length - 1, Math.floor(rng() * disponiveis.length));
    return disponiveis[i];
  }
  // Esgotado: recicla a de usada_em mais antigo (a menos recente). Sem reset.
  return ativas.slice().sort((a, b) => new Date(a.usada_em).getTime() - new Date(b.usada_em).getTime())[0];
}

/**
 * I/O. Busca as ativas no Supabase e escolhe UMA (NÃO marca usada_em).
 * Best-effort: erro → null (caller cai no fallback do bloco). PostgREST não faz
 * ORDER BY random → trazemos as ativas e sorteamos em JS.
 * @returns {Promise<object|null>}
 */
async function selecionarCitacaoDoDia() {
  const { data, error } = await supabase
    .from('citacoes')
    .select('*')
    .eq('ativa', true);
  if (error) {
    console.error('[citacoes] selecionarCitacaoDoDia erro (best-effort):', { code: error.code, message: error.message });
    return null;
  }
  return escolherCitacao(data || []);
}

/**
 * I/O. Marca usada_em=now() na citação escolhida. Chamar SÓ após o briefing ser
 * enviado com sucesso (mark-after-send). Best-effort.
 * @param {number|string} id
 */
async function marcarCitacaoUsada(id) {
  if (id == null) return false;
  const { error } = await supabase
    .from('citacoes')
    .update({ usada_em: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[citacoes] marcarCitacaoUsada erro (best-effort):', { code: error.code, message: error.message });
    return false;
  }
  return true;
}

/**
 * PURO. Monta o bloco PROVOCAÇÃO CULTURAL pro prompt do briefing.
 *  - null/undefined → BLOCO_FALLBACK (texto antigo, 100% preservado).
 *  - verificacao começa com '✓' → frase LITERAL entre aspas, atribuída (verbatim).
 *  - caso contrário (inclui '≈') → ideia atribuída, SEM aspas de citação literal.
 * `por_que_importa` entra só como contexto (não copiar cru).
 * @param {object|null} citacao
 * @returns {string}
 */
function montarBlocoCitacao(citacao) {
  if (!citacao || !citacao.frase) return BLOCO_FALLBACK;

  const frase = String(citacao.frase).trim();
  const autor = (citacao.autor && String(citacao.autor).trim()) || 'autor não identificado';
  const obra = citacao.obra && String(citacao.obra).trim();
  const local = citacao.localizacao && String(citacao.localizacao).trim();
  const porque = citacao.por_que_importa && String(citacao.por_que_importa).trim();
  const verif = (citacao.verificacao || '').trim();
  const ehVerificada = verif.startsWith('✓');

  const refAutor = `${autor}${obra ? ', ' + obra : ''}${local ? ' (' + local + ')' : ''}`;
  const ctx = porque ? `\n  Contexto (NÃO copie cru, só pra ligar ao dia): ${porque}` : '';

  if (ehVerificada) {
    return `  PROVOCAÇÃO CULTURAL (opcional — no máximo UMA linha; só se conectar de verdade com o dia/tema, senão OMITE):
  Use HOJE esta citação VERIFICADA, citando-a LITERALMENTE entre aspas e atribuída ao autor. NÃO altere nenhuma palavra da frase.
  Citação: "${frase}" — ${refAutor}.
  Você pode tecer no máximo UMA linha ligando a ideia ao dia da Carol, mas a frase entre aspas é intocável. Tom de registro, nunca coach, nunca motivacional.${ctx}`;
  }

  // '≈' (paráfrase fiel) ou verificação desconhecida → nunca verbatim.
  return `  PROVOCAÇÃO CULTURAL (opcional — no máximo UMA linha; só se conectar de verdade com o dia/tema, senão OMITE):
  A seguir uma IDEIA atribuída a ${refAutor} — é paráfrase fiel, NÃO são as palavras exatas dele. Apresente como ideia atribuída ("na leitura de ${autor}…", "como ${autor} formula…"), sem aspas de citação e sem afirmar que é frase textual.
  Ideia: ${frase}
  No máximo UMA linha, tom de registro, nunca coach.${ctx}`;
}

module.exports = { escolherCitacao, selecionarCitacaoDoDia, marcarCitacaoUsada, montarBlocoCitacao, BLOCO_FALLBACK };
