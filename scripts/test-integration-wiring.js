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

// Authentication must require verified ownership of an email address and support one-time recovery tokens.
assert.match(auth, /email_verified boolean NOT NULL DEFAULT false/);
assert.match(auth, /if \(!user\.email_verified\) return sendError\(res, 403/);
assert.match(auth, /app\.post\("\/api\/auth\/verify-email"/);
assert.match(auth, /app\.post\("\/api\/auth\/resend-verification"/);
assert.match(auth, /app\.post\("\/api\/auth\/request-password-reset"/);
assert.match(auth, /app\.post\("\/api\/auth\/reset-password"/);
assert.match(auth, /DELETE FROM anitos_sessions WHERE user_id=\$1/);
assert.match(auth, /RESEND_API_KEY/);
assert.match(board, /ANITOPEBOARD/);
assert.match(fs.readFileSync("public/account.html", "utf8"), /id="forgotPassword"/);
assert.match(fs.readFileSync("public/account.html", "utf8"), /id="resendVerification"/);
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
