const crypto = require("node:crypto");
const {promisify} = require("node:util");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "anitos_session";
const SESSION_DAYS = 30;

function sendError(res, status, message) {
  return res.status(status).json({error: message});
}

function readCookie(req, key) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === key) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeUser(row) {
  return {id: row.id, email: row.email, displayName: row.display_name, role: row.role};
}

async function initializeAuthSchema(db) {
  await db.query(`
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
  `);
}

function registerAuthRoutes(app, express, db) {
  app.use("/api", express.json({limit: "1mb"}));

  app.get("/account", (_req, res) => res.sendFile(require("node:path").join(__dirname, "public", "account.html")));

  function databaseRequired(_req, res, next) {
    if (!db) return sendError(res, 503, "Contas e campanhas exigem DATABASE_URL configurado no servidor.");
    next();
  }

  async function requireAuth(req, res, next) {
    try {
      if (!db) return sendError(res, 503, "Autenticação indisponível: banco de dados não configurado.");
      const token = readCookie(req, COOKIE);
      if (!/^[a-f0-9]{64}$/.test(token)) return sendError(res, 401, "Faça login para continuar.");
      const result = await db.query(
        `SELECT u.id,u.email,u.display_name,u.role
         FROM anitos_sessions s JOIN anitos_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.expires_at>now()`,
        [tokenHash(token)]
      );
      if (!result.rows[0]) return sendError(res, 401, "Sua sessão expirou. Entre novamente.");
      req.user = safeUser(result.rows[0]);
      next();
    } catch (err) {
      console.error("[auth] Falha ao validar sessão:", err.message);
      sendError(res, 500, "Não foi possível validar a sessão.");
    }
  }

  async function createSession(userId, res) {
    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO anitos_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [tokenHash(token), userId]
    );
    setSessionCookie(res, token);
  }

  app.post("/api/auth/register", databaseRequired, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const displayName = String(req.body?.displayName || "").trim().replace(/\s+/g, " ").slice(0, 48);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const role = req.body?.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        return sendError(res, 400, "Informe um e-mail válido.");
      if (displayName.length < 2) return sendError(res, 400, "Informe um nome com pelo menos 2 caracteres.");
      if (password.length < 10 || password.length > 200)
        return sendError(res, 400, "A senha deve ter entre 10 e 200 caracteres.");
      if (!["master", "player"].includes(role))
        return sendError(res, 400, "Escolha o perfil Mestre ou Jogador.");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = (await scrypt(password, salt, 64)).toString("hex");
      const id = crypto.randomUUID();
      const result = await db.query(
        "INSERT INTO anitos_users(id,email,display_name,role,password_salt,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,email,display_name,role",
        [id, email, displayName, role, salt, hash]
      );
      await createSession(id, res);
      return res.status(201).json({user: safeUser(result.rows[0])});
    } catch (err) {
      if (err.code === "23505") return sendError(res, 409, "Já existe uma conta com esse e-mail.");
      console.error("[auth] Falha ao criar conta:", err.message);
      return sendError(res, 500, "Não foi possível criar a conta.");
    }
  });

  app.post("/api/auth/login", databaseRequired, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const result = await db.query(
        "SELECT id,email,display_name,role,password_salt,password_hash FROM anitos_users WHERE email=$1",
        [email]
      );
      const user = result.rows[0];
      if (!user) return sendError(res, 401, "E-mail ou senha incorretos.");
      const candidate = await scrypt(password, user.password_salt, 64);
      const expected = Buffer.from(user.password_hash, "hex");
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected))
        return sendError(res, 401, "E-mail ou senha incorretos.");
      await createSession(user.id, res);
      return res.json({user: safeUser(user)});
    } catch (err) {
      console.error("[auth] Falha ao entrar:", err.message);
      return sendError(res, 500, "Não foi possível iniciar a sessão.");
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({user: req.user}));

  app.post("/api/auth/logout", databaseRequired, async (req, res) => {
    try {
      const token = readCookie(req, COOKIE);
      if (/^[a-f0-9]{64}$/.test(token))
        await db.query("DELETE FROM anitos_sessions WHERE token_hash=$1", [tokenHash(token)]);
      clearSessionCookie(res);
      res.json({ok: true});
    } catch (err) {
      console.error("[auth] Falha ao sair:", err.message);
      sendError(res, 500, "Não foi possível encerrar a sessão.");
    }
  });

  app.get("/api/campaigns", requireAuth, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT c.id,c.owner_id,c.title,c.join_code,c.created_at,c.updated_at,
          (c.owner_id=$1) AS is_owner
         FROM anitos_campaigns c
         LEFT JOIN anitos_campaign_members m ON m.campaign_id=c.id
         WHERE c.owner_id=$1 OR m.user_id=$1
         ORDER BY c.updated_at DESC`,
        [req.user.id]
      );
      res.json({campaigns: result.rows});
    } catch (err) {
      console.error("[campaigns] Falha ao listar:", err.message);
      sendError(res, 500, "Não foi possível carregar as campanhas.");
    }
  });

  app.post("/api/campaigns", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem criar campanhas.");
    const title = String(req.body?.title || "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (title.length < 2) return sendError(res, 400, "O título deve ter pelo menos 2 caracteres.");
    try {
      const id = crypto.randomUUID();
      const joinCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      const result = await db.query(
        "INSERT INTO anitos_campaigns(id,owner_id,title,join_code) VALUES($1,$2,$3,$4) RETURNING id,owner_id,title,join_code,created_at,updated_at",
        [id, req.user.id, title, joinCode]
      );
      res.status(201).json({campaign: {...result.rows[0], is_owner: true}});
    } catch (err) {
      console.error("[campaigns] Falha ao criar:", err.message);
      sendError(res, 500, "Não foi possível criar a campanha.");
    }
  });

  app.post("/api/campaigns/join", requireAuth, async (req, res) => {
    if (req.user.role !== "player") return sendError(res, 403, "Somente Jogadores podem entrar em campanhas por código.");
    const joinCode = String(req.body?.joinCode || "").trim().toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(joinCode)) return sendError(res, 400, "Código de campanha inválido.");
    try {
      const result = await db.query("SELECT id FROM anitos_campaigns WHERE join_code=$1", [joinCode]);
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada. Confira o código.");
      await db.query(
        "INSERT INTO anitos_campaign_members(campaign_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [result.rows[0].id, req.user.id]
      );
      res.json({ok: true, campaignId: result.rows[0].id});
    } catch (err) {
      console.error("[campaigns] Falha ao entrar:", err.message);
      sendError(res, 500, "Não foi possível entrar na campanha.");
    }
  });

  app.get("/api/campaigns/:id", requireAuth, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT c.id,c.owner_id,c.title,c.join_code,c.data,c.created_at,c.updated_at,
          (c.owner_id=$1) AS is_owner
         FROM anitos_campaigns c
         LEFT JOIN anitos_campaign_members m ON m.campaign_id=c.id AND m.user_id=$1
         WHERE c.id=$2 AND (c.owner_id=$1 OR m.user_id=$1)`,
        [req.user.id, req.params.id]
      );
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      res.json({campaign: result.rows[0]});
    } catch (err) {
      console.error("[campaigns] Falha ao carregar:", err.message);
      sendError(res, 500, "Não foi possível carregar a campanha.");
    }
  });

  app.patch("/api/campaigns/:id", requireAuth, async (req, res) => {
    try {
      if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem editar campanhas.");
      const title = req.body?.title === undefined ? null : String(req.body.title).trim().slice(0, 100);
      const data = req.body?.data;
      const result = await db.query(
        `UPDATE anitos_campaigns SET title=COALESCE($1,title),
          data=COALESCE($2::jsonb,data),updated_at=now()
         WHERE id=$3 AND owner_id=$4 RETURNING id,owner_id,title,join_code,data,updated_at`,
        [title, data === undefined ? null : JSON.stringify(data), req.params.id, req.user.id]
      );
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      res.json({campaign: result.rows[0]});
    } catch (err) {
      console.error("[campaigns] Falha ao salvar:", err.message);
      sendError(res, 500, "Não foi possível salvar a campanha.");
    }
  });

  app.get("/api/campaigns/:id/characters", requireAuth, async (req, res) => {
    try {
      const campaign = await db.query(
        `SELECT c.owner_id FROM anitos_campaigns c
         LEFT JOIN anitos_campaign_members m ON m.campaign_id=c.id AND m.user_id=$1
         WHERE c.id=$2 AND (c.owner_id=$1 OR m.user_id=$1)`,
        [req.user.id, req.params.id]
      );
      if (!campaign.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      const owner = campaign.rows[0].owner_id === req.user.id;
      const result = owner
        ? await db.query("SELECT id,campaign_id,name,data,assigned_player_id,created_at,updated_at FROM anitos_characters WHERE campaign_id=$1 ORDER BY created_at", [req.params.id])
        : await db.query("SELECT id,campaign_id,name,data,assigned_player_id,created_at,updated_at FROM anitos_characters WHERE campaign_id=$1 AND assigned_player_id=$2 ORDER BY created_at", [req.params.id, req.user.id]);
      res.json({characters: result.rows, readOnly: !owner});
    } catch (err) {
      console.error("[characters] Falha ao listar:", err.message);
      sendError(res, 500, "Não foi possível carregar as fichas.");
    }
  });

  app.post("/api/campaigns/:id/characters", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem criar fichas.");
    const name = String(req.body?.name || "").trim().slice(0, 100);
    if (name.length < 1) return sendError(res, 400, "Informe o nome do personagem.");
    try {
      const result = await db.query("SELECT id FROM anitos_campaigns WHERE id=$1 AND owner_id=$2", [req.params.id, req.user.id]);
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      const created = await db.query(
        "INSERT INTO anitos_characters(id,campaign_id,owner_id,name,data) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,campaign_id,name,data,assigned_player_id,created_at,updated_at",
        [crypto.randomUUID(), req.params.id, req.user.id, name, JSON.stringify(req.body?.data && typeof req.body.data === "object" ? req.body.data : {})]
      );
      res.status(201).json({character: created.rows[0]});
    } catch (err) {
      console.error("[characters] Falha ao criar:", err.message);
      sendError(res, 500, "Não foi possível criar a ficha.");
    }
  });

  app.patch("/api/characters/:id", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem editar fichas.");
    try {
      const name = req.body?.name === undefined ? null : String(req.body.name).trim().slice(0, 100);
      const data = req.body?.data;
      const result = await db.query(
        `UPDATE anitos_characters SET name=COALESCE($1,name),
          data=COALESCE($2::jsonb,data),updated_at=now()
         WHERE id=$3 AND owner_id=$4 RETURNING id,campaign_id,name,data,assigned_player_id,updated_at`,
        [name, data === undefined ? null : JSON.stringify(data), req.params.id, req.user.id]
      );
      if (!result.rows[0]) return sendError(res, 404, "Ficha não encontrada ou sem permissão.");
      res.json({character: result.rows[0]});
    } catch (err) {
      console.error("[characters] Falha ao salvar:", err.message);
      sendError(res, 500, "Não foi possível salvar a ficha.");
    }
  });

  app.post("/api/characters/:id/assign", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem atribuir fichas.");
    const playerId = String(req.body?.playerId || "");
    try {
      const result = await db.query(
        `UPDATE anitos_characters ch SET assigned_player_id=$1,updated_at=now()
         WHERE ch.id=$2 AND ch.owner_id=$3
           AND ($1 IS NULL OR EXISTS (
             SELECT 1 FROM anitos_campaign_members m
             WHERE m.campaign_id=ch.campaign_id AND m.user_id=$1
           ))
         RETURNING ch.id,ch.campaign_id,ch.name,ch.assigned_player_id`,
        [playerId || null, req.params.id, req.user.id]
      );
      if (!result.rows[0]) return sendError(res, 404, "Ficha ou jogador não encontrado na campanha.");
      res.json({character: result.rows[0]});
    } catch (err) {
      console.error("[characters] Falha ao atribuir:", err.message);
      sendError(res, 500, "Não foi possível atribuir a ficha.");
    }
  });
}

module.exports = {initializeAuthSchema, registerAuthRoutes};
