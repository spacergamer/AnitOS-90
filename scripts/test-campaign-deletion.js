const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const masterToken = "a".repeat(64);
  const playerToken = "b".repeat(64);
  const calls = [];
  let campaignExists = true;
  const db = {
    async query(sql, params) {
      const normalized = sql.replace(/\\s+/g, " ").trim();
      calls.push({sql: normalized, params});
      if (normalized.includes("FROM anitos_sessions s JOIN anitos_users")) {
        const hash = params[0];
        if (hash === crypto.createHash("sha256").update(masterToken).digest("hex")) {
          return {rows: [{id: "master-1", email: "master@example.test", display_name: "Mestre", role: "master"}]};
        }
        if (hash === crypto.createHash("sha256").update(playerToken).digest("hex")) {
          return {rows: [{id: "player-1", email: "player@example.test", display_name: "Jogador", role: "player"}]};
        }
        return {rows: []};
      }
      if (normalized.startsWith("DELETE FROM anitos_campaigns")) {
        assert.equal(params[1], "master-1", "delete must always be scoped to the authenticated master");
        return {rows: campaignExists ? [{id: params[0], title: "Campanha Teste"}] : []};
      }
      throw new Error("Unexpected query: " + normalized);
    }
  };

  const app = express();
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const remove = token => fetch(base + "/api/campaigns/campaign-1", {
    method: "DELETE",
    headers: {cookie: "anitos_session=" + token}
  });

  try {
    const playerResponse = await remove(playerToken);
    assert.equal(playerResponse.status, 403, "players must not delete campaigns");
    assert.equal(calls.some(call => call.sql.startsWith("DELETE FROM anitos_campaigns")), false,
      "unauthorized requests must never reach the delete query");

    const masterResponse = await remove(masterToken);
    assert.equal(masterResponse.status, 200);
    assert.deepEqual(await masterResponse.json(), {
      ok: true, deleted: {id: "campaign-1", title: "Campanha Teste"}
    });
    const deleteCall = calls.find(call => call.sql.startsWith("DELETE FROM anitos_campaigns"));
    assert.ok(deleteCall, "master deletion should issue a delete query");
    assert.match(deleteCall.sql, /WHERE id=\\$1 AND owner_id=\\$2/,
      "deletion must enforce campaign ownership in SQL");

    campaignExists = false;
    const missingResponse = await remove(masterToken);
    assert.equal(missingResponse.status, 404, "unknown or non-owned campaigns must not be reported as deleted");
    assert.deepEqual(await missingResponse.json(), {error: "Campanha não encontrada ou sem permissão."});
    console.log("Campaign deletion permission tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
