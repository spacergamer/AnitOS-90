const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const {randomInt,randomBytes}=require("node:crypto");
const {Pool}=require("pg");
const path=require("node:path");
const {initializeAuthSchema,registerAuthRoutes}=require("./auth");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;
const db=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="disable"?false:{rejectUnauthorized:false}}):null;
const rooms=new Map();
const rateBuckets=new Map();
const DICE=new Set([4,6,8,10,12,20,100]);
const RESUME_WINDOW_MS=30_000;
const MAX_ROOMS=200;
const MAX_PLAYERS_PER_ROOM=20;
const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let rateChecks=0;
let persistQueue=Promise.resolve();

registerAuthRoutes(app,express,db);

// Recursos do lobby RGN legado.
app.use("/img",express.static(path.join(__dirname,"img")));

// ANITOPEBOARD: módulo independente, com recursos próprios (img/, aud/).
const boardDir=path.join(__dirname,"AnitOS '89");
app.get("/anitopeboard",(_q,r)=>r.redirect(302,"/anitopeboard/"));
app.use("/anitopeboard",express.static(boardDir));
app.get("/anitopeboard/",(_q,r)=>r.sendFile(path.join(boardDir,"lightfade.html")));

app.get("/health",(_q,r)=>r.json({ok:true}));
app.get("/rgn",(_q,r)=>r.sendFile(path.join(__dirname,"public","index.html")));
app.get("/",(_q,r)=>r.sendFile(path.join(__dirname,"public","index.html")));

