const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const {randomInt,randomBytes}=require("node:crypto");
const path=require("node:path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;
const rooms=new Map();
const DICE=new Set([4,6,8,10,12,20,100]);
const RESUME_WINDOW_MS=30_000;
const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

app.get("/health",(_q,r)=>r.json({ok:true}));
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
  rolls:r.rolls.slice(0,100)
 };
}
function sync(r){io.to(r.code).emit("room:state",state(r))}
function error(s,m){s.emit("app:error",m)}
function promoteAdmin(r){
 if([...r.players.values()].some(p=>p.admin))return;
 const next=[...r.players.values()].find(p=>p.connected)||r.players.values().next().value;
 if(next)next.admin=true;
}
function removePlayer(r,p){
 if(p.resumeTimer)clearTimeout(p.resumeTimer);
 r.players.delete(p.id);
 if(!r.players.size){rooms.delete(r.code);return}
 promoteAdmin(r);
 sync(r);
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
 s.on("room:create",p=>{
  leave(s);
  const c=code();
  const r={
   code:c,
   title:String(p?.title||"Sessão sem título").trim().slice(0,36)||"Sessão sem título",
   players:new Map(),
   rolls:[]
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
  const c=String(p?.code||"").trim().toUpperCase(),r=rooms.get(c);
  if(!r)return error(s,"Sala não encontrada. Confira o código.");
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
  const r=rooms.get(s.data.roomCode),playerId=s.data.playerId,pl=r?.players.get(playerId);
  if(!r||!pl||!pl.connected||pl.socketId!==s.id)return error(s,"Entre em uma sala antes de rolar.");
  const sides=Number(p?.sides),m=Number(p?.modifier||0);
  if(!DICE.has(sides))return error(s,"Dado inválido.");
  if(!Number.isFinite(m))return error(s,"Modificador inválido.");
  const mod=Math.max(-999,Math.min(999,Math.trunc(m))),natural=randomInt(1,sides+1);
  const roll={
   id:randomBytes(8).toString("hex"),
   name:name(p?.character,pl.name),
   playerName:pl.name,
   sides,natural,modifier:mod,total:natural+mod,
   time:new Date().toISOString()
  };
  r.rolls.unshift(roll);
  r.rolls=r.rolls.slice(0,100);
  io.to(r.code).emit("dice:rolled",roll);
 });
 s.on("room:close",()=>{
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
 });
 s.on("room:leave",()=>leave(s));
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
 });
});

server.listen(PORT,"0.0.0.0",()=>console.log("Dice Rooms na porta "+PORT));
