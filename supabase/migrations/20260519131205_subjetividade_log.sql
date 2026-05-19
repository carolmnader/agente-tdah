-- Onda 1.9 Layer 2: log fire-and-forget de performances de subjetividade
-- detectadas pelo Haiku judge (detectarPerformaSubjetividade.js).
-- Calibracao para Onda 1.10 — apos 1 semana de dados, decidir se vira
-- substituidor de resposta ou fica so como observabilidade.
--
-- Aplicar via Supabase MCP do Claude web (NAO via npx supabase migration).

CREATE TABLE subjetividade_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detectado_em TIMESTAMPTZ DEFAULT NOW(),
  caminho TEXT NOT NULL,
  resposta_original TEXT NOT NULL,
  mensagem_carol TEXT,
  padrao_detectado TEXT,
  severidade SMALLINT,
  contexto JSONB
);

CREATE INDEX idx_subjetividade_log_detectado_em
  ON subjetividade_log(detectado_em DESC);

CREATE INDEX idx_subjetividade_log_severidade
  ON subjetividade_log(severidade)
  WHERE severidade >= 3;

COMMENT ON TABLE subjetividade_log IS 'Log fire-and-forget de performances de subjetividade detectadas pelo Haiku judge. Calibracao para Onda 1.10.';
