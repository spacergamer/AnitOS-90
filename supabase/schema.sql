-- Estado persistente do AnitOS RNG.
-- O servidor também cria esta tabela automaticamente na inicialização.
CREATE TABLE IF NOT EXISTS anitos_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
