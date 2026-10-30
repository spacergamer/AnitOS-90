const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const users = new Map();
  const sessions = new Map();
  let sessionDeletes = 0;

  const db = {
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO anitos_users")) {
        const user = {
          id: params[0], email: params[1], display_name: params[2], role: params[3],
          password_salt: params[4], password_hash: params[5], is_premium: false, is_dev: false,
          email_verified: true, username: params[6], public_code: params[7],
          recovery_salt: params[8], recovery_hash: params[9],
          recovery_code_salt: params[10], recovery_code_hash: params[11]
        };
        users.set(user.id, user);
        return {rows: [{...user}]};
      }
      if (sql.includes("INSERT INTO anitos_sessions")) {
        sessions.set(params[0], params[1]);
        return {rows: []};
      }
      if (sql.includes("SELECT id,display_name,recovery_salt,recovery_hash,recovery_code_salt,recovery_code_hash FROM anitos_users")) {
        const user = [...users.values()].find(row => row.username.toLowerCase() === params[0] && row.public_code === params[1]);
        return {rows: user ? [{id:user.id,display_name:user.display_name,recovery_salt:user.recovery_salt,recovery_hash:user.recovery_hash,recovery_code_salt:user.recovery_code_salt,recovery_code_hash:user.recovery_code_hash}] : []};
      }
      if (sql.includes("UPDATE anitos_users SET password_salt=$1,password_hash=$2 WHERE id=$3")) {
        const user = users.get(params[2]);
        if (user) { user.password_salt = params[0]; user.password_hash = params[1]; }
        return {rows: []};
      }
      if (sql.includes("DELETE FROM anitos_sessions WHERE user_id=$1")) {
        for (const [tokenHash, userId] of sessions) if (userId === params[0]) sessions.delete(tokenHash);
        sessionDeletes++;
        return {rows: []};
      }
      if (sql.includes("SELECT id,email,display_name,role,is_premium,is_dev,email_verified,username,public_code,recovery_salt,recovery_hash,recovery_code_salt,recovery_code_hash,password_salt,password_hash FROM anitos_users WHERE lower(username)=$1 AND public_code=$2")) {
        const user = [...users.values()].find(row => row.username.toLowerCase() === params[0] && row.public_code === params[1]);
        return {rows: user ? [{...user}] : []};
      }
      throw new Error("Unexpected query in account recovery test: " + sql);
    }
  };

  const app = express();
  registerAuthRoutes(app, express, db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function post(path, body) {
    return fetch(base + path, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify(body)
    });
  }

  try {
    const registration = await post("/api/auth/register", {
      displayName: "Spacer Test", username: "spacer_test", favoriteFood: "Pizza",
      favoriteAnimal: "Gato", role: "player", password: "original-pass",
      confirmPassword: "original-pass"
    });
    assert.equal(registration.status, 201, "registration should succeed");
    const created = await registration.json();
    assert.match(created.userTag, /^spacer_test#\d{3,6}$/);
    assert.match(created.recoveryCode, /^[A-Z2-9]{16}$/);
    assert.equal(created.user.credentialsReady, true);
    const userTag = created.userTag;

    const wrongCodeWithAnswers = await post("/api/auth/recover-account", {
      userTag, recoveryCode: "WRONGRECOVERYCODE", displayName: "Spacer Test",
      favoriteFood: "Pizza", favoriteAnimal: "Gato", password: "new-pass",
      confirmPassword: "new-pass"
    });
    assert.equal(wrongCodeWithAnswers.status, 403, "a supplied invalid secret must not silently fall back to answers");

    const codeRecovery = await post("/api/auth/recover-account", {
      userTag, recoveryCode: created.recoveryCode, password: "reset-with-code",
      confirmPassword: "reset-with-code"
    });
    assert.equal(codeRecovery.status, 200, "recovery code must work without display name or answers");
    assert.equal(sessionDeletes, 1, "successful recovery must invalidate sessions");

    const answerRecovery = await post("/api/auth/recover-account", {
      userTag, displayName: " spacer   TEST ", favoriteFood: " PIZZA ",
      favoriteAnimal: "gAtO", password: "reset-with-answers",
      confirmPassword: "reset-with-answers"
    });
    assert.equal(answerRecovery.status, 200, "normalized fallback answers should work when the secret is lost");
    assert.equal(sessionDeletes, 2, "each successful recovery must invalidate sessions");

    const mismatch = await post("/api/auth/recover-account", {
      userTag, displayName: "Spacer Test", favoriteFood: "Sushi",
      favoriteAnimal: "Gato", password: "nope", confirmPassword: "nope"
    });
    assert.equal(mismatch.status, 403, "incorrect fallback answers must be rejected");

    const badTag = await post("/api/auth/recover-account", {
      userTag: "spacer_test#12", recoveryCode: created.recoveryCode,
      password: "nope", confirmPassword: "nope"
    });
    assert.equal(badTag.status, 400, "tag suffixes shorter than three digits must be rejected");
    console.log("Account recovery flow tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
