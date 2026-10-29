const assert = require("node:assert/strict");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  let databaseWrites = 0;
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    ANITOS_PUBLIC_URL: process.env.ANITOS_PUBLIC_URL
  };
  process.env.RESEND_API_KEY = "test-key";
  process.env.AUTH_EMAIL_FROM = "ANITOPE TEST <test@example.test>";
  process.env.ANITOS_PUBLIC_URL = "https://anitos.example.test";
  global.fetch = async () => ({ok: true, status: 200, text: async () => ""});
  const db = {
    async query(sql, params = []) {
      databaseWrites++;
      if (sql.includes("INSERT INTO anitos_users")) {
        return {rows: [{id: "test-user-" + databaseWrites, email: params[1], display_name: params[2], role: params[3], email_verified: false}]};
      }
      if (sql.includes("DELETE FROM anitos_auth_tokens") || sql.includes("INSERT INTO anitos_auth_tokens")) return {rows: []};
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
      assert.equal(payload.verificationRequired, true, "registration must require email verification");
      assert.equal(typeof payload.user, "undefined", "registration must not log in before verification");
    }
    const emptyResponse = await register("", "empty");
    assert.equal(emptyResponse.status, 400, "empty password must be rejected");
    assert.equal(databaseWrites, cases.length * 3, "each accepted account should create a user and verification token; empty password should not write");
    console.log("Registration email-verification policy tests passed.");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
