const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const masterToken = "a".repeat(64);
  const playerToken = "b".repeat(64);
  let snapshot = null;
  let connectCount = 0;
  const clientCalls = [];
  const db = {
    async query(sql, params) {
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) {
        const isMaster = params[0] === crypto.createHash("sha256").update(masterToken).digest("hex");
        const isPlayer = params[0] === crypto.createHash("sha256").update(playerToken).digest("hex");
        if (isMaster) return {rows: [{id: "master-1", email: "master@example.test", display_name: "Mestre", role: "master"}]};
        if (isPlayer) return {rows: [{id: "player-1", email: "player@example.test", display_name: "Jogador", role: "player"}]};
        return {rows: []};
      }
      throw new Error("Unexpected pool query: " + sql);
    },
    async connect() {
      connectCount++;
      return {
        async query(sql, params) {
          clientCalls.push({sql: sql.replace(/\\s+/g, " ").trim(), params});
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {rows: []};
          if (sql.includes("SELECT id,owner_id,data FROM anitos_campaigns")) {
            return {rows: [{id: "campaign-1", owner_id: "master-1", data: {snapshots: snapshot}}]};
          }
          if (sql.includes("INSERT INTO anitos_characters")) return {rows: [{id: params[0]}]};
          throw new Error("Unexpected client query: " + sql);
        },
        release() { clientCalls.push({sql: "RELEASE", params: []}); }
      };
    }
  };

  const app = express();
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function sync(token, chapterId = "chapterA") {
    return fetch(base + "/api/campaigns/campaign-1/sync-board-characters", {
      method: "POST",
      headers: {cookie: "anitos_session=" + token, "content-type": "application/json"},
      body: JSON.stringify({chapterId})
    });
  }

  try {
    const playerResponse = await sync(playerToken);
    assert.equal(playerResponse.status, 403, "players cannot invoke the master-only sync route");
    assert.equal((await playerResponse.json()).error, "Somente Mestres podem sincronizar fichas.");
    assert.equal(connectCount, 0, "role check happens before acquiring a database connection");

    const missingSnapshot = await sync(masterToken);
    assert.equal(missingSnapshot.status, 400, "unknown chapter snapshots are rejected");
    assert.equal((await missingSnapshot.json()).error, "O capítulo não possui uma lista de personagens sincronizável.");
    assert.equal(clientCalls.some(call => call.sql === "ROLLBACK"), true, "invalid snapshot rolls back");
    assert.equal(clientCalls.some(call => call.sql.startsWith("INSERT INTO anitos_characters")), false);
    assert.equal(clientCalls.at(-1).sql, "RELEASE");

    clientCalls.length = 0;
    snapshot = {chapterA: Array.from({length: 201}, (_, i) => ({id: "character-" + i, name: "Character " + i}))};
    const oversized = await sync(masterToken);
    assert.equal(oversized.status, 400, "snapshots above 200 entries are rejected");
    assert.equal((await oversized.json()).error, "O capítulo excede o limite de 200 personagens por sincronização.");
    assert.equal(clientCalls.some(call => call.sql === "ROLLBACK"), true, "oversized snapshot rolls back");
    assert.equal(clientCalls.some(call => call.sql.startsWith("INSERT INTO anitos_characters")), false);
    assert.equal(clientCalls.at(-1).sql, "RELEASE");

    const invalidChapterId = await sync(masterToken, "x".repeat(161));
    assert.equal(invalidChapterId.status, 400, "chapter identifiers above the limit are rejected");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log("Board sync access and limits tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
