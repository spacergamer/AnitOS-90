const assert = require("node:assert/strict");
const fs = require("node:fs");

const home = fs.readFileSync("public/home.html", "utf8");
const board = fs.readFileSync("AnitOS '89/lightfade.html", "utf8");
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
assert.match(room, /\.\.\.\(campaignId\?\{campaignId\}:\{\}\)/);

// The integrated pages must resolve to the same server-side routes.
assert.match(server, /app\.get\("\/room\.html"/);
assert.match(server, /app\.get\("\/board\.html"/);
assert.match(server, /app\.get\("\/anitopeboard\/",/);

// Campaign-scoped rooms must remain scoped after a server restart.
assert.match(server, /code:r\.code,title:r\.title,campaignId:r\.campaignId\|\|null,rolls:/);
assert.match(server, /campaignId:typeof data\.campaignId==="string"\?data\.campaignId:null,players:new Map\(\)/);

console.log("Integration wiring regression tests passed.");