function code(){
 let c;
 do{c=[...randomBytes(5)].map(b=>chars[b%chars.length]).join("")}while(rooms.has(c));
 return c;
}
function name(v,f="Jogador"){
 return String(v||"").trim().replace(/\s+/g," ").slice(0,24)||f;
}
function state(r){
 return {
  code:r.code,
  title:r.title,
  players:[...r.players.values()].map(p=>({
   id:p.id,name:p.name,admin:p.admin,connected:p.connected
  })),
  rolls:r.rolls.slice(0,100),
  chat:Array.isArray(r.chat)?r.chat.slice(-100):[]
 };
}
function sync(r){io.to(r.code).emit("room:state",state(r))}
function snapshot(){
 return [...rooms.values()].map(r=>({
  code:r.code,title:r.title,rolls:r.rolls,chat:Array.isArray(r.chat)?r.chat.slice(-100):[],bannedNames:[...(r.bannedNames||[])],
  players:[...r.players.values()].map(p=>({
   id:p.id,recoveryToken:p.recoveryToken,name:p.name,admin:p.admin,connected:p.connected
  }))
 }));
}
function persistState(){
 if(!db)return;
 persistQueue=persistQueue.then(async()=>{
  await db.query(`INSERT INTO anitos_state(id,state,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()`,[JSON.stringify(snapshot())]);
 }).catch(e=>console.error("[persistence] Não foi possível salvar o estado:",e.message));
}
async function initializePersistence(){
 if(!db){console.warn("[persistence] DATABASE_URL não definido; usando apenas memória.");return;}
 await db.query(`CREATE TABLE IF NOT EXISTS anitos_state(id smallint PRIMARY KEY CHECK(id=1),state jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW())`);
 await initializeAuthSchema(db);
 const result=await db.query("SELECT state FROM anitos_state WHERE id=1");
 const saved=result.rows[0]?.state;
 if(Array.isArray(saved)){
  for(const data of saved){
   if(!data||typeof data.code!=="string"||!Array.isArray(data.players))continue;
   const r={code:data.code,title:String(data.title||"Sessão sem título").slice(0,36),players:new Map(),rolls:Array.isArray(data.rolls)?data.rolls.slice(0,100):[],chat:Array.isArray(data.chat)?data.chat.slice(-100):[],bannedNames:new Set(Array.isArray(data.bannedNames)?data.bannedNames:[])};
   for(const old of data.players){
    if(!old||typeof old.id!=="string"||typeof old.recoveryToken!=="string")continue;
    const p={id:old.id,recoveryToken:old.recoveryToken,name:name(old.name),admin:Boolean(old.admin),connected:false,socketId:null,resumeTimer:null,resumeExpiresAt:Date.now()+RESUME_WINDOW_MS};
    r.players.set(p.id,p);
   }
   if(r.players.size){rooms.set(r.code,r);for(const p of r.players.values())expireDisconnectedPlayer(r,p);}
  }
 }
 persistState();
 console.log("[persistence] Estado carregado do Supabase; sessões desconectadas podem ser recuperadas por 30 segundos.");
}
function error(s,m){s.emit("app:error",m)}
function allowEvent(s,event,limit,windowMs,scope="socket"){
 const now=Date.now();
 const identity=scope==="ip"?(s.handshake.address||"unknown"):s.id;
 const key=scope+":"+identity+":"+event;
 let bucket=rateBuckets.get(key);
 if(!bucket||now-bucket.start>=windowMs){
  bucket={start:now,count:0};
  rateBuckets.set(key,bucket);
 }
 if(bucket.count>=limit){
  error(s,"Muitas ações em pouco tempo. Aguarde um instante e tente novamente.");
  return false;
 }
 bucket.count++;
 if(++rateChecks%250===0){
  for(const [k,v] of rateBuckets)if(now-v.start>120_000)rateBuckets.delete(k);
 }
 return true;
}
function promoteAdmin(r){
 if([...r.players.values()].some(p=>p.admin))return;
 const next=[...r.players.values()].find(p=>p.connected)||r.players.values().next().value;
 if(next)next.admin=true;
}
function removePlayer(r,p){
 if(p.resumeTimer)clearTimeout(p.resumeTimer);
 r.players.delete(p.id);
 if(!r.players.size){rooms.delete(r.code);persistState();return}
 promoteAdmin(r);
 sync(r);
 persistState();
}
function leave(s){
 const c=s.data.roomCode,playerId=s.data.playerId;
 if(c)s.leave(c);
 s.data.roomCode=null;
 s.data.playerId=null;
 if(!c||!playerId)return;
 const r=rooms.get(c),p=r?.players.get(playerId);
 if(r&&p)removePlayer(r,p);
}
function findPlayerByToken(token){
 for(const r of rooms.values()){
  for(const p of r.players.values()){
   if(p.recoveryToken===token)return {room:r,player:p};
  }
 }
 return null;
}
function joinedPayload(r,p){
 return {...state(r),playerId:p.id,recoveryToken:p.recoveryToken};
}
function connectPlayer(s,r,p){
 if(p.resumeTimer)clearTimeout(p.resumeTimer);
 p.resumeTimer=null;
 p.resumeExpiresAt=null;
 p.connected=true;
 p.socketId=s.id;
 s.join(r.code);
 s.data.roomCode=r.code;
 s.data.playerId=p.id;
 s.emit("room:joined",joinedPayload(r,p));
 sync(r);
 persistState();
}
function expireDisconnectedPlayer(r,p){
 if(p.resumeTimer)clearTimeout(p.resumeTimer);
 p.resumeExpiresAt=Date.now()+RESUME_WINDOW_MS;
 p.resumeTimer=setTimeout(()=>{
  if(rooms.get(r.code)!==r||r.players.get(p.id)!==p||p.connected)return;
  removePlayer(r,p);
 },RESUME_WINDOW_MS);
 if(p.resumeTimer.unref)p.resumeTimer.unref();
}

