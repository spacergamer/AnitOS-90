const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const masterToken = "a".repeat(64);
  const playerToken = "b".repeat(64);
  const assignedCharacter = {
    id: "char-player", campaign_id: "campaign-1", name: "Ficha do Jogador",
    data: {hp: 12}, assigned_player_id: "player-1", updated_at: "2026-10-13T12:00:00Z"
  };
  const otherCharacter = {
    id: "char-other", campaign_id: "campaign-1", name: "Outra Ficha",
    data: {hp: 8}, assigned_player_id: "player-2", updated_at: "2026-10-13T12:00:00Z"
  };
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({sql: sql.replace(/\s+/g, " ").trim(), params});
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) {
        const hash = params[0];
        const masterHash = crypto.createHash("sha256").update(masterToken).digest("hex");
        const playerHash = crypto.createHash("sha256").update(playerToken).digest("hex");
        if (hash === masterHash) return {rows: [{id: "master-1", email: "master@example.test", display_name: "Mestre", role: "master"}]};
        if (hash === playerHash) return {rows: [{id: "player-1", email: "player@example.test", display_name: "Jogador", role: "player"}]};
        return {rows: []};
      }
      if (sql.includes("SELECT c.owner_id FROM anitos_campaigns c")) {
        return {rows: [{owner_id: "master-1"}]};
      }
      if (sql.includes("SELECT id,campaign_id,name,data,assigned_player_id,created_at,updated_at FROM anitos_characters")) {
        if (sql.includes("assigned_player_id=$2")) {
          assert.equal(params[1], "player-1", "player queries must be scoped to their own user ID");
          return {rows: [assignedCharacter]};
        }
        return {rows: [assignedCharacter, otherCharacter]};
      }
      if (sql.includes("CASE WHEN c.owner_id=$1 THEN c.data ELSE NULL END AS data")) {
        assert.equal(params[0], "player-1");
        return {rows: [{id: "campaign-1", owner_id: "master-1", title: "Campanha", join_code: null, data: null, is_owner: false}]};
      }
      throw new Error("Unexpected query: " + sql);
    }
  };

  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function get(path, token) {
    return fetch(base + path, {headers: {cookie: "anitos_session=" + token}});
  }

  try {
    const campaignResponse = await get("/api/campaigns/campaign-1", playerToken);
    assert.equal(campaignResponse.status, 200);
    const campaignBody = await campaignResponse.json();
    assert.equal(campaignBody.campaign.data, null, "players must not receive the full campaign/board snapshot");

    const sheetsResponse = await get("/api/campaigns/campaign-1/characters", playerToken);
    assert.equal(sheetsResponse.status, 200);
    const sheetsBody = await sheetsResponse.json();
    assert.equal(sheetsBody.readOnly, true);
    assert.deepEqual(sheetsBody.characters.map(character => character.id), ["char-player"]);
    const playerCharacterQuery = calls.find(call => call.sql.includes("SELECT id,campaign_id,name,data,assigned_player_id,created_at,updated_at FROM anitos_characters") && call.sql.includes("assigned_player_id=$2"));
    assert.ok(playerCharacterQuery, "player character query must filter by assigned player");
    assert.equal(playerCharacterQuery.params[1], "player-1");

    const masterResponse = await get("/api/campaigns/campaign-1/characters", masterToken);
    assert.equal(masterResponse.status, 200);
    const masterBody = await masterResponse.json();
    assert.deepEqual(masterBody.characters.map(character => character.id), ["char-player", "char-other"]);
    assert.equal(calls.some(call => call.sql.includes("SELECT id,campaign_id,name,data,assigned_player_id,created_at,updated_at FROM anitos_characters") && !call.sql.includes("assigned_player_id=$2")), true,
      "master can load all campaign characters");

    console.log("Player character privacy tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
