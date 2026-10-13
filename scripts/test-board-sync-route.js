const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const token = "a".repeat(64);
  const calls = [];
  let campaignFound = true;
  const campaign = {
    id: "campaign-1",
    owner_id: "master-1",
    data: {snapshots: {chapterA: [
      {id: "char-1", nome: "Aline", hp: 12},
      {id: "char-2", name: "Breno", hp: 9}
    ]}}
  };
  const db = {
    async query(sql, params) {
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) {
        assert.equal(params[0], crypto.createHash("sha256").update(token).digest("hex"));
        return {rows: [{id: "master-1", email: "master@example.test", display_name: "Mestre", role: "master"}]};
      }
      throw new Error("Unexpected pool query: " + sql);
    },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({sql: sql.replace(/\s+/g, " ").trim(), params});
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows: []};
          if (sql.includes("SELECT id,owner_id,data FROM anitos_campaigns")) {
            return {rows: campaignFound ? [campaign] : []};
          }
          if (sql.includes("INSERT INTO anitos_characters")) {
            return {rows: [{id: params[0]}]};
          }
          throw new Error("Unexpected client query: " + sql);
        },
        release() { calls.push({sql: "RELEASE", params: []}); }
      };
    }
  };

  const app = express();
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const ok = await fetch(base + "/api/campaigns/campaign-1/sync-board-characters", {
      method: "POST",
      headers: {cookie: "anitos_session=" + token, "content-type": "application/json"},
      body: JSON.stringify({chapterId: "chapterA"})
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {ok: true, chapterId: "chapterA", synced: 2});
    assert.equal(calls.filter(call => call.sql.startsWith("INSERT INTO anitos_characters")).length, 2);
    assert.equal(calls.at(-2).sql, "COMMIT", "successful sync commits before releasing the connection");
    assert.equal(calls.at(-1).sql, "RELEASE", "connection is always released");

    calls.length = 0;
    campaignFound = false;
    const denied = await fetch(base + "/api/campaigns/not-owned/sync-board-characters", {
      method: "POST",
      headers: {cookie: "anitos_session=" + token, "content-type": "application/json"},
      body: JSON.stringify({chapterId: "chapterA"})
    });
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).error, "Campanha não encontrada ou sem permissão.");
    assert.equal(calls.some(call => call.sql === "ROLLBACK"), true, "missing or unowned campaign rolls back");
    assert.equal(calls.some(call => call.sql.startsWith("INSERT INTO anitos_characters")), false);
    assert.equal(calls.at(-1).sql, "RELEASE");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log("Board sync route transaction tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
