const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync("public/home.html", "utf8");
const board = fs.readFileSync("public/board.html", "utf8");
const room = fs.readFileSync("public/room.html", "utf8");
const server = fs.readFileSync("server.js", "utf8");

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
assert.match(room, /setInterval\(\(\)=>\{if\(room\)refreshCampaignSheet\(\)\},1000\)/);

// Saving or opening a chapter in ANITOPEBOARD must synchronize its character sheets.
const saveDataStart = board.indexOf("function saveData()");
const saveChapterStart = board.indexOf("async function saveCampaignNow", saveDataStart);
assert.ok(saveDataStart >= 0 && saveChapterStart > saveDataStart);
assert.match(board.slice(saveDataStart, saveChapterStart), /sync-board-characters/);
assert.match(board.slice(saveDataStart, saveChapterStart), /SALVO \+ FICHAS SINCRONIZADAS/);
assert.match(board, /Abrir um capítulo também sincroniza suas fichas existentes com o servidor/);

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
