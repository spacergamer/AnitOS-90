const assert = require("node:assert/strict");
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
          id:params[0], email:null, display_name:params[1], employee_name:params[2], role:"player",
          password_salt:params[3], password_hash:params[4], is_premium:false, is_dev:false,
          username:params[5], public_code:params[6], recovery_salt:params[7], recovery_hash:params[8],
          recovery_code_salt:params[9], recovery_code_hash:params[10], profile_complete:false
        };
        users.set(user.id,user);
        return {rows:[{...user}]};
      }
      if (sql.includes("INSERT INTO anitos_sessions")) {
        sessions.set(params[0],params[1]);
        return {rows:[]};
      }
      if (sql.includes("SELECT id,recovery_salt,recovery_hash FROM anitos_users WHERE lower(username)=$1")) {
        const user=[...users.values()].find(row=>row.username.toLowerCase()===params[0]);
        return {rows:user?[{id:user.id,recovery_salt:user.recovery_salt,recovery_hash:user.recovery_hash}]:[]};
      }
      if (sql.includes("UPDATE anitos_users SET recovery_code_salt=$1,recovery_code_hash=$2 WHERE id=$3")) {
        const user=users.get(params[2]);
        if(user){user.recovery_code_salt=params[0];user.recovery_code_hash=params[1];}
        return {rows:[]};
      }
      if (sql.includes("SELECT id,display_name,recovery_salt,recovery_hash,recovery_code_salt,recovery_code_hash FROM anitos_users")) {
        const user=[...users.values()].find(row=>row.username.toLowerCase()===params[0]&&row.public_code===params[1]);
        return {rows:user?[{id:user.id,display_name:user.display_name,recovery_salt:user.recovery_salt,recovery_hash:user.recovery_hash,recovery_code_salt:user.recovery_code_salt,recovery_code_hash:user.recovery_code_hash}]:[]};
      }
      if (sql.includes("UPDATE anitos_users SET password_salt=$1,password_hash=$2 WHERE id=$3")) {
        const user=users.get(params[2]);
        if(user){user.password_salt=params[0];user.password_hash=params[1];}
        return {rows:[]};
      }
      if (sql.includes("DELETE FROM anitos_sessions WHERE user_id=$1")) {
        for(const [tokenHash,userId] of sessions)if(userId===params[0])sessions.delete(tokenHash);
        sessionDeletes++;
        return {rows:[]};
      }
      if (sql.includes("FROM anitos_users WHERE lower(username)=$1 AND public_code=$2")) {
        const user=[...users.values()].find(row=>row.username.toLowerCase()===params[0]&&row.public_code===params[1]);
        return {rows:user?[{...user}]:[]};
      }
      throw new Error("Unexpected query in account recovery test: "+sql);
    }
  };

  const app=express();
  registerAuthRoutes(app,express,db);
  const server=await new Promise(resolve=>{const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));});
  const base="http://127.0.0.1:"+server.address().port;
  async function post(path,body){
    return fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  }

  try{
    const registration=await post("/api/auth/register",{
      employeeName:"Ash Katarine Carter",username:"ash_carter",favoriteFood:"Pudim",
      favoriteAnimal:"Axolote",password:"Senha1234!",confirmPassword:"Senha1234!"
    });
    assert.equal(registration.status,201,"registration should succeed without an email");
    const created=await registration.json();
    assert.match(created.userTag,/^ash_carter #\\d{4}$/);
    assert.match(created.recoveryCode,/^[A-Z2-9]{16}$/);
    assert.equal(created.user.credentialsReady,true);
    assert.equal(created.user.profileComplete,false);
    const [username,publicCode]=created.userTag.split("#").map(value=>value.trim());

    const wrongCode=await post("/api/auth/recover-account",{
      userTag:created.userTag,recoveryCode:"WRONGRECOVERYCODE",
      password:"NovaSenha123!",confirmPassword:"NovaSenha123!"
    });
    assert.equal(wrongCode.status,403,"an invalid recovery code must be rejected");

    const reveal=await post("/api/auth/reveal-recovery-code",{
      username,favoriteFood:" pudim ",favoriteAnimal:"AXOLOTE"
    });
    assert.equal(reveal.status,200,"favorite answers should reveal a freshly generated recovery code");
    const revealed=await reveal.json();
    assert.match(revealed.recoveryCode,/^[A-Z2-9]{16}$/);

    const codeRecovery=await post("/api/auth/recover-account",{
      userTag:created.userTag,recoveryCode:revealed.recoveryCode,
      password:"NovaSenha123!",confirmPassword:"NovaSenha123!"
    });
    assert.equal(codeRecovery.status,200,"the recovery code should reset the password");
    assert.equal(sessionDeletes,1,"successful recovery must invalidate existing sessions");

    const login=await post("/api/auth/login",{username,publicCode,password:"NovaSenha123!"});
    assert.equal(login.status,200,"the new password must work with username and account number");
    const loginPayload=await login.json();
    assert.equal(loginPayload.user.credentialsReady,true);

    const oldPassword=await post("/api/auth/login",{username,publicCode,password:"Senha1234!"});
    assert.equal(oldPassword.status,401,"the old password must stop working after recovery");

    const badTag=await post("/api/auth/recover-account",{
      userTag:"ash_carter #12",recoveryCode:revealed.recoveryCode,
      password:"OutraSenha123!",confirmPassword:"OutraSenha123!"
    });
    assert.equal(badTag.status,400,"account numbers must contain exactly four digits");
    console.log("Username account recovery tests passed.");
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
