-- AnitOS '90: persistence for RGN, accounts, campaigns and character sheets.
-- The Node.js service also creates these tables automatically at startup.

CREATE TABLE IF NOT EXISTS anitos_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anitos_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('master','player')),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anitos_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES anitos_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anitos_sessions_user_idx ON anitos_sessions(user_id);

CREATE TABLE IF NOT EXISTS anitos_campaigns (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES anitos_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  join_code text NOT NULL UNIQUE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anitos_campaign_members (
  campaign_id text NOT NULL REFERENCES anitos_campaigns(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES anitos_users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS anitos_characters (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES anitos_campaigns(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES anitos_users(id) ON DELETE CASCADE,
  assigned_player_id text REFERENCES anitos_users(id) ON DELETE SET NULL,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anitos_characters_campaign_idx ON anitos_characters(campaign_id);
CREATE INDEX IF NOT EXISTS anitos_characters_assigned_idx ON anitos_characters(assigned_player_id);
