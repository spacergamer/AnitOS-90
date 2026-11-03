const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync("public/home.html", "utf8");
const board = fs.readFileSync("public/board.html", "utf8");
const room = fs.readFileSync("public/room.html", "utf8");
const server = fs.readFileSync("server.js", "utf8");
const auth = fs.readFileSync("auth.js", "utf8");

// Both role-specific forms must have real submit buttons. The Master handler
// queries this exact selector before entering its try/finally block.
assert.match(home, /<button type="submit" style="margin-top:10px">Criar campanha<\/button>/);
assert.match(home, /<button type="submit" style="margin-top:10px">Entrar<\/button>/);
assert.doesNotMatch(home, /type="submit style=/);
assert.match(home, /querySelector\('button\[type="submit"\]'\)/);

// The DADOS tab must open RGN in another tab without losing campaign context.
assert.match(board, /href="\/room\.html\?campaign=\$\{encodeURIComponent\(remoteCampaignId\)\}"/);
assert.doesNotMatch(board, /vinculação automática da sala ao código desta campanha não faz parte desta etapa/i);
assert.match(home, /href="\/room\.html\?campaign="\+encodeURIComponent\(campaign\.id\)/);
assert.match(room, /\.\.\.\(campaignId\?\{campaignId\}:\{\}\)/);
assert.match(room, /setInterval\(\(\)=>\{if\(room\)refreshCampaignSheet\(\)\},100\)/);
assert.match(room, /id="roomTabs"/);
assert.match(room, /id="roomPaneData"/);
assert.match(room, /id="roomPaneSheet"/);
assert.match(room, /id="roomPaneChat"/);
assert.match(room, /function activateRoomTab\(tabName\)/);

// Username plus a four-digit account number, password hashes and code-based recovery.
const accountPage = fs.readFileSync("public/account.html", "utf8");
assert.match(auth, /ADD COLUMN IF NOT EXISTS username text/);
assert.match(auth, /ADD COLUMN IF NOT EXISTS public_code text/);
assert.match(auth, /ADD COLUMN IF NOT EXISTS employee_name text/);
assert.match(auth, /ADD COLUMN IF NOT EXISTS recovery_salt text/);
assert.match(auth, /ADD COLUMN IF NOT EXISTS recovery_hash text/);
assert.match(auth, /function makePublicCode\(\)/);
assert.match(auth, /crypto\.randomInt\(0,10000\)/);
assert.match(auth, /CREATE UNIQUE INDEX IF NOT EXISTS anitos_users_username_unique_idx/);
assert.match(auth, /function makeRecoveryCode\(\)/);
assert.match(auth, /recovery_code_hash text/);
assert.match(auth, /function splitUserTag\(value\)/);
assert.match(auth, /\\d\{4\}/);
assert.match(auth, /scrypt\(password,passwordSalt,64\)/);
assert.match(auth, /app\.post\("\/api\/auth\/reveal-recovery-code"/);
assert.match(auth, /app\.post\("\/api\/auth\/recover-account"/);
assert.match(auth, /app\.post\("\/api\/auth\/profile"/);
assert.match(auth, /legacy_login_enabled=true/);
assert.match(auth, /email_verified,username,public_code/);
assert.match(accountPage, /id="employeeName"/);
assert.match(accountPage, /id="username"/);
assert.match(accountPage, /id="publicCode"/);
assert.match(accountPage, /id="togglePassword"/);
assert.match(accountPage, /id="openRegister"[^>]*>\s*Criar conta/);
assert.match(accountPage, /id="cancelRegister"/);
assert.doesNotMatch(accountPage, /id="loginTab"|id="registerTab"|class="tabs"/);
assert.match(accountPage, /id="recoveryUsername"/);
assert.match(accountPage, /id="recoveryCode"/);
assert.doesNotMatch(accountPage, /id="recoveryPublicCode"/);
assert.match(accountPage, /id="revealRecoveryCode"/);
assert.match(accountPage, /id="profilePhoto"/);
assert.match(accountPage, /id="profileBio"/);
assert.match(accountPage, /id="profileMotivation"/);
assert.match(accountPage, /api\("\/api\/auth\/profile"/);
assert.doesNotMatch(accountPage, /recoveryEmail|playerEmail|email address/i);
assert.doesNotMatch(accountPage, /id="roleField"/);
assert.match(room, /pingTimeoutTimer=setTimeout\(\(\)=>\{/);
assert.match(room, /socket\.disconnect\(\);\s*socket\.connect\(\);/);
assert.match(room, /A conexão parou de responder\. Tentando recuperar a sessão/);

// Saving or opening a chapter in ANITOPEBOARD must synchronize its character sheets.
const saveDataStart = board.indexOf("function saveData()");
const saveChapterStart = board.indexOf("async function saveCampaignNow", saveDataStart);
assert.ok(saveDataStart >= 0 && saveChapterStart > saveDataStart);
assert.match(board.slice(saveDataStart, saveChapterStart), /sync-board-characters/);
assert.match(board.slice(saveDataStart, saveChapterStart), /SALVO \+ FICHAS SINCRONIZADAS/);
assert.match(board, /Abrir um capítulo também sincroniza suas fichas existentes com o servidor/);

// Campaign listing must not multiply rows when a user is both owner and member.
assert.match(auth, /OR EXISTS \(\s*SELECT 1 FROM anitos_campaign_members m/);
assert.doesNotMatch(auth, /FROM anitos_campaigns c\s+LEFT JOIN anitos_campaign_members m ON m\.campaign_id=c\.id\s+WHERE c\.owner_id=\$1 OR m\.user_id=\$1/);

// The integrated pages must resolve to the same server-side routes.
assert.match(server, /app\.get\("\/room\.html"/);
assert.match(server, /app\.get\("\/login\.html",\(_q,r\)=>r\.redirect\(302,"\/account"\)\)/);
assert.match(server, /app\.get\("\/board\.html",\(_q,r\)=>r\.sendFile\(path\.join\(__dirname,"public","board\.html"\)\)\)/);
assert.match(server, /app\.get\("\/anitopeboard\/",\(_q,r\)=>r\.sendFile\(path\.join\(__dirname,"public","board\.html"\)\)\)/);

// Campaign-scoped rooms must remain scoped after a server restart.
assert.match(server, /code:r\.code,title:r\.title,campaignId:r\.campaignId\|\|null,rolls:/);
assert.match(server, /campaignId:typeof data\.campaignId==="string"\?data\.campaignId:null,players:new Map\(\)/);


// ANITOPEBOARD content lives in board.html and serves legacy relative assets from /anitopeboard/.
assert.match(board, /assignBoardCharacter\(\$\{i\}\)/);
assert.match(board, /PRESSIONE.*PARA ATUALIZAR/);
assert.match(board, /e\.key === "\x27"/);
assert.match(board, /async function refreshBoardFromServer\(\)/);
assert.match(board, /<base href=/);
assert.match(board, /href="img\/as\.ico"/);
assert.match(board, /ANITOPEBOARD/);

console.log("Integration wiring regression tests passed.");
