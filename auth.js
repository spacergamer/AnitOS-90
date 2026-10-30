const crypto = require("node:crypto");
const {promisify} = require("node:util");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "anitos_session";
const SESSION_DAYS = 30;
const authAttempts = new Map();

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
  const secure = (process.env.NODE_ENV === "production" || process.env.RENDER === "true") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  const secure = (process.env.NODE_ENV === "production" || process.env.RENDER === "true") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function limitAuthAttempts(req, res, next) {
  const key = String(req.ip || req.socket?.remoteAddress || "unknown") + ":" + req.path;
  const now = Date.now();
  let bucket = authAttempts.get(key);
  if (!bucket || now - bucket.startedAt >= 15 * 60 * 1000) {
    bucket = {startedAt: now, count: 0};
    authAttempts.set(key, bucket);
  }
  if (bucket.count >= 10) return sendError(res, 429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
  bucket.count++;
  if (authAttempts.size > 5000) {
    for (const [entry, value] of authAttempts) if (now - value.startedAt >= 15 * 60 * 1000) authAttempts.delete(entry);
  }
  next();
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeUser(row) {
  return {id: row.id, email: row.email || null, displayName: row.display_name, username: row.username || null, publicCode: row.public_code || null, credentialsReady: Boolean(row.username && row.public_code && row.recovery_salt && row.recovery_hash), role: row.role, premium: Boolean(row.is_premium), dev: Boolean(row.is_dev)};
}
function normalizeAnswer(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").slice(0, 100);
}
function makePublicCode() {
  // O sufixo público é numérico, aleatório e curto: de 3 a 6 dígitos.
  const length = crypto.randomInt(3, 7);
  const min = 10 ** (length - 1);
  return String(crypto.randomInt(min, 10 ** length));
}
function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  while (result.length < 16) result += alphabet[crypto.randomInt(alphabet.length)];
  return result;
}
function splitUserTag(value) {
  const match = String(value || "").trim().match(/^([a-z0-9_.-]{2,32})#(\d{3,6})$/i);
  return match ? {username: match[1].toLowerCase(), publicCode: match[2]} : null;
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
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
    ALTER TABLE anitos_users ALTER COLUMN email DROP NOT NULL;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS username text;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS public_code text;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS recovery_salt text;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS recovery_hash text;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS recovery_code_salt text;
    ALTER TABLE anitos_users ADD COLUMN IF NOT EXISTS recovery_code_hash text;
    DROP INDEX IF EXISTS anitos_users_username_code_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS anitos_users_public_code_idx ON anitos_users(public_code) WHERE public_code IS NOT NULL;
    CREATE TABLE IF NOT EXISTS anitos_auth_tokens (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES anitos_users(id) ON DELETE CASCADE,
      purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS anitos_auth_tokens_user_purpose_idx ON anitos_auth_tokens(user_id,purpose);
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
    -- Display names now act as public @handles. Normalize legacy names and make them unique.
    UPDATE anitos_users
      SET display_name = CASE
        WHEN length(regexp_replace(trim(display_name), '[^A-Za-z0-9_.-]+', '_', 'g')) < 2
          THEN 'user_' || substr(id, 1, 6)
        ELSE left(lower(regexp_replace(trim(display_name), '[^A-Za-z0-9_.-]+', '_', 'g')), 32)
      END
      WHERE display_name !~ '^[A-Za-z0-9_.-]{2,32}$' OR display_name <> lower(display_name);
    WITH duplicates AS (
      SELECT id, row_number() OVER (PARTITION BY lower(display_name) ORDER BY created_at, id) AS duplicate_rank
      FROM anitos_users
    )
    UPDATE anitos_users u
      SET display_name = left(u.display_name, 24) || '_' || substr(u.id, 1, 6)
      FROM duplicates d
      WHERE u.id = d.id AND d.duplicate_rank > 1;
        CREATE UNIQUE INDEX IF NOT EXISTS anitos_users_display_name_lower_idx ON anitos_users (lower(display_name));
    ALTER TABLE anitos_campaigns ADD COLUMN IF NOT EXISTS join_password_salt text;
    ALTER TABLE anitos_campaigns ADD COLUMN IF NOT EXISTS join_password_hash text;
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
    ALTER TABLE anitos_characters ADD COLUMN IF NOT EXISTS source_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS anitos_characters_source_key_idx
      ON anitos_characters(campaign_id, source_key) WHERE source_key IS NOT NULL;
    -- A campaign may assign at most one character to each player. Keep the most recently updated
    -- assignment if legacy data already contains duplicates, then enforce the rule in PostgreSQL.
    WITH ranked_assignments AS (
      SELECT id, row_number() OVER (
        PARTITION BY campaign_id, assigned_player_id
        ORDER BY updated_at DESC, created_at DESC, id
      ) AS assignment_rank
      FROM anitos_characters
      WHERE assigned_player_id IS NOT NULL
    )
    UPDATE anitos_characters ch
      SET assigned_player_id=NULL, updated_at=now()
      FROM ranked_assignments ranked
      WHERE ch.id=ranked.id AND ranked.assignment_rank>1;
    CREATE UNIQUE INDEX IF NOT EXISTS anitos_characters_one_player_per_campaign_idx
      ON anitos_characters(campaign_id, assigned_player_id)
      WHERE assigned_player_id IS NOT NULL;
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
        `SELECT u.id,u.email,u.display_name,u.username,u.public_code,u.recovery_salt,u.recovery_hash,u.role,u.is_premium,u.is_dev
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

  app.post("/api/auth/register", databaseRequired, limitAuthAttempts, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase() || null;
      const displayName = String(req.body?.displayName || "").trim().replace(/\s+/g, " ").slice(0, 48);
      const username = String(req.body?.username || "").trim().replace(/^@/, "").toLowerCase();
      const food = normalizeAnswer(req.body?.favoriteFood);
      const animal = normalizeAnswer(req.body?.favoriteAnimal);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
      const role = req.body?.role || "player";
      if (displayName.length < 2) return sendError(res, 400, "Informe um nome de exibição com pelo menos 2 caracteres.");
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) return sendError(res, 400, "O nome de usuário deve ter de 2 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.");
      if (!food || !animal) return sendError(res, 400, "Informe sua comida favorita e seu animal favorito.");
      if (password.length < 1 || password.length > 200) return sendError(res, 400, "A senha deve ter entre 1 e 200 caracteres.");
      if (password !== confirmPassword) return sendError(res, 400, "As senhas não coincidem.");
      if (!["master", "player"].includes(role)) return sendError(res, 400, "Escolha o perfil Mestre ou Jogador.");
      const id = crypto.randomUUID();
      const passwordSalt = crypto.randomBytes(16).toString("hex");
      const passwordHash = (await scrypt(password, passwordSalt, 64)).toString("hex");
      const recoverySalt = crypto.randomBytes(16).toString("hex");
      const recoveryHash = (await scrypt(normalizeAnswer(food) + "\u0000" + normalizeAnswer(animal), recoverySalt, 64)).toString("hex");
      const recoveryCode = makeRecoveryCode();
      const recoveryCodeSalt = crypto.randomBytes(16).toString("hex");
      const recoveryCodeHash = (await scrypt(recoveryCode, recoveryCodeSalt, 64)).toString("hex");
      let publicCode = makePublicCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const result = await db.query(
            "INSERT INTO anitos_users(id,email,display_name,role,password_salt,password_hash,email_verified,username,public_code,recovery_salt,recovery_hash,recovery_code_salt,recovery_code_hash) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) RETURNING id,email,display_name,role,is_premium,is_dev,email_verified,username,public_code,recovery_salt,recovery_hash",
            [id, email, displayName, role, passwordSalt, passwordHash, username, publicCode, recoverySalt, recoveryHash, recoveryCodeSalt, recoveryCodeHash]
          );
          await createSession(id, res);
          return res.status(201).json({user: safeUser(result.rows[0]), recoveryCode, userTag: username + "#" + publicCode});
        } catch (err) {
          if (err.code === "23505" && (err.constraint === "anitos_users_public_code_idx" || err.constraint === "anitos_users_username_code_idx")) {
            publicCode = makePublicCode();
            continue;
          }
          if (err.code === "23505") {
            if (String(err.detail || "").includes("username")) return sendError(res, 409, "Esse nome de usuário já está em uso.");
            return sendError(res, 409, "Já existe uma conta com esses dados.");
          }
          throw err;
        }
      }
      return sendError(res, 503, "Não foi possível gerar um identificador único. Tente novamente.");
    } catch (err) {
      console.error("[auth] Falha ao criar conta:", err.message);
      return sendError(res, 500, "Não foi possível criar a conta.");
    }
  });

  app.post("/api/auth/login", databaseRequired, limitAuthAttempts, async (req, res) => {
    try {
      const login = String(req.body?.username || req.body?.email || "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const tag = splitUserTag(login);
      let result;
      if (tag) {
        result = await db.query("SELECT id,email,display_name,role,is_premium,is_dev,email_verified,username,public_code,recovery_salt,recovery_hash,password_salt,password_hash FROM anitos_users WHERE lower(username)=$1 AND public_code=$2", [tag.username, tag.publicCode]);
      } else {
        // Legacy accounts can authenticate once with their old email to register new credentials.
        result = await db.query("SELECT id,email,display_name,role,is_premium,is_dev,email_verified,username,public_code,recovery_salt,recovery_hash,password_salt,password_hash FROM anitos_users WHERE lower(email)=lower($1)", [login]);
      }
      const user = result.rows[0];
      if (!user) return sendError(res, 401, "Nome de usuário/código ou senha incorretos.");
      const candidate = await scrypt(password, user.password_salt, 64);
      const expected = Buffer.from(user.password_hash, "hex");
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected))
        return sendError(res, 401, "Nome de usuário/código ou senha incorretos.");
      await createSession(user.id, res);
      return res.json({user: safeUser(user)});
    } catch (err) {
      console.error("[auth] Falha ao entrar:", err.message);
      return sendError(res, 500, "Não foi possível iniciar a sessão.");
    }
  });

  app.post("/api/auth/recover-account", databaseRequired, limitAuthAttempts, async (req, res) => {
    try {
      const displayName = String(req.body?.displayName || "").trim().replace(/\s+/g, " ").slice(0, 48);
      const tag = splitUserTag(req.body?.userTag);
      const food = normalizeAnswer(req.body?.favoriteFood);
      const animal = normalizeAnswer(req.body?.favoriteAnimal);
      const recoveryCode = String(req.body?.recoveryCode || "").trim().toUpperCase();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
      if (!tag || (!recoveryCode && (!food || !animal))) return sendError(res, 400, "Informe o identificador e o código de recuperação ou as duas respostas de segurança.");
      if (password.length < 1 || password.length > 200) return sendError(res, 400, "A nova senha deve ter entre 1 e 200 caracteres.");
      if (password !== confirmPassword) return sendError(res, 400, "As senhas não coincidem.");
      const result = await db.query("SELECT id,display_name,recovery_salt,recovery_hash,recovery_code_salt,recovery_code_hash FROM anitos_users WHERE lower(username)=$1 AND public_code=$2", [tag.username, tag.publicCode]);
      const user = result.rows[0];
      if (!user || !user.recovery_salt || !user.recovery_hash || user.display_name.toLocaleLowerCase("pt-BR") !== displayName.toLocaleLowerCase("pt-BR"))
        return sendError(res, 403, "Os dados de recuperação não correspondem.");
      const candidate = await scrypt(food + "\u0000" + animal, user.recovery_salt, 64);
      const expected = Buffer.from(user.recovery_hash, "hex");
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected))
        return sendError(res, 403, "Os dados de recuperação não correspondem.");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = (await scrypt(password, salt, 64)).toString("hex");
      await db.query("UPDATE anitos_users SET password_salt=$1,password_hash=$2 WHERE id=$3", [salt, hash, user.id]);
      await db.query("DELETE FROM anitos_sessions WHERE user_id=$1", [user.id]);
      clearSessionCookie(res);
      return res.json({ok:true,message:"Senha redefinida. Entre com suas novas credenciais."});
    } catch (err) {
      console.error("[auth] Falha ao recuperar conta:", err.message);
      return sendError(res, 500, "Não foi possível recuperar a conta agora.");
    }
  });

  app.post("/api/auth/credentials", databaseRequired, requireAuth, limitAuthAttempts, async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim().replace(/^@/, "").toLowerCase();
      const food = normalizeAnswer(req.body?.favoriteFood);
      const animal = normalizeAnswer(req.body?.favoriteAnimal);
      if (!/^[a-z0-9_.-]{2,32}$/.test(username) || !food || !animal)
        return sendError(res, 400, "Informe um nome de usuário válido, comida favorita e animal favorito.");
      const publicCode = makePublicCode();
      const recoverySalt = crypto.randomBytes(16).toString("hex");
      const recoveryHash = (await scrypt(food + "\u0000" + animal, recoverySalt, 64)).toString("hex");
      const result = await db.query("UPDATE anitos_users SET username=$1,public_code=$2,recovery_salt=$3,recovery_hash=$4,email_verified=true WHERE id=$5 AND username IS NULL RETURNING id", [username, publicCode, recoverySalt, recoveryHash, req.user.id]);
      if (!result.rows[0]) return sendError(res, 409, "Esta conta já possui novas credenciais. Entre novamente.");
      await db.query("DELETE FROM anitos_sessions WHERE user_id=$1", [req.user.id]);
      clearSessionCookie(res);
      return res.json({ok:true,userTag:username + "#" + publicCode,recoveryCode,message:"Credenciais cadastradas. Guarde o identificador e o código de recuperação. Entre novamente com o identificador e sua senha atual."});
    } catch (err) {
      if (err.code === "23505") return sendError(res, 409, "Esse nome de usuário já está em uso. Escolha outro.");
      console.error("[auth] Falha ao salvar novas credenciais:", err.message);
      return sendError(res, 500, "Não foi possível salvar as novas credenciais.");
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({user: req.user}));

  app.post("/api/membership/activate", databaseRequired, requireAuth, limitAuthAttempts, async (req, res) => {
    const submitted = typeof req.body?.key === "string" ? req.body.key.trim().toUpperCase() : "";
    const normalized = submitted.replace(/-/g, "");
    const configuredKey = String(process.env.ANITOS_DEV_KEY || "").trim().toUpperCase().replace(/-/g, "");
    if (!/^[A-Z0-9]{12}$/.test(configuredKey)) {
      return sendError(res, 503, "A ativação está temporariamente indisponível. Tente novamente mais tarde.");
    }
    if (!/^[A-Z0-9]{12}$/.test(normalized) || normalized !== configuredKey) {
      return sendError(res, 400, "Chave inválida. Confira os caracteres e tente novamente.");
    }

    const configuredPassword = String(process.env.ANITOS_DEV_PASSWORD || "");
    if (!configuredPassword) {
      return sendError(res, 503, "A ativação está temporariamente indisponível. Tente novamente mais tarde.");
    }
    const submittedPassword = typeof req.body?.password === "string" ? req.body.password : "";
    if (!submittedPassword) {
      return res.json({ok:true,requiresPassword:true,message:"Chave válida. Confirme sua senha para continuar."});
    }
    const expectedBuffer = Buffer.from(configuredPassword, "utf8");
    const submittedBuffer = Buffer.from(submittedPassword, "utf8");
    if (expectedBuffer.length !== submittedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, submittedBuffer)) {
      return sendError(res, 400, "Não foi possível validar a chave. Confira os dados e tente novamente.");
    }

    try {
      const result = await db.query("UPDATE anitos_users SET is_premium=true,is_dev=true WHERE id=$1 RETURNING id,email,display_name,role,is_premium,is_dev", [req.user.id]);
      if (!result.rows[0]) return sendError(res, 404, "Conta não encontrada.");
      return res.json({ok:true,user:safeUser(result.rows[0]),message:"AnitOS Pro ativado com sucesso."});
    } catch (err) {
      console.error("[membership] Falha ao ativar Premium:", err.message);
      return sendError(res, 500, "Não foi possível ativar o Premium agora.");
    }
  });

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
        `SELECT c.id,c.owner_id,c.title,CASE WHEN c.owner_id=$1 THEN c.join_code ELSE NULL END AS join_code,c.created_at,c.updated_at,
          (c.owner_id=$1) AS is_owner
         FROM anitos_campaigns c
         WHERE c.owner_id=$1
            OR EXISTS (
              SELECT 1 FROM anitos_campaign_members m
              WHERE m.campaign_id=c.id AND m.user_id=$1
            )
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
    const campaignPassword = typeof req.body?.campaignPassword === "string" ? req.body.campaignPassword : "";
    if (title.length < 2) return sendError(res, 400, "O título deve ter pelo menos 2 caracteres.");
    if (campaignPassword.length < 8 || campaignPassword.length > 128) return sendError(res, 400, "A senha da campanha precisa ter entre 8 e 128 caracteres.");
    try {
      const id = crypto.randomUUID(), joinCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      const joinPasswordSalt = crypto.randomBytes(16).toString("hex");
      const joinPasswordHash = (await scrypt(campaignPassword, joinPasswordSalt, 64)).toString("hex");
      const result = await db.query(
        "INSERT INTO anitos_campaigns(id,owner_id,title,join_code,join_password_salt,join_password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,owner_id,title,join_code,created_at,updated_at",
        [id, req.user.id, title, joinCode, joinPasswordSalt, joinPasswordHash]
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
    const campaignPassword = typeof req.body?.campaignPassword === "string" ? req.body.campaignPassword : "";
    if (!/^[A-F0-9]{8}$/.test(joinCode)) return sendError(res, 400, "Código de campanha inválido.");
    if (!campaignPassword || campaignPassword.length > 128) return sendError(res, 400, "Informe a senha da campanha.");
    try {
      const result = await db.query("SELECT id,join_password_salt,join_password_hash FROM anitos_campaigns WHERE join_code=$1", [joinCode]);
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada. Confira o código.");
      const c = result.rows[0];
      if (!c.join_password_salt || !c.join_password_hash) return sendError(res, 409, "Esta campanha ainda não tem senha. Peça ao Mestre para definir uma senha.");
      const candidate = await scrypt(campaignPassword, c.join_password_salt, 64), expected = Buffer.from(c.join_password_hash, "hex");
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return sendError(res, 403, "Senha da campanha incorreta.");
      await db.query("INSERT INTO anitos_campaign_members(campaign_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [c.id, req.user.id]);
      res.json({ok: true, campaignId: c.id});
    } catch (err) {
      console.error("[campaigns] Falha ao entrar:", err.message);
      sendError(res, 500, "Não foi possível entrar na campanha.");
    }
  });

  app.get("/api/campaigns/:id", requireAuth, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT c.id,c.owner_id,c.title,CASE WHEN c.owner_id=$1 THEN c.join_code ELSE NULL END AS join_code,
          CASE WHEN c.owner_id=$1 THEN c.data ELSE NULL END AS data,c.created_at,c.updated_at,
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

  app.patch("/api/campaigns/:id/password", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem alterar a senha da campanha.");
    const password = typeof req.body?.campaignPassword === "string" ? req.body.campaignPassword : "";
    if (password.length < 8 || password.length > 128) return sendError(res, 400, "A senha da campanha precisa ter entre 8 e 128 caracteres.");
    try {
      const salt = crypto.randomBytes(16).toString("hex"), hash = (await scrypt(password, salt, 64)).toString("hex");
      const result = await db.query("UPDATE anitos_campaigns SET join_password_salt=$1,join_password_hash=$2,updated_at=now() WHERE id=$3 AND owner_id=$4 RETURNING id", [salt, hash, req.params.id, req.user.id]);
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      res.json({ok:true});
    } catch(err) { console.error("[campaigns] Falha ao alterar senha:",err.message); sendError(res,500,"Não foi possível alterar a senha da campanha."); }
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

  app.delete("/api/campaigns/:id", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem excluir campanhas.");
    try {
      const result = await db.query(
        "DELETE FROM anitos_campaigns WHERE id=$1 AND owner_id=$2 RETURNING id,title",
        [req.params.id, req.user.id]
      );
      if (!result.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      // Os vínculos e fichas são removidos pelo ON DELETE CASCADE do esquema.
      res.json({ok: true, deleted: result.rows[0]});
    } catch (err) {
      console.error("[campaigns] Falha ao excluir:", err.message);
      sendError(res, 500, "Não foi possível excluir a campanha.");
    }
  });

  app.get("/api/campaigns/:id/members", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem consultar a lista de jogadores.");
    try {
      const owner = await db.query("SELECT id FROM anitos_campaigns WHERE id=$1 AND owner_id=$2", [req.params.id, req.user.id]);
      if (!owner.rows[0]) return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      const result = await db.query(
        `SELECT u.id,u.display_name,u.email,u.username,u.public_code,u.role,m.joined_at
         FROM anitos_campaign_members m JOIN anitos_users u ON u.id=m.user_id
         WHERE m.campaign_id=$1 ORDER BY m.joined_at`,
        [req.params.id]
      );
      res.json({members: result.rows});
    } catch (err) {
      console.error("[campaigns] Falha ao listar jogadores:", err.message);
      sendError(res, 500, "Não foi possível carregar os jogadores da campanha.");
    }
  });

  app.post("/api/campaigns/:id/sync-board-characters", requireAuth, async (req, res) => {
    if (req.user.role !== "master") return sendError(res, 403, "Somente Mestres podem sincronizar fichas.");
    const chapterId = typeof req.body?.chapterId === "string" ? req.body.chapterId : "";
    if (!chapterId || chapterId.length > 160) return sendError(res, 400, "Selecione um capítulo válido.");
    let client;
    let transactionStarted = false;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const result = await client.query(
        "SELECT id,owner_id,data FROM anitos_campaigns WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [req.params.id, req.user.id]
      );
      const campaign = result.rows[0];
      if (!campaign) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return sendError(res, 404, "Campanha não encontrada ou sem permissão.");
      }
      const boardData = campaign.data && typeof campaign.data === "object" ? campaign.data : {};
      const snapshot = boardData.snapshots && boardData.snapshots[chapterId];
      if (!Array.isArray(snapshot)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return sendError(res, 400, "O capítulo não possui uma lista de personagens sincronizável.");
      }
      if (snapshot.length > 200) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return sendError(res, 400, "O capítulo excede o limite de 200 personagens por sincronização.");
      }

      const characters = normalizeBoardCharacters(snapshot);
      let synced = 0;
      for (const character of characters) {
        await client.query(
          `INSERT INTO anitos_characters
            (id,campaign_id,owner_id,name,data,source_key)
           VALUES($1,$2,$3,$4,$5::jsonb,$6)
           ON CONFLICT (campaign_id,source_key) WHERE source_key IS NOT NULL
           DO UPDATE SET name=EXCLUDED.name,data=EXCLUDED.data,updated_at=now()
           RETURNING id`,
          [crypto.randomUUID(), campaign.id, campaign.owner_id, character.name, JSON.stringify(character.data), character.sourceKey]
        );
        synced++;
      }
      await client.query("COMMIT");
      transactionStarted = false;
      res.json({ok: true, chapterId, synced});
    } catch (err) {
      if (client && transactionStarted) await client.query("ROLLBACK").catch(() => {});
      console.error("[characters] Falha ao sincronizar ANITOPEBOARD:", err.message);
      sendError(res, 500, "Não foi possível sincronizar as fichas do capítulo.");
    } finally {
      if (client) client.release();
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
        ? await db.query(`SELECT ch.id,ch.campaign_id,ch.name,ch.data,ch.assigned_player_id,u.display_name AS assigned_player_handle,ch.source_key,ch.created_at,ch.updated_at
           FROM anitos_characters ch LEFT JOIN anitos_users u ON u.id=ch.assigned_player_id
           WHERE ch.campaign_id=$1 ORDER BY ch.created_at`, [req.params.id])
        : await db.query(`SELECT ch.id,ch.campaign_id,ch.name,ch.data,ch.assigned_player_id,u.display_name AS assigned_player_handle,ch.created_at,ch.updated_at
           FROM anitos_characters ch LEFT JOIN anitos_users u ON u.id=ch.assigned_player_id
           WHERE ch.campaign_id=$1 AND ch.assigned_player_id=$2 ORDER BY ch.created_at`, [req.params.id, req.user.id]);
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
    const playerEmail = typeof req.body?.playerEmail === "string" ? req.body.playerEmail.trim().toLowerCase() : "";
    const playerHandle = typeof req.body?.playerHandle === "string" ? req.body.playerHandle.trim().replace(/^@/, "").toLowerCase() : "";
    const legacyPlayerId = String(req.body?.playerId || "");
    if (playerEmail && (playerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerEmail))) {
      return sendError(res, 400, "Informe um email válido para o jogador.");
    }
    if (playerHandle && !/^[a-z0-9_.-]{2,32}$/.test(playerHandle)) return sendError(res, 400, "Informe um @nome válido.");
    let client;
    let ownsClient = false;
    try {
      if (typeof db.connect === "function") {
        client = await db.connect();
        ownsClient = true;
        await client.query("BEGIN");
      } else {
        client = db;
      }
      const character = await client.query(
        "SELECT id,campaign_id FROM anitos_characters WHERE id=$1 AND owner_id=$2",
        [req.params.id, req.user.id]
      );
      if (!character.rows[0]) {
        if (ownsClient) await client.query("ROLLBACK");
        return sendError(res, 404, "Ficha não encontrada ou sem permissão.");
      }
      let playerId = legacyPlayerId || null;
      let assignedPlayerHandle = null;
      if (playerEmail || playerHandle) {
        const member = await client.query(
          `SELECT u.id,u.display_name FROM anitos_users u
           WHERE ${playerEmail ? "lower(u.email)=$2" : "lower(u.display_name)=$2"}
             AND (
               (u.role='master' AND u.id=$3)
               OR (u.role='player' AND EXISTS (
                 SELECT 1 FROM anitos_campaign_members m
                 WHERE m.user_id=u.id AND m.campaign_id=$1
               ))
             )
           LIMIT 1`,
          [character.rows[0].campaign_id, playerEmail || playerHandle, req.user.id]
        );
        if (!member.rows[0]) {
          if (ownsClient) await client.query("ROLLBACK");
          return sendError(res, 404, playerHandle ? "Não existe um jogador com esse @nome participando desta campanha." : "Não existe um jogador com esse email participando desta campanha.");
        }
        playerId = member.rows[0].id;
        assignedPlayerHandle = member.rows[0].display_name;
      }
      if (playerId) {
        const member = await client.query(
          `SELECT u.id,u.display_name FROM anitos_users u
           WHERE u.id=$2 AND (
             (u.role='master' AND u.id=$3)
             OR (u.role='player' AND EXISTS (
               SELECT 1 FROM anitos_campaign_members m
               WHERE m.user_id=u.id AND m.campaign_id=$1
             ))
           )`,
          [character.rows[0].campaign_id, playerId, req.user.id]
        );
        if (!member.rows[0]) {
          if (ownsClient) await client.query("ROLLBACK");
          return sendError(res, 404, "O jogador não participa desta campanha.");
        }
        assignedPlayerHandle = member.rows[0].display_name;
        // Move the player's assignment instead of allowing a second character in the same campaign.
        await client.query(
          `UPDATE anitos_characters SET assigned_player_id=NULL,updated_at=now()
           WHERE campaign_id=$1 AND owner_id=$2 AND assigned_player_id=$3 AND id<>$4`,
          [character.rows[0].campaign_id, req.user.id, playerId, req.params.id]
        );
      }
      const result = await client.query(
        `UPDATE anitos_characters SET assigned_player_id=$1,updated_at=now()
         WHERE id=$2 AND owner_id=$3
         RETURNING id,campaign_id,name,assigned_player_id`,
        [playerId, req.params.id, req.user.id]
      );
      if (!result.rows[0]) {
        if (ownsClient) await client.query("ROLLBACK");
        return sendError(res, 404, "Ficha não encontrada ou sem permissão.");
      }
      result.rows[0].assigned_player_handle = playerId ? assignedPlayerHandle : null;
      if (ownsClient) await client.query("COMMIT");
      res.json({character: result.rows[0]});
    } catch (err) {
      if (ownsClient && client) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      if (err.code === "23505" && err.constraint === "anitos_characters_one_player_per_campaign_idx") {
        return sendError(res, 409, "Este jogador já possui uma ficha atribuída nesta campanha. Atualize e tente novamente.");
      }
      console.error("[characters] Falha ao atribuir:", err.message);
      sendError(res, 500, "Não foi possível atribuir a ficha.");
    } finally {
      if (ownsClient && client) client.release();
    }
  });
}

function normalizeBoardCharacters(snapshot) {
  if (!Array.isArray(snapshot)) throw new TypeError("Snapshot must be an array.");
  return snapshot.flatMap(character => {
    if (!character || typeof character !== "object" || Array.isArray(character)) return [];
    const sourceKey = String(character.id || "").trim().slice(0, 160);
    const name = String(character.nome || character.name || sourceKey).trim().slice(0, 100);
    if (!sourceKey || !name) return [];
    return [{sourceKey, name, data: character}];
  });
}

module.exports = {initializeAuthSchema, registerAuthRoutes, normalizeBoardCharacters};
