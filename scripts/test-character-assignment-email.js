const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const {registerAuthRoutes} = require("../auth");

async function main() {
  const masterToken = "a".repeat(64);
  const playerToken = "b".repeat(64);
  const hashes = new Map([
    [crypto.createHash("sha256").update(masterToken).digest("hex"), {id:"master-1",email:"master@example.test",display_name:"Mestre",role:"master"}],
    [crypto.createHash("sha256").update(playerToken).digest("hex"), {id:"player-1",email:"player@example.test",display_name:"Jogador",role:"player"}]
  ]);
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({sql:sql.replace(/\\s+/g," ").trim(),params});
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return {rows:[]};
      if (sql.includes("FROM anitos_sessions s JOIN anitos_users")) {
        const user=hashes.get(params[0]);
        return {rows:user?[user]:[]};
      }
      if (sql.includes("SELECT id,campaign_id FROM anitos_characters WHERE id=$1 AND owner_id=$2")) {
        assert.ok(["character-1","character-2"].includes(params[0]));
        assert.equal(params[1],"master-1");
        return {rows:[{id:params[0],campaign_id:"campaign-1"}]};
      }
      if (sql.includes("SELECT u.id FROM anitos_users u") && sql.includes("lower(u.email)=$3")) {
        assert.equal(params[0],"campaign-1");
        assert.equal(params[1],"master-1");
        assert.equal(params[2],"player@example.test");
        return {rows:[{id:"player-1"}]};
      }
      if (sql.includes("SELECT u.id FROM anitos_users u") && sql.includes("lower(u.display_name)=$3")) {
        assert.equal(params[0],"campaign-1");
        assert.equal(params[1],"master-1");
        assert.equal(params[2],"jogador");
        return {rows:[{id:"player-1"}]};
      }
      if (sql.includes("FROM anitos_campaign_members m") && sql.includes("u.role=\'player\'")) return {rows:[{id:"player-1"}]};
      if (sql.includes("UPDATE anitos_characters SET assigned_player_id=NULL")) return {rows:[]};
      if (sql.includes("UPDATE anitos_characters SET assigned_player_id=$1")) {
        return {rows:[{id:params[1],campaign_id:"campaign-1",name:params[1]==="character-2"?"Outro personagem":"Personagem",assigned_player_id:params[0]}]};
      }
      throw new Error("Unexpected query: "+sql);
    },
    async connect() { return {query:this.query.bind(this),release(){}}; }
  };
  const app=express();app.use(express.json());registerAuthRoutes(app,express,db);
  const server=await new Promise(resolve=>{const listener=app.listen(0,"127.0.0.1",()=>resolve(listener))});
  const base="http://127.0.0.1:"+server.address().port;
  async function post(path,token,body){return fetch(base+path,{method:"POST",headers:{"content-type":"application/json",cookie:"anitos_session="+token},body:JSON.stringify(body)})}
  async function patch(path,token,body){return fetch(base+path,{method:"PATCH",headers:{"content-type":"application/json",cookie:"anitos_session="+token},body:JSON.stringify(body)})}
  try {
    const assigned=await post("/api/characters/character-1/assign",masterToken,{playerEmail:" PLAYER@EXAMPLE.TEST "});
    assert.equal(assigned.status,200,"Master should assign by case-insensitive email");
    assert.equal((await assigned.json()).character.assigned_player_id,"player-1");
    const byHandle=await post("/api/characters/character-1/assign",masterToken,{playerHandle:"@Jogador"});
    assert.equal(byHandle.status,200,"Master should assign by case-insensitive @handle");
    assert.equal((await byHandle.json()).character.assigned_player_id,"player-1");
    const moved=await post("/api/characters/character-2/assign",masterToken,{playerHandle:"jogador"});
    assert.equal(moved.status,200,"A player can be moved to another character");
    assert.equal((await moved.json()).character.assigned_player_id,"player-1");
    assert.ok(calls.some(call=>call.sql.includes("UPDATE anitos_characters SET assigned_player_id=NULL")&&call.params[3]==="character-2"),
      "Reassignment must clear the player's previous character in the campaign");
    const removed=await post("/api/characters/character-2/assign",masterToken,{playerHandle:""});
    assert.equal(removed.status,200,"Master should be able to remove an assignment");
    assert.equal((await removed.json()).character.assigned_player_id,null);
    const invalid=await post("/api/characters/character-1/assign",masterToken,{playerEmail:"not-an-email"});
    assert.equal(invalid.status,400,"Invalid email must be rejected");
    const playerAssign=await post("/api/characters/character-1/assign",playerToken,{playerEmail:"player@example.test"});
    assert.equal(playerAssign.status,403,"Players must not assign character sheets");
    const playerEdit=await patch("/api/characters/character-1",playerToken,{data:{hp:999}});
    assert.equal(playerEdit.status,403,"Players must not edit character sheet values or items");
    assert.equal(calls.filter(c=>c.sql.includes("UPDATE anitos_characters SET assigned_player_id=$1")).length,4,
      "Only authorized master assignment and unassignment requests should update the database");
    console.log("Character assignment-by-email/@handle and player read-only tests passed.");
  } finally {await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