io.on("connection",s=>{
 s.on("system:ping",(_sentAt,ack)=>{if(typeof ack==="function")ack(Date.now())});
 s.on("room:create",p=>{
  if(!allowEvent(s,"room:create",3,60_000)||!allowEvent(s,"room:create",10,60_000,"ip"))return;
  if(rooms.size>=MAX_ROOMS)return error(s,"O servidor atingiu o limite de salas. Tente novamente mais tarde.");
  leave(s);
  const c=code();
  const r={
   code:c,
   title:String(p?.title||"Sessão sem título").trim().slice(0,36)||"Sessão sem título",
   players:new Map(),
   rolls:[],
   chat:[],
   bannedNames:new Set()
  };
  const player={
   id:randomBytes(12).toString("hex"),
   recoveryToken:randomBytes(32).toString("hex"),
   name:name(p?.name,"Mestre"),
   admin:true,
   connected:true,
   socketId:s.id,
   resumeTimer:null,
   resumeExpiresAt:null
  };
  r.players.set(player.id,player);
  rooms.set(c,r);
  connectPlayer(s,r,player);
 });
 s.on("room:join",p=>{
  if(!allowEvent(s,"room:join",10,60_000)||!allowEvent(s,"room:join",30,60_000,"ip"))return;
  const c=String(p?.code||"").trim().toUpperCase(),r=rooms.get(c);
  if(!r)return error(s,"Sala não encontrada. Confira o código.");
  const joiningName=name(p?.name).toLocaleLowerCase("pt-BR");
  if(r.bannedNames?.has(joiningName))return error(s,"Este nome foi banido desta sala. Entre em contato com o mestre.");
  if(r.players.size>=MAX_PLAYERS_PER_ROOM)return error(s,"Esta sala atingiu o limite de 20 jogadores.");
  leave(s);
  const player={
   id:randomBytes(12).toString("hex"),
   recoveryToken:randomBytes(32).toString("hex"),
   name:name(p?.name),
   admin:false,
   connected:true,
   socketId:s.id,
   resumeTimer:null,
   resumeExpiresAt:null
  };
  r.players.set(player.id,player);
  connectPlayer(s,r,player);
 });
 s.on("room:resume",p=>{
  if(!allowEvent(s,"room:resume",5,60_000))return;
  const token=String(p?.token||"");
  if(!/^[a-f0-9]{64}$/.test(token)){
   s.emit("room:resume:failed","Não foi possível recuperar a sessão. Entre novamente pelo lobby.");
   return;
  }
  const found=findPlayerByToken(token);
  if(!found){
   s.emit("room:resume:failed","A sala não existe mais ou o prazo de reconexão expirou. Entre novamente pelo lobby.");
   return;
  }
  const {room:r,player}=found;
  if(player.connected){
   error(s,"Esta sessão já está conectada em outra aba ou dispositivo.");
   return;
  }
  if(!player.resumeExpiresAt||player.resumeExpiresAt<=Date.now()){
   removePlayer(r,player);
   s.emit("room:resume:failed","O prazo de reconexão expirou. Entre novamente pelo lobby.");
   return;
  }
  connectPlayer(s,r,player);
 });
 s.on("dice:roll",p=>{
  if(!allowEvent(s,"dice:roll",8,1_000))return;
  const r=rooms.get(s.data.roomCode),playerId=s.data.playerId,pl=r?.players.get(playerId);
  if(!r||!pl||!pl.connected||pl.socketId!==s.id)return error(s,"Entre em uma sala antes de rolar.");
  const requested=Array.isArray(p?.dice)?p.dice:[p?.sides];
  if(!requested.length||requested.length>20||requested.some(v=>!DICE.has(Number(v))))return error(s,"Escolha entre 1 e 20 dados válidos.");
  const dice=requested.map(sides=>{const natural=randomInt(1,Number(sides)+1);return {sides:Number(sides),natural,total:natural,modifier:0}});
  const first=dice[0];
  const roll={
   id:randomBytes(8).toString("hex"),
   name:name(p?.character,pl.name),
   playerName:pl.name,
   sides:first.sides,natural:first.natural,modifier:0,total:first.total,dice,
   time:new Date().toISOString()
  };
  r.rolls.unshift(roll);
  r.rolls=r.rolls.slice(0,100);
  io.to(r.code).emit("dice:rolled",roll);
  persistState();
 });
 s.on("chat:send",p=>{
  if(!allowEvent(s,"chat:send",8,10_000))return;
  const r=rooms.get(s.data.roomCode),pl=r?.players.get(s.data.playerId);
  if(!r||!pl||!pl.connected||pl.socketId!==s.id)return error(s,"Entre em uma sala antes de conversar.");
  const text=String(p?.text||"").trim().slice(0,240);
  if(!text)return;
  r.chat=Array.isArray(r.chat)?r.chat:[];
  const message={id:randomBytes(8).toString("hex"),playerName:pl.name,text,time:new Date().toISOString()};
  r.chat.push(message);r.chat=r.chat.slice(-100);
  io.to(r.code).emit("chat:message",message);
  persistState();
 });
 s.on("chat:delete",p=>{
  if(!allowEvent(s,"chat:delete",20,10_000))return;
  const r=rooms.get(s.data.roomCode),pl=r?.players.get(s.data.playerId);
  if(!r||!pl)return error(s,"Entre em uma sala antes de moderar o chat.");
  if(!pl.admin)return error(s,"Só o administrador pode apagar mensagens do chat.");
  const id=String(p?.id||"");
  if(!Array.isArray(r.chat))r.chat=[];
  const index=r.chat.findIndex(item=>item.id===id);
  if(index<0)return error(s,"Essa mensagem não existe mais.");
  r.chat.splice(index,1);
  sync(r);persistState();
 });
 s.on("roll:delete",p=>{
  if(!allowEvent(s,"roll:delete",20,10_000))return;
  const r=rooms.get(s.data.roomCode),pl=r?.players.get(s.data.playerId);
  if(!r||!pl)return error(s,"Entre em uma sala antes de moderar.");
  if(!pl.admin)return error(s,"Só o administrador pode apagar rolagens.");
  const id=String(p?.id||"");
  const index=r.rolls.findIndex(item=>item.id===id);
  if(index<0)return error(s,"Essa rolagem não existe mais.");
  r.rolls.splice(index,1);
  sync(r);persistState();
 });
 s.on("room:ban",p=>{
  if(!allowEvent(s,"room:ban",10,10_000))return;
  const r=rooms.get(s.data.roomCode),admin=r?.players.get(s.data.playerId);
  if(!r||!admin)return error(s,"Entre em uma sala antes de moderar.");
  if(!admin.admin)return error(s,"Só o administrador pode banir jogadores.");
  const target=r.players.get(String(p?.playerId||""));
  if(!target)return error(s,"Jogador não encontrado.");
  if(target.id===admin.id||target.admin)return error(s,"Não é possível banir o administrador.");
  r.bannedNames=r.bannedNames||new Set();
  r.bannedNames.add(target.name.toLocaleLowerCase("pt-BR"));
  const member=target.socketId&&io.sockets.sockets.get(target.socketId);
  if(member){
   member.emit("room:banned","Você foi removido e banido desta sala pelo administrador.");
   member.leave(r.code);member.data.roomCode=null;member.data.playerId=null;
  }
  removePlayer(r,target);
  persistState();
 });
 s.on("room:close",()=>{
  if(!allowEvent(s,"room:close",3,10_000))return;
  const c=s.data.roomCode,r=rooms.get(c),pl=r?.players.get(s.data.playerId);
  if(!r||!pl)return;
  if(!pl.admin)return error(s,"Só o administrador pode encerrar a sala.");
  io.to(c).emit("room:closed","O administrador encerrou a sala.");
  for(const player of r.players.values()){
   if(player.resumeTimer)clearTimeout(player.resumeTimer);
   const member=player.socketId&&io.sockets.sockets.get(player.socketId);
   if(member){
    member.leave(c);
    member.data.roomCode=null;
    member.data.playerId=null;
   }
  }
  rooms.delete(c);
  persistState();
 });
 s.on("room:leave",()=>{
  if(!allowEvent(s,"room:leave",5,10_000))return;
  leave(s);
 });
 s.on("disconnect",()=>{
  const c=s.data.roomCode,playerId=s.data.playerId;
  const r=rooms.get(c),p=r?.players.get(playerId);
  if(!r||!p||p.socketId!==s.id)return;
  p.connected=false;
  p.socketId=null;
  s.data.roomCode=null;
  s.data.playerId=null;
  expireDisconnectedPlayer(r,p);
  sync(r);
  persistState();
 });
});

initializePersistence().then(()=>{
 server.listen(PORT,"0.0.0.0",()=>console.log("Dice Rooms na porta "+PORT));
}).catch(e=>{
 console.error("[persistence] Falha ao inicializar o banco:",e.message);
 process.exit(1);
});
process.on("SIGINT",async()=>{await persistQueue;if(db)await db.end();process.exit(0)});
process.on("SIGTERM",async()=>{await persistQueue;if(db)await db.end();process.exit(0)});
