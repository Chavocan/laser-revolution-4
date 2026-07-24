'use strict';
// LR4 multiplayer server: static files + WebSocket room relay.
// Rooms hold up to 4 players (slot 0 = host, authoritative client).
// Lobby flow: create -> others join -> host sends 'begin' -> everyone gets 'start'.
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = __dirname;
const PORT = +(process.argv[2] || process.env.PORT || 8124);
const MAX_PLAYERS = 4;
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.md':'text/plain; charset=utf-8','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg'};

const server = http.createServer((req,res)=>{
  let p = decodeURIComponent((req.url||'/').split('?')[0]);
  if(p==='/') p='/index.html';
  const f = path.normalize(path.join(ROOT,p));
  if(!f.startsWith(ROOT)){ res.writeHead(403); res.end(); return; }
  fs.readFile(f,(err,data)=>{
    if(err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server});
const rooms = new Map(); // code -> {mode, stage, slots:[ws|null x4], started}
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code4(){ let s=''; for(let i=0;i<4;i++) s+=CODE[Math.floor(Math.random()*CODE.length)]; return rooms.has(s)? code4():s; }
function count(r){ return r.slots.filter(Boolean).length; }
function roomList(){
  const l=[];
  for(const [c,r] of rooms) if(!r.started && count(r)<MAX_PLAYERS)
    l.push({code:c, mode:r.mode, stage:r.stage, count:count(r)});
  return l;
}
function pushRooms(){
  const m = JSON.stringify({t:'rooms',rooms:roomList()});
  for(const ws of wss.clients) if(ws.readyState===1 && !ws.room) ws.send(m);
}
function sendLobby(r,code){
  const players = r.slots.map((s,i)=>s?i:null).filter(v=>v!==null);
  for(const ws of r.slots){
    if(ws && ws.readyState===1)
      ws.send(JSON.stringify({t:'lobby', code, mode:r.mode, stage:r.stage, players, you:ws.idx}));
  }
}
function relay(r, from, raw){
  for(const ws of r.slots) if(ws && ws!==from && ws.readyState===1) ws.send(raw);
}
function leaveRoom(ws){
  const r = ws.room && rooms.get(ws.room);
  if(!r){ ws.room=null; return; }
  const code = ws.room;
  r.slots[ws.idx]=null;
  ws.room=null;
  const msg = JSON.stringify({t:'peerLeft', idx:ws.idx});
  for(const c of r.slots) if(c && c.readyState===1) c.send(msg);
  if(ws.idx===0 || count(r)===0){
    // host gone: kick everyone home, kill the room
    for(const c of r.slots) if(c){ c.room=null; }
    rooms.delete(code);
  } else if(!r.started){
    sendLobby(r,code);
  }
  pushRooms();
}

wss.on('connection',ws=>{
  ws.room=null; ws.idx=-1;
  ws.send(JSON.stringify({t:'rooms',rooms:roomList()}));
  ws.on('message',raw=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    if(m.t==='create'){
      leaveRoom(ws);
      const c = code4();
      const r = {mode: m.mode==='vs'?'vs':'coop', stage: Math.max(0,Math.min(3, m.stage|0)), slots:[ws,null,null,null], started:false};
      rooms.set(c,r); ws.room=c; ws.idx=0;
      sendLobby(r,c); pushRooms();
      return;
    }
    if(m.t==='join'){
      const r = rooms.get(m.code);
      if(!r || r.started || count(r)>=MAX_PLAYERS){ ws.send(JSON.stringify({t:'err',msg:'that party is gone or full'})); return; }
      leaveRoom(ws);
      const idx = r.slots.findIndex(s=>!s);
      r.slots[idx]=ws; ws.room=m.code; ws.idx=idx;
      sendLobby(r,m.code); pushRooms();
      return;
    }
    if(m.t==='begin'){
      const r = ws.room && rooms.get(ws.room);
      if(!r || ws.idx!==0 || r.started || count(r)<2) return;
      r.started=true;
      for(const c of r.slots) if(c && c.readyState===1)
        c.send(JSON.stringify({t:'start', mode:r.mode, stage:r.stage, you:c.idx, code:ws.room}));
      pushRooms();
      return;
    }
    if(m.t==='leave'){ leaveRoom(ws); return; }
    if(m.t==='list'){ ws.send(JSON.stringify({t:'rooms',rooms:roomList()})); return; }
    const r = ws.room && rooms.get(ws.room);
    if(r) relay(r, ws, raw.toString());
  });
  ws.on('close',()=>leaveRoom(ws));
});

server.listen(PORT,()=>console.log('LR4 apocalypse server dancing on http://localhost:'+PORT));
