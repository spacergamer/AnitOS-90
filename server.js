const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const {randomInt,randomBytes}=require("node:crypto");
const path=require("node:path");
const app=express(),server=http.createServer(app),io=new Server(server);
const PORT=process.env.PORT||3000,rooms=new Map(),DICE=new Set([4,6,8,10,12,20,100]);
const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
app.get("/health",(_q,r)=>r.json({ok:true}));
app.get("/",(_q,r)=>r.sendFile(path.join(__dirname,"public","index.html")));
function code(){let c;do{c=[...randomBytes(5)].map(b=>chars[b%chars.length]).join("")}while(rooms.has(c));return c}
function name(v,f="Jogador"){return String(v||"").trim().replace(/\s+/g," ").slice(0,24)||f}
function state(r){return {code:r.code,title:r.title,players:[...r.players.values()].map(p=>({...p})),rolls:r.rolls.slice(0,100)}}
function sync(r){io.to(r.code).emit("room:state",state(r))}
function error(s,m){s.emit("app:error",m)}
function leave(s){const c=s.data.roomCode;if(!c)return;const r=rooms.get(c);s.leave(c);s.data.roomCode=null;if(!r)return;r.players.delete(s.id);if(!r.players.size){rooms.delete(c);return}if(![...r.players.values()].some(p=>p.admin)){r.players.values().next().value.admin=true}sync(r)}
io.on("connection",s=>{
 s.on("room:create",p=>{leave(s);const c=code(),r={code:c,title:String(p?.title||"Sessão sem título").trim().slice(0,36)||"Sessão sem título",players:new Map(),rolls:[]};r.players.set(s.id,{id:s.id,name:name(p?.name,"Mestre"),admin:true});rooms.set(c,r);s.join(c);s.data.roomCode=c;s.emit("room:joined",state(r));sync(r)});
 s.on("room:join",p=>{const c=String(p?.code||"").trim().toUpperCase(),r=rooms.get(c);if(!r)return error(s,"Sala não encontrada. Confira o código.");leave(s);r.players.set(s.id,{id:s.id,name:name(p?.name),admin:false});s.join(c);s.data.roomCode=c;s.emit("room:joined",state(r));sync(r)});
 s.on("dice:roll",p=>{const r=rooms.get(s.data.roomCode);if(!r||!r.players.has(s.id))return error(s,"Entre em uma sala antes de rolar.");const sides=Number(p?.sides),m=Number(p?.modifier||0);if(!DICE.has(sides))return error(s,"Dado inválido.");if(!Number.isFinite(m))return error(s,"Modificador inválido.");const mod=Math.max(-999,Math.min(999,Math.trunc(m))),pl=r.players.get(s.id),natural=randomInt(1,sides+1);const roll={id:randomBytes(8).toString("hex"),name:name(p?.character,pl.name),playerName:pl.name,sides,natural,modifier:mod,total:natural+mod,time:new Date().toISOString()};r.rolls.unshift(roll);r.rolls=r.rolls.slice(0,100);io.to(r.code).emit("dice:rolled",roll)});
 s.on("room:close",()=>{const c=s.data.roomCode,r=rooms.get(c);if(!r)return;if(!r.players.get(s.id)?.admin)return error(s,"Só o administrador pode encerrar a sala.");io.to(c).emit("room:closed","O administrador encerrou a sala.");for(const id of r.players.keys()){const member=io.sockets.sockets.get(id);if(member){member.leave(c);member.data.roomCode=null}}rooms.delete(c)});
 s.on("room:leave",()=>leave(s));s.on("disconnect",()=>leave(s));
});
server.listen(PORT,"0.0.0.0",()=>console.log("Dice Rooms na porta "+PORT));
