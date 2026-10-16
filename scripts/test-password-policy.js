const assert = require("node:assert/strict");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  let databaseWrites = 0;
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) return {rows: []};
      databaseWrites++;
      if (sql.includes("INSERT INTO anitos_users")) {
        return {rows: [{id: "test-user-" + databaseWrites, email: params[1], display_name: params[2], role: params[3]}]};
      }
      if (sql.includes("INSERT INTO anitos_sessions")) return {rows: []};
      throw new Error("Unexpected database query in password-policy test: " + sql);
    }
  };
  const app = express();
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function register(password, suffix) {
    return fetch(base + "/api/auth/register", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        email: "policy-" + suffix + "@example.test",
        displayName: "Teste",
        role: "player",
        password
      })
    });
  }

  try {
    const cases = [
      ["short", "Ab1!short"],
      ["no-uppercase", "anitosstrong1!"],
      ["no-lowercase", "ANITOSSTRONG1!"],
      ["no-number", "AnitosStrong!!"],
      ["no-symbol", "AnitosStrong12"]
    ];
    for (const [name, password] of cases) {
      const response = await register(password, name);
      assert.equal(response.status, 201, name + " password should be allowed because strength rules are recommendations");
      const payload = await response.json();
      assert.equal(payload.user.role, "player");
    }
    const emptyResponse = await register("", "empty");
    assert.equal(emptyResponse.status, 400, "empty password must be rejected");
    assert.equal(databaseWrites, cases.length * 2, "each accepted account should create a user and session; empty password should not write");
    console.log("Optional password-strength recommendation tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
