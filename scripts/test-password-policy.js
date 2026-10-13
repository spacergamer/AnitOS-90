const assert = require("node:assert/strict");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  let databaseWrites = 0;
  const db = {
    async query(sql) {
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) return {rows: []};
      databaseWrites++;
      throw new Error("Weak passwords must be rejected before database writes.");
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
        role: "master",
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
      assert.equal(response.status, 400, name + " password must be rejected");
      assert.match((await response.json()).error, /senha/i);
    }
    assert.equal(databaseWrites, 0, "weak-password attempts must not write accounts or sessions");
    console.log("Registration password policy tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
