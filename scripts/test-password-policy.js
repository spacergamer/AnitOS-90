const assert = require("node:assert/strict");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  let databaseWrites = 0;
  const db = {
    async query(sql, params = []) {
      databaseWrites++;
      if (sql.includes("INSERT INTO anitos_users")) {
        return {rows: [{
          id: params[0], display_name: params[1], employee_name: params[2], role: "player",
          is_premium: false, is_dev: false, email_verified: true,
          username: params[5], recovery_salt: params[6], recovery_hash: params[7],
          recovery_code_salt: params[8], recovery_code_hash: params[9], profile_complete: false
        }]};
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
        employeeName: "Teste " + suffix,
        username: "policy_" + suffix.replace(/[^a-z0-9]/g, "_"),
        favoriteFood: "Pizza",
        favoriteAnimal: "Gato",
        password,
        confirmPassword: password
      })
    });
  }

  try {
    const cases = [
      ["strong-minimum", "Ab1!short"],
      ["no-uppercase", "anitosstrong1!"],
      ["no-lowercase", "ANITOSSTRONG1!"],
      ["no-number", "AnitosStrong!!"],
      ["no-symbol", "AnitosStrong12"]
    ];
    for (const [name, password] of cases) {
      const response = await register(password, name);
      assert.equal(response.status, 201, name + " password should be accepted; strength is a recommendation");
      const payload = await response.json();
      assert.equal(payload.user.credentialsReady, true, "new account must receive recovery credentials");
      assert.equal(payload.userTag, payload.user.username);
      assert.match(payload.recoveryCode, /^[A-Z2-9]{16}$/);
      assert.equal(payload.user.publicCode, undefined);
    }
    const shortResponse = await register("Ab1!sho", "short");
    assert.equal(shortResponse.status, 400, "passwords shorter than eight characters must be rejected");
    const emptyResponse = await register("", "empty");
    assert.equal(emptyResponse.status, 400, "empty password must be rejected");
    const mismatchResponse = await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({employeeName:"Teste",username:"mismatch",favoriteFood:"Pizza",favoriteAnimal:"Gato",password:"Senha1234!",confirmPassword:"Senha4321!"})
    });
    assert.equal(mismatchResponse.status, 400, "password confirmation mismatch must be rejected");
    assert.equal(databaseWrites, cases.length * 2, "each accepted account creates a user and a session; invalid passwords must not write");
    console.log("Registration password policy and generated account credential tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
