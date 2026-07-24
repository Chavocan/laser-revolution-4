'use strict';
// ============================================================
//  LASER REVOLUTION 4: APOCALYPSE DANCE PARTY — v0.5
//  Parkour laser-tag for 1-4 players. Lasers bounce off mirrors
//  and get STRONGER with every bounce (and can hit YOU).
//  4 Face-Off stages with hazards. Loot boxes respawn Mario-Kart
//  style. Player mirrors shatter after 2 bounces; you keep a cap
//  of 3 out at once (loot raises it to 6).
// ============================================================

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0;
function resize(){ VW = canvas.width = window.innerWidth; VH = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

// ---------- constants ----------
const W = 3600, H = 1500;
const GRAV = 1900, BPM = 128;
const MIRROR_HP = 120;        // player mirrors absorb this much laser damage before shattering
const MIRROR_BASE = 3, MIRROR_CAP = 6;

// ---------- character classes ----------
const CLASSES = [
  {id:'bouncer',name:'BOUNCER',    gun:0, hp:100, spd:1.0,  w:26, h:46, dashCd:0.45, start:'mirror', desc:'all-rounder'},
  {id:'raver',  name:'RAVER',      gun:1, hp:75,  spd:1.18, w:22, h:40, dashCd:0.36, start:'blink',  desc:'tiny · fast · fragile'},
  {id:'titan',  name:'TITAN',      gun:2, hp:150, spd:0.8,  w:34, h:56, dashCd:0.58, start:'suit',   desc:'huge · slow · tanky'},
  {id:'prism',  name:'PRISMANCER', gun:3, hp:85,  spd:1.02, w:24, h:48, dashCd:0.45, start:'over',   desc:'glass cannon · bounce mage'},
];
const COLORS = ['#00ffd9','#ff9d2e','#7dff5e','#ff4dd2','#ffe14d','#6db6ff','#ff4d5e','#f0f4ff'];
let myClass = Math.max(0, Math.min(CLASSES.length-1, +(localStorage.getItem('lr4_class')||0)||0));
let myColor = Math.max(0, Math.min(COLORS.length-1, +(localStorage.getItem('lr4_color')||0)||0));
function myCol(){ return COLORS[myColor]; }
let lobbyPicks = {};
let firstLoot = true;          // first loot box each match pays out your class signature item

// ---------- volume settings ----------
const vol = {master:0.5, music:1, sfx:1};
try{ Object.assign(vol, JSON.parse(localStorage.getItem('lr4_vol')||'{}')); }catch(e){}
function saveVol(){ try{ localStorage.setItem('lr4_vol', JSON.stringify(vol)); }catch(e){} }
function applyVolumes(){
  if(!audio) return;
  audio.master.gain.value = muted? 0 : vol.master;
  audio.musicBus.gain.value = vol.music;
  audio.sfx.gain.value = 0.55*vol.sfx;
}
let volDrag = null, menuSliders = [];
let codeInput = '', browsePollT = 0;
let escT = 0; // double-ESC quit confirmation window
let rmbGhost = false; // hold-RMB quick mirror placement
let hurtVigT = 0; // red screen vignette after taking a hit

// ---------- utils ----------
const clamp = (v,a,b)=>v<a?a:(v>b?b:v);
const lerp = (a,b,t)=>a+(b-a)*t;
const rnd = (a=1,b)=> b===undefined ? Math.random()*a : a+Math.random()*(b-a);
const TAU = Math.PI*2;
function sr(n){ const v = Math.sin(n*127.1+13.7)*43758.5453; return v-Math.floor(v); }

function rayRect(ox,oy,dx,dy,r){
  const idx = 1/(dx||1e-9), idy = 1/(dy||1e-9);
  const tx1=(r.x-ox)*idx, tx2=(r.x+r.w-ox)*idx;
  const ty1=(r.y-oy)*idy, ty2=(r.y+r.h-oy)*idy;
  const tminX=Math.min(tx1,tx2), tminY=Math.min(ty1,ty2);
  const tmin=Math.max(tminX,tminY);
  const tmax=Math.min(Math.max(tx1,tx2),Math.max(ty1,ty2));
  if(tmax<tmin || tmax<0 || tmin<0) return null;
  let nx=0,ny=0;
  if(tminX>tminY) nx = dx>0?-1:1; else ny = dy>0?-1:1;
  return {t:tmin,nx,ny};
}
function raySeg(ox,oy,dx,dy,x1,y1,x2,y2){
  const sx=x2-x1, sy=y2-y1;
  const denom = dx*sy - dy*sx;
  if(Math.abs(denom)<1e-9) return null;
  const qx=x1-ox, qy=y1-oy;
  const t = (qx*sy - qy*sx)/denom;
  const u = (qx*dy - qy*dx)/denom;
  if(t<=0.001 || u<0 || u>1) return null;
  let nx=-sy, ny=sx; const l=Math.hypot(nx,ny); nx/=l; ny/=l;
  if(nx*dx+ny*dy>0){ nx=-nx; ny=-ny; }
  return {t,nx,ny};
}
function rayCircle(ox,oy,dx,dy,cx,cy,r){
  const mx=ox-cx,my=oy-cy;
  const b=mx*dx+my*dy, c=mx*mx+my*my-r*r;
  if(c>0&&b>0) return null;
  const disc=b*b-c; if(disc<0) return null;
  let t=-b-Math.sqrt(disc); if(t<0) t=0;
  return {t,nx:0,ny:0};
}
function ptInRect(x,y,r){ return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h; }
function rectsOverlap(a,b){ return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y; }

// ---------- enemies ----------
function makeBot(px,l,r,fy){ return {type:'bot',x:px,y:fy,w:34,h:44,hp:40,maxHp:40,dir:1,patrolL:l,patrolR:r,shootT:rnd(1,3),dead:false,respawnT:0,sx:px,sy:fy,seed:rnd(10),tx:px}; }
function makePrism(px,py,minB,hp){ return {type:'prism',x:px,y:py,r:19,hp:hp,maxHp:hp,minB:minB,dead:false,respawnT:0,sx:px,sy:py,spin:rnd(TAU),seed:rnd(10),tx:px}; }

// ---------- stages ----------
const BORDERS = [
  {x:-120,y:-300,w:120,h:H+600}, {x:W,y:-300,w:120,h:H+600}, {x:-120,y:-160,w:W+240,h:160},
];
const STAGES = [
{name:'APOCALYPSE BLOCK', build(){ return {
  solids:[
    {x:0,y:1380,w:W,h:140, floor:true},
    {x:330,y:980,w:44,h:400},
    {x:540,y:1240,w:150,h:14, oneWay:true},
    {x:780,y:1120,w:150,h:14, oneWay:true},
    {x:1020,y:1000,w:150,h:14, oneWay:true},
    {x:1200,y:900,w:430,h:32, drop:true},
    {x:1650,y:640,w:400,h:30, drop:true},
    {x:2080,y:1060,w:660,h:50},
    {x:2600,y:1200,w:36,h:180},
    {x:3060,y:720,w:44,h:520},
    {x:3280,y:720,w:44,h:660},
    {x:3040,y:690,w:330,h:30},
  ],
  mirrors:[
    {x:2690,y:1155,angle:45, len:90 },
    {x:1850,y:520, angle:25, len:150},
    {x:352, y:928, angle:-35,len:130},
    {x:1350,y:320, angle:0,  len:320},
    {x:3520,y:1050,angle:90, len:260},
  ],
  lootSpots:[{x:700,y:1330},{x:1090,y:950},{x:1600,y:855},{x:1850,y:590},{x:2350,y:1330},{x:2688,y:1235},{x:3200,y:635},{x:3450,y:1330}],
  enemies:[
    makeBot(700, 600, 920, 1380), makeBot(1400,1230,1600, 900), makeBot(1800,1680,2020, 640),
    makeBot(2350,2200,2560,1380), makeBot(3200,3070,3340, 690),
    makePrism(2690,1300,1,70), makePrism(3200,620,1,70), makePrism(1420,1010,2,90),
  ],
  hazards:[],
  spawns:[{x:140,y:1334},{x:3400,y:1334},{x:1840,y:594},{x:2900,y:1334}],
};}},
{name:'MIRROR TEMPLE', build(){ return {
  solids:[
    {x:0,y:1380,w:W,h:140, floor:true},
    {x:1700,y:700,w:200,h:680},
    {x:600,y:1050,w:300,h:30, drop:true},{x:2700,y:1050,w:300,h:30, drop:true},
    {x:1100,y:800,w:240,h:30, drop:true},{x:2260,y:800,w:240,h:30, drop:true},
    {x:1730,y:560,w:140,h:14, oneWay:true},
  ],
  mirrors:[
    {x:1640,y:940,angle:-45,len:110},{x:1960,y:940,angle:45,len:110},
    {x:200,y:1150,angle:90,len:300},{x:3400,y:1150,angle:90,len:300},
    {x:1800,y:250,angle:0,len:400},
    {x:900,y:600,angle:20,len:140},{x:2700,y:600,angle:-20,len:140},
  ],
  lootSpots:[{x:300,y:1330},{x:3300,y:1330},{x:750,y:1000},{x:2850,y:1000},{x:1800,y:510},{x:1220,y:750},{x:2380,y:750}],
  enemies:[
    makeBot(750,620,880,1050), makeBot(2850,2720,2980,1050),
    makePrism(1800,640,2,90),
  ],
  hazards:[
    {type:'zone',x:1150,y:1340,w:180,h:40,dmg:25},
    {type:'zone',x:2270,y:1340,w:180,h:40,dmg:25},
  ],
  spawns:[{x:200,y:1334},{x:3350,y:1334},{x:700,y:1004},{x:2850,y:1004}],
};}},
{name:'NEON GAUNTLET', build(){ return {
  solids:[
    {x:0,y:1380,w:W,h:140, floor:true},
    {x:400,y:1080,w:1200,h:30, drop:true},{x:2000,y:1080,w:1200,h:30, drop:true},
    {x:900,y:780,w:1800,h:30, drop:true},
    {x:700,y:930,w:150,h:14,oneWay:true},{x:2750,y:930,w:150,h:14,oneWay:true},
    {x:150,y:560,w:90,h:14,oneWay:true},{x:330,y:440,w:90,h:14,oneWay:true},{x:60,y:330,w:240,h:20},
  ],
  mirrors:[
    {x:1800,y:600,angle:0,len:300},
    {x:350,y:1000,angle:45,len:110},{x:3250,y:1000,angle:-45,len:110},
    {x:3550,y:900,angle:90,len:220},
  ],
  lootSpots:[{x:180,y:290},{x:1800,y:740},{x:500,y:1040},{x:3100,y:1040},{x:1000,y:1330},{x:2600,y:1330},{x:3450,y:1330}],
  enemies:[
    makeBot(900,450,1550,1080), makeBot(2700,2050,3150,1080),
    makePrism(3350,700,1,70),
  ],
  hazards:[
    {type:'sweep',x0:200,x1:3400,y:820,h:560,w:26,dmg:22,speed:0.06},
  ],
  spawns:[{x:150,y:1334},{x:3400,y:1334},{x:500,y:1034},{x:3100,y:1034}],
};}},
{name:'SKY SCAFFOLD', build(){ return {
  solids:[
    {x:200,y:1200,w:300,h:30},{x:3100,y:1200,w:300,h:30},
    {x:800,y:1050,w:220,h:26, drop:true},{x:1350,y:900,w:220,h:26, drop:true},{x:1900,y:1000,w:220,h:26, drop:true},{x:2450,y:880,w:220,h:26, drop:true},
    {x:1200,y:600,w:180,h:14,oneWay:true},{x:1700,y:500,w:180,h:14,oneWay:true},{x:2200,y:600,w:180,h:14,oneWay:true},
    {x:1720,y:340,w:160,h:20, drop:true},
    {x:540,y:720,w:90,h:16, drop:true},{x:2980,y:700,w:90,h:16, drop:true},
  ],
  mirrors:[
    {x:1100,y:1250,angle:0,len:200},{x:2600,y:1250,angle:0,len:200},
    {x:450,y:800,angle:90,len:240},{x:3150,y:800,angle:90,len:240},
    {x:1800,y:180,angle:0,len:300},
  ],
  lootSpots:[{x:585,y:690},{x:3025,y:670},{x:1460,y:860},{x:2560,y:840},{x:1800,y:300},{x:350,y:1170},{x:3250,y:1170}],
  enemies:[
    makePrism(1800,280,2,90), makePrism(2000,760,1,70),
  ],
  hazards:[
    {type:'zone',x:0,y:1420,w:3600,h:120,dmg:999},
  ],
  spawns:[{x:280,y:1154},{x:3180,y:1154},{x:880,y:1004},{x:2520,y:834}],
};}},
];
// hype speakers: shootable props that fire a beat-synced stinger
const STAGE_PROPS = [
  [{x:1700,y:480,kind:'yeah'},{x:300,y:790,kind:'airhorn'},{x:2410,y:990,kind:'scratch'}],
  [{x:1800,y:420,kind:'yeah'},{x:450,y:880,kind:'airhorn'},{x:3150,y:880,kind:'scratch'}],
  [{x:1800,y:520,kind:'yeah'},{x:120,y:230,kind:'airhorn'},{x:3480,y:760,kind:'scratch'}],
  [{x:1800,y:110,kind:'yeah'},{x:460,y:660,kind:'airhorn'},{x:3140,y:660,kind:'wow'}],
];
let solids=[], fixedMirrors=[], enemies=[], hazards=[], spawns=[], loot=[], props=[];
let stageIdx=0;
function loadStageData(d){
  solids=BORDERS.concat(d.solids);
  fixedMirrors=d.mirrors||[];
  enemies=d.enemies||[];
  hazards=d.hazards||[];
  spawns=d.spawns||[{x:200,y:1334}];
  loot=(d.lootSpots||[]).map(s=>({x:s.x,y:s.y,active:true,respawnT:0}));
  props=[];
}
function loadStage(i){
  stageIdx=clamp(i|0,0,STAGES.length-1);
  loadStageData(STAGES[stageIdx].build());
  props=(STAGE_PROPS[stageIdx]||[]).map(p=>Object.assign({r:18,cdT:0},p));
}
loadStage(0);

// ---------- SOLO GAUNTLET: missions with goals, puzzles, and bullet hell ----------
const MISSIONS=[
 {id:'angles', name:'ANGLE SCHOOL', desc:'puzzle · warm up those bounces', goal:'Shatter every prism', type:'clear',
  build(){ return {
    solids:[
      {x:0,y:1380,w:W,h:140,floor:true},
      {x:1200,y:1080,w:360,h:30},
      {x:1750,y:1180,w:40,h:200},
      {x:2400,y:900,w:40,h:480},
    ],
    mirrors:[{x:950,y:1120,angle:45,len:110},{x:2200,y:1000,angle:-35,len:120}],
    lootSpots:[],
    enemies:[ makePrism(1380,1160,1,40), makePrism(1900,1300,2,40), makePrism(2600,1300,2,40) ],
    hazards:[], spawns:[{x:200,y:1334}],
  };}},
 {id:'box', name:'THE UNSHOOTABLE BOX', desc:'puzzle · thread the needle', goal:'Shatter the boxed prisms', type:'clear',
  build(){ return {
    solids:[
      {x:0,y:1380,w:W,h:140,floor:true},
      {x:1600,y:1000,w:400,h:36},
      {x:1600,y:1036,w:36,h:344},
      {x:1964,y:1156,w:36,h:224},
      {x:2600,y:1100,w:300,h:24, drop:true},
    ],
    mirrors:[{x:2250,y:1090,angle:90,len:150}],
    lootSpots:[{x:400,y:1330}],
    enemies:[ makePrism(1800,1300,3,60), makePrism(2750,1230,2,50) ],
    hazards:[], spawns:[{x:200,y:1334}],
  };}},
 {id:'rush', name:'RUSH HOUR', desc:'timed · no respawns, no mercy', goal:'Clear every target in 60s', type:'timed', timeLimit:60,
  build(){ return {
    solids:[
      {x:0,y:1380,w:W,h:140,floor:true},
      {x:700,y:1100,w:300,h:26, drop:true},
      {x:1500,y:950,w:300,h:26, drop:true},
      {x:2300,y:1100,w:300,h:26, drop:true},
      {x:3000,y:900,w:44,h:480},
    ],
    mirrors:[{x:1350,y:700,angle:0,len:260},{x:3200,y:1000,angle:90,len:200}],
    lootSpots:[{x:1650,y:900},{x:3300,y:1330}],
    enemies:[
      makeBot(500,380,700,1380), makeBot(850,720,970,1100), makeBot(1650,1520,1770,950),
      makeBot(2450,2320,2570,1100), makeBot(2800,2650,2950,1380),
      makePrism(3300,1150,1,50), makePrism(1200,1300,2,60),
    ],
    hazards:[], spawns:[{x:150,y:1334}],
  };}},
 {id:'storm', name:'ORB STORM', desc:'bullet hell · dance or die', goal:'Survive 45 seconds', type:'survive', surviveTime:45,
  build(){ return {
    solids:[
      {x:0,y:1380,w:W,h:140,floor:true},
      {x:1600,y:1000,w:400,h:26, drop:true},
      {x:700,y:1150,w:220,h:24, drop:true},
      {x:2700,y:1150,w:220,h:24, drop:true},
    ],
    mirrors:[],
    lootSpots:[{x:1800,y:960}],
    enemies:[],
    hazards:[], spawns:[{x:1787,y:1334}],
  };}},
 {id:'boss', name:'THE MIRRORBALL', desc:'boss · it stares back', goal:'Shatter the giant Mirrorball', type:'boss',
  build(){ return {
    solids:[
      {x:0,y:1380,w:W,h:140,floor:true},
      {x:900,y:1000,w:240,h:24, drop:true},
      {x:2660,y:1000,w:240,h:24, drop:true},
      {x:1700,y:760,w:200,h:22, drop:true},
    ],
    mirrors:[{x:500,y:900,angle:90,len:220},{x:3100,y:900,angle:90,len:220}],
    lootSpots:[{x:1020,y:960},{x:2780,y:960}],
    enemies:[ Object.assign(makePrism(1800,700,1,600),{r:58,boss:true}) ],
    hazards:[], spawns:[{x:200,y:1334}],
  };}},
];
let mission=null, missionIdx=-1, missionOver=0, pendingStage=null; // missionOver: 0 playing, 1 win, 2 fail
let doneMissions=new Set();
try{ doneMissions=new Set(JSON.parse(localStorage.getItem('lr4_missions')||'[]')); }catch(e){}
function saveMissions(){ try{ localStorage.setItem('lr4_missions', JSON.stringify([...doneMissions])); }catch(e){} }
function startMission(i){
  missionIdx=clamp(i|0,0,MISSIONS.length-1);
  const def=MISSIONS[missionIdx];
  mission={def, t:0, spawnT:0, spiralA:0, sideT:2.5, side:1, ringT:3, volleyT:4, sp1:false, sp2:false};
  missionOver=0;
  MP.on=false; MP.mode='solo'; MP.isHost=true; MP.you=0;
  resetUpgrades();
  pendingStage=def.build();
  initWorld('mission',0);
  state='play'; initAudio();
  announce(def.name);
}
function missionWin(){
  if(missionOver) return;
  missionOver=1;
  doneMissions.add(mission.def.id); saveMissions();
  announce('STAGE CLEAR!');
  confettiBurst(P.x+P.w/2,P.y-30,40);
  sting('yeah'); playOverlay('crown',5);
}
function missionFail(reason){
  if(missionOver) return;
  missionOver=2;
  announce(reason||'WRECKED');
  playOverlay('dead',3);
}
function missionTick(dt){
  const m=mission; if(!m||missionOver) return;
  m.t+=dt;
  const def=m.def;
  if(def.id==='storm'){
    // twin spiral from the ceiling + aimed fans from alternating walls
    m.spiralA+=dt*2.0; m.spawnT-=dt;
    if(m.spawnT<=0){
      m.spawnT=0.22;
      for(const off of [0,Math.PI]){
        const a=m.spiralA+off;
        orbs.push({x:1800,y:300,vx:Math.cos(a)*250,vy:Math.abs(Math.sin(a))*250+60,life:8});
      }
    }
    m.sideT-=dt;
    if(m.sideT<=0){
      m.sideT=3; m.side*=-1;
      const sx=m.side>0? 80:W-80, sy=1050;
      const an=Math.atan2((P.y+P.h/2)-sy,(P.x+P.w/2)-sx);
      for(const k of [-0.18,0,0.18]) orbs.push({x:sx,y:sy,vx:Math.cos(an+k)*300,vy:Math.sin(an+k)*300,life:8});
      tone('sine',700,300,0.2,0.2);
    }
    if(m.t>=def.surviveTime) missionWin();
  } else if(def.id==='boss'){
    const b=enemies[0];
    if(!b || b.dead){ missionWin(); return; }
    b.x=1800+Math.sin(m.t*0.45)*620;
    b.y=700+Math.sin(m.t*0.9)*180;
    m.ringT-=dt;
    if(m.ringT<=0){
      m.ringT=4;
      for(let a2=0;a2<12;a2++){ const an=a2/12*TAU+m.t;
        orbs.push({x:b.x,y:b.y,vx:Math.cos(an)*220,vy:Math.sin(an)*220,life:9}); }
      tone('sawtooth',200,90,0.3,0.3);
    }
    m.volleyT-=dt;
    if(m.volleyT<=0){
      m.volleyT=2.6;
      const an=Math.atan2(P.y+P.h/2-b.y, P.x+P.w/2-b.x);
      for(const k of [-0.22,0,0.22]) orbs.push({x:b.x,y:b.y,vx:Math.cos(an+k)*310,vy:Math.sin(an+k)*310,life:8});
    }
    if(!m.sp1 && b.hp<400){ m.sp1=true; enemies.push(makeBot(1200,1000,1500,1380)); announce('MINIONS!'); }
    if(!m.sp2 && b.hp<200){ m.sp2=true; enemies.push(makeBot(2400,2100,2600,1380)); }
  }
  if(def.type==='clear' || def.type==='timed'){
    if(enemies.length && enemies.every(e=>e.dead)) missionWin();
    if(def.type==='timed' && m.t>def.timeLimit) missionFail('TIME UP!');
  }
}

let playerMirrors = [];
let mirrorIdSeq = 0;
function allMirrors(){ return fixedMirrors.concat(playerMirrors); }
function segPts(m){
  const a=m.angle*Math.PI/180, c=Math.cos(a), s=Math.sin(a), h=m.len/2;
  return {x1:m.x-c*h, y1:m.y-s*h, x2:m.x+c*h, y2:m.y+s*h};
}

// ---------- loot / powerups ----------
const POWERUPS = [
  {id:'heal',  name:'BASS DROP HEAL +40',                 short:'HEAL',      color:'#7dff5e', w:3},
  {id:'mirror',name:'MIRROR CAP +1 (max 6)',              short:'+1 MIRROR CAP',color:'#7dff5e',w:2},
  {id:'fever', name:'FEVER FIRE ×1.8 (8s)',               short:'FEVER',     color:'#ff3df0', w:3, dur:8},
  {id:'amp',   name:'AMP UP — DMG ×1.5 (8s)',             short:'AMP',       color:'#ffe14d', w:3, dur:8},
  {id:'over',  name:'PRISM OVERDRIVE +3 BOUNCES (10s)',   short:'OVERDRIVE', color:'#b44bff', w:3, dur:10},
  {id:'star',  name:'DISCO STAR!! (6s)',                  short:'STAR',      color:'#ffffff', w:2, dur:6},
  {id:'hook',  name:'NINJA HOOK — Q TO GRAPPLE (12s)',    short:'HOOK',      color:'#00ffd9', w:3, dur:12},
  {id:'jet',   name:'JETPACK — HOLD JUMP (8s)',           short:'JETPACK',   color:'#ff9d2e', w:3, dur:8},
  {id:'ball',  name:'DISCO BALL — F TO THROW!',           short:'DISCO BALL',color:'#ff9df5', w:2},
  {id:'moon',  name:'MOON BOOTS (10s)',                   short:'MOON',      color:'#9ddcff', w:2, dur:10},
  {id:'blink', name:'BLINK — C TO TELEPORT (10s)',        short:'BLINK',     color:'#7de8ff', w:2, dur:10},
  {id:'suit',  name:'MIRROR SUIT — LASERS BOUNCE OFF YOU (8s)',short:'MIRROR SUIT',color:'#e8f7ff',w:2,dur:8},
  {id:'beat',  name:'BEAT DROP!!',                        short:'BEAT DROP', color:'#ff4d6d', w:2},
  {id:'skate', name:'SPEED SKATES (10s)',                 short:'SKATES',    color:'#ffe14d', w:3, dur:10},
  {id:'decoy', name:'DECOY DANCER (12s)',                 short:'DECOY',     color:'#ff4dd2', w:2},
  {id:'storm', name:'DISCO MONSOON — BALLS FROM THE SKY!!',short:'MONSOON',  color:'#ff9df5', w:2},
  {id:'maze',  name:'INSTANT MIRROR MAZE',                short:'MIRROR MAZE',color:'#c9ffb8',w:2},
  {id:'tiny',  name:'FUN-SIZE — 60% DANCER (10s)',        short:'FUN-SIZE',  color:'#9ffcef', w:2, dur:10},
  {id:'rubber',name:'RUBBER RAVE — WALLS BOUNCE LASERS (8s)',short:'RUBBER RAVE',color:'#ffb3e6',w:2, dur:8},
  {id:'ghost', name:'SMOKE MACHINE — NEARLY INVISIBLE (8s)',short:'SMOKE',   color:'#cfd8ea', w:2, dur:8},
  {id:'swap',  name:'DJ SWITCHEROO!',                     short:'SWITCHEROO',color:'#ffe14d', w:2},
  {id:'magnet',name:'LOOT VACUUM — BOXES COME TO YOU (10s)',short:'VACUUM',  color:'#7de8ff', w:2, dur:10},
  {id:'bigshot',name:'BIG SHOT ENERGY — CHUNKY LASERS (8s)',short:'BIG SHOT',color:'#ff9d2e', w:2, dur:8},
  {id:'triple',name:'TRIPLE THREAT — 3-WAY SHOTS (8s)',    short:'TRIPLE',   color:'#b44bff', w:2, dur:8},
  {id:'vamp',  name:'VAMPIRE FANGS — HITS HEAL YOU (10s)', short:'VAMP',     color:'#ff4d6d', w:2, dur:10},
  {id:'pogo',  name:'POGO PANTS — AUTO-BOUNCE (10s)',      short:'POGO',     color:'#7dff5e', w:2, dur:10},
  {id:'mega',  name:'YEET MODE — 2.5x KNOCKBACK (8s)',     short:'YEET',     color:'#ffe14d', w:2, dur:8},
  {id:'wind',  name:'SECOND WIND — CHEAT DEATH ONCE (45s)',short:'2ND WIND', color:'#f0f4ff', w:2, dur:45},
  {id:'orbit', name:'DISCO BUDDY — ORBITING TURRET (12s)', short:'BUDDY',    color:'#ff9df5', w:2, dur:12},
];
// item toggles: host controls them for a room (synced), you control them for solo
let itemsOn={}, itemsReturn='menu';
try{ for(const id of JSON.parse(localStorage.getItem('lr4_items_off')||'[]')) itemsOn[id]=false; }catch(e){}
function itemEnabled(id){ return itemsOn[id]!==false; }
function itemsOffList(){ return POWERUPS.filter(p=>!itemEnabled(p.id)).map(p=>p.id); }
function saveItems(broadcast){
  try{ localStorage.setItem('lr4_items_off', JSON.stringify(itemsOffList())); }catch(e){}
  if(broadcast!==false && MP.isHost && (MP.on || state==='lobby' || state==='items'))
    net.raw({t:'items', off:itemsOffList()});
}
function rollPowerup(){
  const pool=[];
  for(let i=0;i<POWERUPS.length;i++) if(itemEnabled(POWERUPS[i].id)) pool.push(i);
  if(!pool.length) return 0;
  let tot=0; for(const i of pool) tot+=POWERUPS[i].w;
  let r=Math.random()*tot;
  for(const i of pool){ r-=POWERUPS[i].w; if(r<=0) return i; }
  return pool[0];
}
const buffs = {fever:0, amp:0, over:0, star:0, hook:0, jet:0, moon:0, blink:0, suit:0, skate:0, tiny:0, rubber:0, ghost:0,
  magnet:0, bigshot:0, triple:0, vamp:0, pogo:0, mega:0, wind:0, orbit:0};

// ---------- round-end weapon upgrades (persist across rematches in the same room) ----------
const KILL_TARGET = 10;
const UPGRADES = [
  {k:'dmg',   label:'+15% DAMAGE'},
  {k:'rof',   label:'+20% FIRE RATE'},
  {k:'bounce',label:'+1 MAX BOUNCE'},
  {k:'mag',   label:'+25% MAG SIZE'},
  {k:'range', label:'+20% RANGE'},
  {k:'reload',label:'-25% RELOAD TIME'},
];
const upg = {dmg:0, rof:0, bounce:0, mag:0, range:0, reload:0};
let lastReward = '';
function resetUpgrades(){ for(const k in upg) upg[k]=0; lastReward=''; }
function upgLine(){
  const parts=[];
  for(const u of UPGRADES) if(upg[u.k]>0) parts.push(u.k.toUpperCase()+'×'+upg[u.k]);
  return parts.join(' · ');
}
let matchEndT = 0, matchWinner = -1, killFreezeT = 0, streakN = 0, streakT = 0;
let orbitA = 0, orbitFT = 0;
let mirrorMax = MIRROR_BASE;
let heldItem = null;
const roul = {active:false, t:0, pick:0, tickT:0};
let balls = [], decoys = [];

// ---------- guns ----------
const GUNS = [
  {name:'GROOVE PISTOL',   desc:'reliable · 6 bounces · long range', auto:false, rof:3.5, dmg:12, spread:0,    range:1900, maxB:6,  bMult:1.5,  beamW:3,   color:'#00ffd9', pellets:1, sfx:'pew',  mag:12, rel:1.1},
  {name:'DISCO SHREDDER',  desc:'hold to spray · mid range',  auto:true,  rof:13,  dmg:4,  spread:0.13, range:1150, maxB:3,  bMult:1.6,  beamW:2,   color:'#ff3df0', pellets:1, sfx:'zap',  mag:40, rel:1.6},
  {name:'MIRRORBALL SCATTER',desc:'6-beam fan · close range', auto:false, rof:1.5, dmg:5,  spread:0.45, range:620,  maxB:4,  bMult:1.7,  beamW:2.5, color:'#ffe14d', pellets:6, sfx:'boom', mag:6,  rel:1.8},
  {name:'RAVE LANCE',      desc:'HOLD + release · pierces · cross-map', auto:false, charge:true, rof:0.9, dmg:46, spread:0, range:4200, maxB:10, bMult:1.35, beamW:5, color:'#b44bff', pellets:1, pierce:true, sfx:'lance', mag:3, rel:2.2},
];
const BALLGUN = {name:'DISCO BALL', dmg:8, spread:0, range:680, maxB:2, bMult:1.6, beamW:2.2, color:'#ff9df5', pellets:1, sfx:'zap'};
function effGun(g){
  const e=Object.assign({},g);
  if(buffs.over>0) e.maxB+=3;
  if(buffs.fever>0) e.rof*=1.8;
  if(buffs.triple>0){ e.pellets+=2; e.spread=Math.max(e.spread,0.12); }
  if(buffs.bigshot>0){ e.dmg*=1.5; e.beamW*=2.4; e.rof*=0.6; }
  if(upg.dmg) e.dmg*=1+0.15*upg.dmg;
  if(upg.rof) e.rof*=1+0.2*upg.rof;
  if(upg.bounce) e.maxB+=upg.bounce;
  if(upg.mag) e.mag=Math.round(e.mag*(1+0.25*upg.mag));
  if(upg.range) e.range*=1+0.2*upg.range;
  if(upg.reload) e.rel*=Math.pow(0.75,upg.reload);
  return e;
}

// ---------- players ----------
const P = {
  x:140, y:1334, w:26, h:46, vx:0, vy:0,
  grounded:false, wallL:false, wallR:false, onOneWay:false,
  coyote:0, jumpBuf:0, airJumps:1, dropT:0,
  dashT:0, dashCd:0, dashVX:0, dashVY:0, canAirDash:true, dashGround:false, landLagT:0,
  hp:100, maxHp:100, invulnT:0, sinceHurt:99, deadT:0, spikedT:0, cls:0, hurtT:0,
  contactCd:0, hazardCd:0, mCharges:3, mRegenT:0,
  gun:0, fireCd:0, chargeT:-1, gunFlash:0, blinkCd:0, ammo:12, reloadT:0,
  facing:1, hook:null, spawn:{x:140,y:1334},
};
const PCOLS = ['#00ffd9','#ff9d2e','#7dff5e','#ff4dd2'];
function newPeer(){ return {on:false,x:0,y:0,tx:0,ty:0,vx:0,facing:1,aim:0,gun:0,hp:100,star:0,suit:0,hook:0,gunFlash:0,cls:0,col:null,hurtT:0}; }
const peers = [newPeer(),newPeer(),newPeer(),newPeer()];
function peerCls(i){ return CLASSES[peers[i].cls||0]; }
function peerColor(i){ return peers[i].col!=null? COLORS[peers[i].col] : PCOLS[i]; }
function peerMaxHp(i){ return peerCls(i).hp; }
function peerCenter(i){ const C=peerCls(i); return {x:peers[i].x+C.w/2, y:peers[i].y+C.h/2}; }
function peerRect(i){
  const C=peerCls(i), k=peers[i].tn? 0.62:1; // FUN-SIZE peers are genuinely harder to hit
  return {x:peers[i].x, y:peers[i].y, w:C.w*k, h:C.h*k};
}
function selfRect(){ return {x:P.x,y:P.y,w:P.w,h:P.h}; }

// ---------- game state ----------
let state = 'menu';            // menu | lobby | play
let paused = false, muted = false;
let cam = {x:0,y:H-900};
let shake = 0;
let score = 0, kills = 0, bestBounce = 0;
let placing = false, ghostAngle = 45;
let sightOn = true;
let helpT = 0, helpPin = false;
let beams = [], particles = [], popups = [], orbs = [];
let announceTxt = '', announceT = 0;
let beatT = 0, matchT = 0, hypeT = 0;
let demoT = 0;
let menuBtns = [], menuNotice = '', menuStageSel = 0; // 0 = RANDOM, 1..4 = stage idx+1
let roomListData = [];
let lobbyInfo = null;
let lastAttacker = -1;
let psT = 0, esnapT = 0;
const keys = {};
const mouse = {x:VW/2,y:VH/2,down:false,pressed:false};
const MP = {on:false, mode:'solo', isHost:true, you:0, code:'', frags:[0,0,0,0]};

// ---------- networking ----------
const net = {
  ws:null, ready:false,
  send(o){ if(this.ws && this.ws.readyState===1 && MP.on) this.ws.send(JSON.stringify(o)); },
  raw(o){ if(this.ws && this.ws.readyState===1) this.ws.send(JSON.stringify(o)); },
};
function connectWS(){
  // Remote room server for statically-hosted clients (e.g. itch.io):
  // window.LR4_SERVER is baked in by build-itch.js; ?server=wss://host works for testing.
  const override=window.LR4_SERVER || new URLSearchParams(location.search).get('server');
  let wsUrl;
  if(override) wsUrl = /^wss?:\/\//.test(override)? override : 'wss://'+override;
  else if(location.protocol==='file:') return;
  else wsUrl = (location.protocol==='https:'?'wss://':'ws://')+location.host;
  let w;
  try{ w=new WebSocket(wsUrl); }
  catch(e){ setTimeout(connectWS,3000); return; }
  w.onopen = ()=>{ net.ready=true; };
  w.onmessage = e=>{ let m; try{ m=JSON.parse(e.data); }catch(err){ return; } onNet(m); };
  w.onclose = ()=>{
    net.ready=false; net.ws=null;
    if(MP.on || state==='lobby') leaveToMenu('connection lost');
    setTimeout(connectWS,3000);
  };
  net.ws=w;
}
connectWS();
function leaveToMenu(msg){
  net.raw({t:'leave'});
  MP.on=false; MP.mode='solo'; MP.isHost=true; MP.you=0; MP.code=''; MP.frags=[0,0,0,0];
  for(const p of peers) p.on=false;
  lobbyInfo=null;
  state='menu'; menuNotice=msg||'';
}
function activeSlots(){
  const l=[];
  for(let i=0;i<4;i++) if(i===MP.you || peers[i].on) l.push(i);
  return l;
}
function fragLine(){
  return activeSlots().map(i=> (i===MP.you?'YOU ':'P'+(i+1)+' ')+MP.frags[i]).join('  ·  ');
}
function checkWin(){
  if(matchEndT>0) return;
  for(let i=0;i<4;i++) if(MP.frags[i]>=KILL_TARGET){
    matchWinner=i; matchEndT=6;
    announce(i===MP.you? '★ YOU TAKE THE CROWN ★':'☠ P'+(i+1)+' TAKES THE CROWN ☠');
    playOverlay('crown',7);
    sting(i===MP.you?'yeah':'airhorn');
    // everyone leaves the round with a weapon upgrade for the rematch
    const u=UPGRADES[Math.floor(Math.random()*UPGRADES.length)];
    upg[u.k]++;
    lastReward=u.label+(upg[u.k]>1? '  (now ×'+upg[u.k]+')':'');
    confettiBurst(P.x+P.w/2, P.y-30, 40);
    return;
  }
}
function applyDeath(who,by){
  if(matchEndT>0) return; // scores frozen during the podium party
  if(by==null || by<0 || by===who) MP.frags[who]--;
  else MP.frags[by]++;
  if(by===MP.you && who!==MP.you){
    announce('FRAG!  '+fragLine());
    const vp = who===MP.you? {x:P.x+P.w/2,y:P.y} : {x:peers[who].x+13,y:peers[who].y};
    cheerKill(vp.x, vp.y);
  }
  if(by!=null && by>=0 && by!==who) sting('airhorn',{fromNet:true}); // everyone already got 'died'
  checkWin();
}
function onNet(m){
  switch(m.t){
    case 'rooms': roomListData=m.rooms||[]; break;
    case 'lobby':
      lobbyInfo=m; MP.you=m.you; MP.code=m.code; MP.isHost=(m.you===0);
      state='lobby';
      lobbyPicks[MP.you]={cls:myClass,col:myColor};
      net.raw({t:'pick', who:MP.you, cls:myClass, col:myColor});
      if(MP.isHost) net.raw({t:'items', off:itemsOffList()}); // sync item toggles to (re)joiners
      break;
    case 'pick':
      lobbyPicks[m.who]={cls:m.cls||0, col:m.col};
      if(peers[m.who]){ peers[m.who].cls=m.cls||0; peers[m.who].col=m.col; }
      break;
    case 'start':
      MP.on=true; MP.mode=m.mode; MP.you=m.you; MP.isHost=(m.you===0); MP.code=m.code;
      initWorld(m.mode, m.stage); state='play';
      announce((m.mode==='vs'? 'FACE-OFF · ':'CO-OP · ')+STAGES[stageIdx].name);
      break;
    case 'peerLeft':
      if(state==='play'){
        if(m.idx===0 && MP.you!==0){ leaveToMenu('the host left'); break; }
        if(peers[m.idx]) peers[m.idx].on=false;
        announce('P'+(m.idx+1)+' LEFT THE PARTY');
      }
      break;
    case 'err': menuNotice=m.msg||'error'; if(state==='lobby') state='menu'; break;
    case 'ps': {
      const p=peers[m.who]; if(!p) break;
      if(!p.on){ p.x=m.x; p.y=m.y; }
      if(p.on && m.hp<p.hp) p.hurtT=0.3; // peer just took a hit — strobe them
      p.on=true; p.tx=m.x; p.ty=m.y; p.vx=m.vx||0;
      p.facing=m.f||1; p.aim=m.a||0; p.gun=m.g||0;
      p.hp=m.hp; p.star=m.s||0; p.suit=m.su||0; p.hook=m.hk||0; p.dsh=m.dsh||0; p.gh=m.gh||0; p.tn=m.tn||0;
      if(m.cls!=null) p.cls=m.cls;
      if(m.col!=null) p.col=m.col;
      break; }
    case 'fire': remoteShoot(m); break;
    case 'mplace': playerMirrors.push(m.m); sfxPlace(); break;
    case 'mpick': playerMirrors=playerMirrors.filter(x=>x.id!==m.id); break;
    case 'mbreak': breakMirrorById(m.id,false); break;
    case 'edmg': if(MP.isHost && enemies[m.i]) damageEnemy(enemies[m.i], m.d, m.b, m.hx, m.hy); break;
    case 'esnap': applyEsnap(m); break;
    case 'orb': orbs.push({x:m.x,y:m.y,vx:m.vx,vy:m.vy,life:5}); break;
    case 'ball': balls.push({x:m.x,y:m.y,vx:m.vx,vy:m.vy,age:0,sprayT:0,owner:m.who}); break;
    case 'decoy': decoys.push({x:m.x,y:m.y,who:m.who,t:12,seed:rnd(10),cls:m.cls||0,col:m.col}); break;
    case 'pvp':
      if(m.to!==MP.you) break;
      lastAttacker=m.who;
      if(buffs.star>0){ popup(P.x+P.w/2,P.y-14,'BLOCKED','#ffe14d',14); break; }
      damagePlayer(m.d, (m.kx!=null? {dx:m.kx, dy:m.ky||0, mul:m.kb||1} : 0), 'pvp', m.who);
      break;
    case 'died': applyDeath(m.who, m.by); break;
    case 'loot':
      if(loot[m.i]){ const b=loot[m.i]; b.active=false; if(MP.isHost) b.respawnT=8;
        sparks(b.x,b.y,'#ff9df5',10,180); popup(b.x,b.y-24,'P'+(m.who+1)+' GRABBED LOOT','#ff9df5',13); }
      break;
    case 'lootUp': if(loot[m.i]) loot[m.i].active=true; break;
    case 'items':
      if(MP.isHost) break; // only the host's list applies
      itemsOn={};
      for(const id of (m.off||[])) itemsOn[id]=false;
      break;
    case 'swap':
      if(m.to!==MP.you) break;
      { const oldX=Math.round(P.x), oldY=Math.round(P.y);
        sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
        safePlace(m.x, m.y);
        net.send({t:'swapAt', who:MP.you, to:m.who, x:oldX, y:oldY});
        sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
        popup(P.x+P.w/2,P.y-20,'SWITCHED!','#ffe14d',15); }
      break;
    case 'swapAt':
      if(m.to!==MP.you) break;
      sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
      safePlace(m.x, m.y);
      sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
      popup(P.x+P.w/2,P.y-20,'SWITCHED!','#ffe14d',15);
      break;
    case 'sting':
      if(m.pi!=null && props[m.pi]) props[m.pi].cdT=2.5;
      sting(m.n, {x:m.x, y:m.y, fromNet:true});
      break;
  }
}
function initWorld(mode, stage){
  if(mode==='mission' && pendingStage){ loadStageData(pendingStage); pendingStage=null; }
  else loadStage(mode==='vs'? (stage||0) : 0);
  if(mode!=='mission'){ mission=null; missionOver=0; }
  if(mode==='vs') enemies=[]; // FACE-OFF is pure PvP — no bots, no prisms, just dancers
  playerMirrors=[]; mirrorIdSeq=0; mirrorMax=MIRROR_BASE;
  orbs=[]; beams=[]; particles=[]; popups=[]; balls=[]; decoys=[];
  score=0; kills=0; bestBounce=0; MP.frags=[0,0,0,0]; lastAttacker=-1;
  for(const k in buffs) buffs[k]=0;
  heldItem=null; roul.active=false; firstLoot=true;
  const C=CLASSES[myClass];
  P.cls=myClass; P.w=C.w; P.h=C.h; P.maxHp=C.hp;
  const sp = spawns[MP.on? MP.you : 0] || spawns[0];
  P.spawn=sp; P.x=sp.x; P.y=sp.y-(C.h-46); P.vx=P.vy=0; P.hp=C.hp; P.deadT=0; P.invulnT=1;
  P.gun=C.gun; P.chargeT=-1; P.hook=null; P.airJumps=1; P.canAirDash=true; P.dashT=0; P.dashCd=0; P.blinkCd=0; P.spikedT=0;
  P.ammo=GUNS[C.gun].mag; P.reloadT=0; P.contactCd=0; P.hazardCd=0; P.landLagT=0; P.dashGround=false;
  P.mCharges=mirrorMax; P.mRegenT=0;
  for(const p of peers){ Object.assign(p, newPeer()); }
  placing=false; helpT = mode==='solo'? 12:8; helpPin=false;
  announceT=0; paused=false; matchT=0;
  matchEndT=0; matchWinner=-1; killFreezeT=0; streakN=0; streakT=0; orbitA=0; orbitFT=0;
  cam.x=clamp(P.x-VW/2,0,Math.max(0,W-VW)); cam.y=clamp(P.y-VH/2,0,Math.max(0,H-VH));
  psT=0; esnapT=0;
}
function startSolo(){
  MP.on=false; MP.mode='solo'; MP.isHost=true; MP.you=0;
  resetUpgrades();
  initWorld('solo',0); state='play'; initAudio();
}
function hostRoom(mode){
  if(!net.ready){ menuNotice='multiplayer server offline'; return; }
  initAudio(); resetUpgrades();
  const stage = mode==='vs'? (menuStageSel===0? Math.floor(Math.random()*STAGES.length) : menuStageSel-1) : 0;
  net.raw({t:'create', mode, stage});
}
function joinRoom(code){
  if(!net.ready){ menuNotice='multiplayer server offline'; return; }
  initAudio(); resetUpgrades(); net.raw({t:'join', code});
}

// ---------- input ----------
window.addEventListener('keydown',e=>{
  if(e.code==='Space') e.preventDefault();
  if(keys[e.code]) return;
  keys[e.code]=true;
  if(state!=='play'){
    if(state==='lobby' && e.code==='Escape') leaveToMenu('');
    if(state==='select' && e.code==='Escape') state='menu';
    if(state==='missions' && e.code==='Escape') state='menu';
    if(state==='items' && e.code==='Escape') state=itemsReturn;
    if(state==='browse'){
      if(e.code==='Escape'){ state='menu'; }
      else if(e.code==='Backspace'){ codeInput=codeInput.slice(0,-1); }
      else if(e.code==='Enter'){ if(codeInput.length>=4) joinRoom(codeInput); }
      else if(codeInput.length<4){
        const mk=e.code.match(/^Key([A-Z])$/), md=e.code.match(/^Digit(\d)$/);
        if(mk) codeInput+=mk[1]; else if(md) codeInput+=md[1];
      }
    }
    return;
  }
  if(e.code==='KeyP'){ if(!MP.on) paused=!paused; return; }
  if(e.code==='KeyM'){ muted=!muted; applyVolumes(); return; }
  if(e.code==='Minus'||e.code==='NumpadSubtract'){ vol.master=clamp(vol.master-0.05,0,1); applyVolumes(); saveVol(); popup(P.x+P.w/2,P.y-30,'VOL '+Math.round(vol.master*100)+'%','#cfe8ff',13); return; }
  if(e.code==='Equal'||e.code==='NumpadAdd'){ vol.master=clamp(vol.master+0.05,0,1); applyVolumes(); saveVol(); popup(P.x+P.w/2,P.y-30,'VOL '+Math.round(vol.master*100)+'%','#cfe8ff',13); return; }
  if(e.code==='KeyH'){ helpPin=!helpPin; helpT=0; return; }
  if(e.code==='KeyT'){ sightOn=!sightOn; sfxUI(sightOn?700:400); return; }
  if(e.code==='KeyN'){ const k=music.mainKey; if(k){ music.mainKey=null; setMainMusic(k); } return; } // skip track
  if(e.code==='Escape'){ // works in solo AND multiplayer: press twice to quit
    if(escT>0){ escT=0; leaveToMenu(''); }
    else escT=2.2;
    return;
  }
  if(paused) return;
  if(mission && missionOver){
    if(e.code==='Space'){
      if(missionOver===1){
        const nx=missionIdx+1;
        if(nx<MISSIONS.length) startMission(nx);
        else { mission=null; leaveToMenu(''); state='missions'; }
      } else startMission(missionIdx);
      return;
    }
    return; // other inputs frozen on the results screen (ESC handled above)
  }
  if(e.code==='Space') P.jumpBuf=0.12; // SPACE jumps; W is just "up" for dash aiming
  if(e.code==='ShiftLeft'||e.code==='ShiftRight') tryDash();
  if(e.code==='KeyS'&&P.onOneWay) P.dropT=0.22;
  if(e.code==='KeyE'){ placing=!placing; sfxUI(placing?760:420); }
  if(e.code==='KeyR'){ if(placing||rmbGhost) ghostAngle=(ghostAngle+15)%360; else startReload(); }
  if(e.code==='KeyX') pickupMirror();
  if(e.code==='KeyQ') tryHook();
  if(e.code==='KeyF') throwItem();
  if(e.code==='KeyC') tryBlink();
});
window.addEventListener('keyup',e=>{
  keys[e.code]=false;
  if(e.code==='Space' && P.vy<0 && buffs.jet<=0) P.vy*=0.45;
});
window.addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; mouse.down=false; });
canvas.addEventListener('mousemove',e=>{
  mouse.x=e.clientX; mouse.y=e.clientY;
  if(volDrag) updateSliderDrag();
});
function updateSliderDrag(){
  const s=menuSliders.find(s=>s.key===volDrag);
  if(!s) return;
  vol[s.key]=clamp((mouse.x-s.x)/s.w,0,1);
  applyVolumes();
}
canvas.addEventListener('mousedown',e=>{
  if(state==='menu'||state==='lobby'||state==='select'||state==='browse'||state==='missions'||state==='items'){
    if(e.button!==0) return;
    for(const s of menuSliders){
      if(mouse.x>=s.x-8&&mouse.x<=s.x+s.w+8&&mouse.y>=s.y-10&&mouse.y<=s.y+s.h+10){
        volDrag=s.key; initAudio(); updateSliderDrag(); return;
      }
    }
    menuClick();
    return;
  }
  if(e.button===2){
    // hold RMB: quick-place ghost, auto-angled perpendicular to your aim (bank-shot ready)
    if(state==='play' && !paused && !placing){
      rmbGhost=true;
      const deg=aimAngle()*180/Math.PI+90;
      ghostAngle=((Math.round(deg/15)*15)%360+360)%360;
      sfxUI(700);
    }
    return;
  }
  if(e.button!==0) return;
  mouse.down=true; mouse.pressed=true;
});
window.addEventListener('mouseup',e=>{
  if(e.button===2){
    if(rmbGhost){ rmbGhost=false; if(state==='play' && !paused) tryPlaceMirror(); }
    return;
  }
  if(e.button!==0) return;
  mouse.down=false;
  if(volDrag){ volDrag=null; saveVol(); }
  if(state==='play' && !paused && !placing && P.chargeT>=0){
    const g=effGun(GUNS[P.gun]);
    if(g.charge && P.ammo>0 && P.reloadT<=0){
      shoot(g, aimAngle(), 0.35+0.65*clamp(P.chargeT,0,1)); P.fireCd=1/g.rof;
      P.ammo--;
      if(P.ammo<=0) startReload();
    }
    P.chargeT=-1;
  }
});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(state!=='play') return;
  const s = e.deltaY>0?1:-1;
  if(placing||rmbGhost){
    const step=(keys.ShiftLeft||keys.ShiftRight)?5:15;
    ghostAngle=(ghostAngle+step*s+360)%360;
  }
},{passive:false});

function aimAngle(){
  return Math.atan2(mouse.y+cam.y-(P.y+P.h/2), mouse.x+cam.x-(P.x+P.w/2));
}
function menuClick(){
  initAudio();
  for(const b of menuBtns){
    if(mouse.x>=b.x&&mouse.x<=b.x+b.w&&mouse.y>=b.y&&mouse.y<=b.y+b.h){ b.action(); return; }
  }
}

// ---------- audio ----------
let audio = null;
const RIFF = [55,0,55,49,55,0,65.41,65.41,55,0,55,49,73.42,73.42,65.41,49];
function initAudio(){
  if(audio) return;
  try{
    const actx = new (window.AudioContext||window.webkitAudioContext)();
    const master = actx.createGain(); master.gain.value = muted?0:vol.master; master.connect(actx.destination);
    const musicBus = actx.createGain(); musicBus.gain.value = vol.music; musicBus.connect(master);
    const mus = actx.createGain(); mus.gain.value = 0.17; mus.connect(musicBus);
    const sfx = actx.createGain(); sfx.gain.value = 0.55*vol.sfx; sfx.connect(master);
    const nb = actx.createBuffer(1, actx.sampleRate*1, actx.sampleRate);
    const d = nb.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    audio = {ctx:actx, master, musicBus, mus, sfx, noise:nb, next:actx.currentTime+0.06, step:0, samples:{}};
    setInterval(musicSchedule, 30);
    // pull in real stinger samples if the user dropped any into sfx/
    for(const n of Object.keys(STING_DEFS)){
      (async()=>{
        for(const ext of ['mp3','wav','ogg']){
          try{
            const r=await fetch('sfx/'+n+'.'+ext);
            if(!r.ok) continue;
            audio.samples[n]=await audio.ctx.decodeAudioData(await r.arrayBuffer());
            return;
          }catch(e){}
        }
      })();
    }
  }catch(err){}
}
function musicSchedule(){
  if(!audio || state!=='play' || paused || musicActive()){ if(audio) audio.next = audio.ctx.currentTime+0.06; return; }
  const stepDur = 60/BPM/2;
  while(audio.next < audio.ctx.currentTime + 0.15){
    const s = audio.step, t = audio.next;
    if(s%2===0) kick(t); else hat(t);
    if(s===2||s===6||s===10||s===14) snare(t);
    if(RIFF[s]) bass(t, RIFF[s], stepDur);
    audio.step=(s+1)%16; audio.next+=stepDur;
  }
}
function kick(t){ const a=audio.ctx,o=a.createOscillator(),g=a.createGain();
  o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(42,t+0.12);
  g.gain.setValueAtTime(0.9,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.14);
  o.connect(g); g.connect(audio.mus); o.start(t); o.stop(t+0.15); }
function noiseHit(t,dur,vol,freq,type){ const a=audio.ctx,src=a.createBufferSource(); src.buffer=audio.noise;
  const f=a.createBiquadFilter(); f.type=type; f.frequency.value=freq;
  const g=a.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(f); f.connect(g); g.connect(audio.mus); src.start(t); src.stop(t+dur+0.02); }
function hat(t){ noiseHit(t,0.04,0.22,7000,'highpass'); }
function snare(t){ noiseHit(t,0.1,0.3,1800,'bandpass'); }
function bass(t,f,dur){ const a=audio.ctx,o=a.createOscillator(),fl=a.createBiquadFilter(),g=a.createGain();
  o.type='square'; o.frequency.value=f; fl.type='lowpass'; fl.frequency.value=650;
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.3,t+0.008); g.gain.exponentialRampToValueAtTime(0.001,t+dur*0.9);
  o.connect(fl); fl.connect(g); g.connect(audio.mus); o.start(t); o.stop(t+dur); }
function tone(type,f0,f1,dur,vol){
  if(!audio) return; const a=audio.ctx,t=a.currentTime,o=a.createOscillator(),g=a.createGain();
  o.type=type; o.frequency.setValueAtTime(Math.max(f0,1),t); o.frequency.exponentialRampToValueAtTime(Math.max(f1,1),t+dur);
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); g.connect(audio.sfx); o.start(t); o.stop(t+dur+0.02);
}
function sfxNoise(dur,vol,freq){ if(!audio)return; const a=audio.ctx,t=a.currentTime,src=a.createBufferSource();
  src.buffer=audio.noise; const f=a.createBiquadFilter(); f.type='bandpass'; f.frequency.value=freq;
  const g=a.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(f); f.connect(g); g.connect(audio.sfx); src.start(t); src.stop(t+dur+0.02); }
function sfxShoot(g){
  if(g.sfx==='pew') tone('sawtooth',950,180,0.12,0.3);
  else if(g.sfx==='zap') tone('square',700,260,0.06,0.16);
  else if(g.sfx==='boom'){ tone('sawtooth',420,60,0.22,0.4); sfxNoise(0.15,0.3,900); }
  else if(g.sfx==='lance'){ tone('sawtooth',240,1500,0.28,0.4); sfxNoise(0.2,0.2,3000); }
}
function sfxBounce(n){ const f=420*Math.pow(1.23,n); tone('triangle',f,f*1.5,0.13,0.28); }
function sfxKill(){ tone('square',380,55,0.35,0.4); sfxNoise(0.3,0.5,1400); }
function sfxHurt(){ tone('square',170,60,0.2,0.4); }
function sfxClink(){ tone('sine',2100,1600,0.07,0.2); }
function sfxPlace(){ tone('sine',650,950,0.1,0.25); }
function sfxShatter(){ sfxNoise(0.25,0.45,3500); tone('triangle',1800,400,0.2,0.25); }
function sfxUI(f){ tone('sine',f,f*1.2,0.06,0.15); }
function sfxLoot(){ tone('sine',500,1000,0.12,0.25); tone('sine',750,1500,0.18,0.2); }

// ---------- hype stingers (beat-quantized one-shots) ----------
// Drop real samples in sfx/<name>.mp3|wav|ogg (e.g. a Suno-made "Yeah!")
// and they replace the synth fallbacks automatically.
const STING_DEFS = {
  yeah:   {label:'YEAH!',    color:'#ffe14d', quarter:true},
  airhorn:{label:'BWAAAP!',  color:'#ff9d2e', quarter:true},
  scratch:{label:'WIKI-WIKI',color:'#7de8ff'},
  wow:    {label:'WOW!',     color:'#ff4dd2', quarter:true},
  horn:   {label:'THE HIT!', color:'#ff4d6d', quarter:true},
};
const stingCd = {};
function sting(name, o){
  o=o||{};
  if(!STING_DEFS[name]) return;
  if(audio){
    const now=audio.ctx.currentTime;
    if(!(stingCd[name]>now)){
      stingCd[name]=now+1.0;
      // land on the music grid: next 8th, vocals on the next quarter.
      // With a real track playing, the grid follows the track's own clock.
      const stepDur=60/BPM/2;
      let t=now+0.03;
      if(musicActive()){
        const ct=music.main.el.currentTime;
        let ns=Math.ceil(ct/stepDur+0.001);
        if(STING_DEFS[name].quarter && ns%2===1) ns++;
        t=now+Math.max(0.02, ns*stepDur-ct);
      } else if(state==='play' && !paused && audio.next>now){
        t=audio.next;
        if(STING_DEFS[name].quarter && audio.step%2===1) t+=stepDur;
      }
      playSting(name,t);
      setTimeout(()=>stingFx(name,o.x,o.y), Math.max(0,(t-now)*1000));
    }
  } else stingFx(name,o.x,o.y);
  if(!o.fromNet) net.send({t:'sting', n:name, x:o.x, y:o.y, pi:o.pi});
}
function playSting(name,t){
  const s=audio.samples && audio.samples[name];
  if(s){
    const a=audio.ctx, src=a.createBufferSource(); src.buffer=s;
    const g=a.createGain(); g.gain.value=0.85;
    src.connect(g); g.connect(audio.sfx); src.start(t);
    return;
  }
  synthSting(name,t);
}
function toneAt(type,f0,f1,t,dur,vol){ const a=audio.ctx,o=a.createOscillator(),g=a.createGain();
  o.type=type; o.frequency.setValueAtTime(Math.max(f0,1),t); o.frequency.exponentialRampToValueAtTime(Math.max(f1,1),t+dur);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); g.connect(audio.sfx); o.start(t); o.stop(t+dur+0.02); }
function noiseAt(t,dur,vol,freq,type){ const a=audio.ctx,src=a.createBufferSource(); src.buffer=audio.noise;
  const f=a.createBiquadFilter(); f.type=type; f.frequency.value=freq;
  const g=a.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(f); f.connect(g); g.connect(audio.sfx); src.start(t); src.stop(t+dur+0.02); }
function synthSting(name,t){
  if(name==='yeah'){          // crowd shout-ish burst
    noiseAt(t,0.16,0.5,1300,'bandpass');
    toneAt('square',260,520,t,0.14,0.22);
    toneAt('sawtooth',180,360,t,0.16,0.18);
    noiseAt(t+0.05,0.12,0.3,2400,'bandpass');
  } else if(name==='airhorn'){ // triple honk
    for(const [d0,dur] of [[0,0.16],[0.2,0.16],[0.4,0.45]]){
      toneAt('sawtooth',466,440,t+d0,dur,0.4);
      toneAt('sawtooth',471,445,t+d0,dur,0.3);
      toneAt('sawtooth',233,220,t+d0,dur,0.25);
    }
  } else if(name==='scratch'){ // wiki-wiki
    [900,3200,700,2600,1200].forEach((f,i)=>noiseAt(t+i*0.06,0.055,0.4,f,'bandpass'));
  } else if(name==='wow'){
    toneAt('sine',950,180,t,0.5,0.4);
    toneAt('sine',1420,270,t,0.5,0.2);
  } else {                     // horn: orchestra hit
    noiseAt(t,0.2,0.4,700,'bandpass');
    toneAt('sawtooth',220,175,t,0.28,0.45);
    toneAt('sawtooth',330,262,t,0.28,0.35);
    toneAt('sawtooth',110,88,t,0.3,0.4);
  }
}
function stingFx(name,x,y){
  const d=STING_DEFS[name];
  hypeT=Math.min(hypeT+2.2,3);
  shake+=2;
  if(x!=null){
    popup(x,y-30,d.label,d.color,24);
    for(let i=0;i<26;i++){ const a=rnd(TAU), s=rnd(80,340);
      particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-140,life:rnd(0.5,1.1),max:1.1,color:`hsl(${rnd(360)},95%,65%)`,size:rnd(2,5),grav:500}); }
  } else if(state==='play') popup(P.x+13,P.y-34,d.label,d.color,20);
}
function fireProp(i, fromNet){
  const pr=props[i]; if(!pr) return;
  pr.cdT=2.5;
  sting(pr.kind, {x:pr.x, y:pr.y, pi:i, fromNet});
}

// ---------- soundtrack (Suno tracks in music/) ----------
// Main loop per state; overlays (star/death/crown) duck the main track;
// the danger layer crossfades in under 25% HP. v2 variants picked at random.
const MUSIC_SETS = {
  menu:  ['Start the Apocalypse.mp3'],
  lobby: ['Grate Expectations.mp3'],
  // all gameplay tracks share one shuffled pool so matches never sound samey
  game:  ['Dancefloor Salvation v2.mp3','Prism Alley.mp3','Prism Alley v2.mp3','Frag Fever.mp3','Frag Fever v2.mp3'],
  star:  ['Mirrorball Lift.mp3','Mirrorball Lift v2.mp3'],
  danger:['Ten Percent Battery.mp3','Ten Percent Battery v2.mp3'],
  dead:  ['Dropped on the Beat.mp3'],
  crown: ['Crowned in Neon.mp3','Crowned in Neon v2.mp3'],
};
const music = {els:{}, main:null, mainKey:'', over:null, overT:0, danger:null, duck:0.9, name:'', nameT:0, broken:{}};
function musicNode(src){
  let n=music.els[src];
  if(n) return n;
  const el=new Audio('music/'+src);
  el.preload='auto';
  const g=audio.ctx.createGain(); g.gain.value=0;
  try{
    const s=audio.ctx.createMediaElementSource(el);
    s.connect(g); g.connect(audio.musicBus);
  }catch(e){ music.broken[src]=true; }
  el.addEventListener('error',()=>{ music.broken[src]=true; });
  n={el,g}; music.els[src]=n;
  return n;
}
function pickTrack(key, avoid){
  const all=(MUSIC_SETS[key]||[]).filter(s=>!music.broken[s]);
  if(!all.length) return null;
  if(all.length===1) return all[0];
  // shuffle bag: play every track in the set before any repeats
  music.bags=music.bags||{};
  let bag=music.bags[key];
  if(!bag || !bag.length){
    bag=all.slice();
    for(let i=bag.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=bag[i]; bag[i]=bag[j]; bag[j]=t; }
    if(avoid && bag[bag.length-1]===avoid){ const t=bag[0]; bag[0]=bag[bag.length-1]; bag[bag.length-1]=t; }
    music.bags[key]=bag;
  }
  return bag.pop();
}
function musicActive(){ return !!(music.main && !music.main.el.paused && !music.main.el.error); }
function fadeGain(g,v,dur){
  const t=audio.ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(Math.max(g.gain.value,0.0001),t);
  g.gain.linearRampToValueAtTime(v,t+dur);
}
function setMainMusic(key){
  if(music.mainKey===key) return;
  music.mainKey=key;
  if(music.main){
    const old=music.main;
    fadeGain(old.g,0,0.5);
    setTimeout(()=>{ if(music.main!==old) old.el.pause(); },600);
  }
  music.main=null;
  const src=pickTrack(key, music.curSrc);
  if(!src) return;
  music.curSrc=src;
  const n=musicNode(src);
  // single-track sets loop; multi-track sets rotate on 'ended' (see musicTick)
  n.el.loop = (MUSIC_SETS[key]||[]).filter(s=>!music.broken[s]).length<=1;
  n.el.currentTime=0;
  const pr=n.el.play(); if(pr) pr.catch(()=>{});
  music.duck=0.9;
  fadeGain(n.g,0.9,0.7);
  music.main=n;
  music.name=src.replace(/\.mp3$/,''); music.nameT=4.5;
}
function playOverlay(key,dur){
  if(!audio) return;
  const src=pickTrack(key); if(!src) return;
  if(music.over) music.over.el.pause();
  const n=musicNode(src);
  n.el.loop=false; n.el.currentTime=0;
  const pr=n.el.play(); if(pr) pr.catch(()=>{});
  fadeGain(n.g,1,0.05);
  music.over=n; music.overT=dur;
  music.name=src.replace(/\.mp3$/,''); music.nameT=3;
}
function musicTick(dt){
  if(!audio) return;
  setMainMusic(state==='play'? 'game' : state==='lobby'? 'lobby':'menu');
  if(music.over){
    music.overT-=dt;
    if(music.overT<=0 || music.over.el.ended){
      fadeGain(music.over.g,0,0.4);
      const o=music.over; setTimeout(()=>o.el.pause(),500);
      music.over=null;
    }
  }
  const wantDanger = state==='play' && P.deadT<=0 && P.hp<=P.maxHp*0.25;
  if(wantDanger && !music.danger){
    const src=pickTrack('danger');
    if(src){
      const n=musicNode(src);
      n.el.loop=true;
      if(n.el.paused){ n.el.currentTime=0; const pr=n.el.play(); if(pr) pr.catch(()=>{}); }
      fadeGain(n.g,0.9,0.6);
      music.danger=n;
    }
  } else if(music.danger && (state!=='play' || P.deadT>0 || P.hp>P.maxHp*0.4)){
    fadeGain(music.danger.g,0,0.8);
    const d=music.danger; setTimeout(()=>d.el.pause(),900);
    music.danger=null;
  }
  // variety + resilience: rotate to a fresh track when one ends,
  // nudge paused elements back to life, and bail out of stalled streams
  if(music.main){
    const el=music.main.el;
    if(el.ended || el.error){
      const key=music.mainKey; music.mainKey=null; setMainMusic(key);
    } else if(el.paused){
      music.resumeT=(music.resumeT||0)-dt;
      if(music.resumeT<=0){ music.resumeT=1; const pr=el.play(); if(pr) pr.catch(()=>{}); }
    } else {
      if(Math.abs(el.currentTime-(music.lastCt!=null?music.lastCt:-1))<0.004){
        music.stallT=(music.stallT||0)+dt;
        if(music.stallT>3){ music.stallT=0; const key=music.mainKey; music.mainKey=null; setMainMusic(key); }
      } else music.stallT=0;
      music.lastCt=el.currentTime;
    }
  }
  const duckTarget = music.over? 0.12 : music.danger? 0.3 : 0.9;
  if(music.main && music.duck!==duckTarget){ music.duck=duckTarget; fadeGain(music.main.g,duckTarget,0.4); }
  music.nameT-=dt;
}

// ---------- lasers ----------
// extraTargets: [{rect, kind:'player'|'self', idx?}]
function castRay(x,y,dx,dy,maxDist,skipMirror,skipEnemies,extraTargets){
  let best=null;
  for(const s of solids){
    if(s.oneWay) continue;
    const h=rayRect(x,y,dx,dy,s);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best={t:h.t,nx:h.nx,ny:h.ny,kind:'wall'};
  }
  for(const m of allMirrors()){
    if(m===skipMirror) continue;
    const e=segPts(m);
    const h=raySeg(x,y,dx,dy,e.x1,e.y1,e.x2,e.y2);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best={t:h.t,nx:h.nx,ny:h.ny,kind:'mirror',mirror:m};
  }
  for(const en of enemies){
    if(en.dead) continue;
    if(skipEnemies && skipEnemies.has(en)) continue;
    let h;
    if(en.type==='prism') h=rayCircle(x,y,dx,dy,en.x,en.y,en.r);
    else h=rayRect(x,y,dx,dy,{x:en.x-en.w/2,y:en.y-en.h,w:en.w,h:en.h});
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best={t:h.t,nx:h.nx||0,ny:h.ny||0,kind:'enemy',enemy:en};
  }
  for(let i=0;i<props.length;i++){
    const pr=props[i];
    const h=rayCircle(x,y,dx,dy,pr.x,pr.y,pr.r);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best={t:h.t,nx:h.nx,ny:h.ny,kind:'prop',pi:i};
  }
  if(extraTargets) for(const et of extraTargets){
    const h=rayRect(x,y,dx,dy,et.rect);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best={t:h.t,nx:h.nx,ny:h.ny,kind:et.kind,idx:et.idx};
  }
  return best;
}
function castSolids(x,y,dx,dy,maxDist){
  let best=null;
  for(const s of solids){ if(s.oneWay) continue;
    const h=rayRect(x,y,dx,dy,s);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best=h; }
  return best;
}
function startReload(){
  const g=effGun(GUNS[P.gun]);
  if(P.reloadT>0 || P.ammo>=g.mag || P.deadT>0) return;
  P.reloadT=g.rel;
  P.chargeT=-1;
  tone('square',320,160,0.1,0.2); sfxNoise(0.08,0.2,1800);
}
function shoot(gun,angle,dmgMul){
  const mul=(dmgMul||1)*(buffs.amp>0?1.5:1);
  for(let i=0;i<gun.pellets;i++){
    let a=angle;
    if(gun.pellets>1) a += (i/(gun.pellets-1)-0.5)*gun.spread + rnd(-0.02,0.02);
    else a += rnd(-0.5,0.5)*gun.spread;
    fireBeam(P.x+P.w/2, P.y+P.h/2, a, gun, mul, {isLocal:true, maxB:gun.maxB});
  }
  P.gunFlash=0.07;
  shake += gun.charge? 6 : (gun.pellets>3? 4 : 1.2);
  sfxShoot(gun);
  net.send({t:'fire', who:MP.you, x:Math.round(P.x+P.w/2), y:Math.round(P.y+P.h/2), a:angle, g:P.gun, dm:mul, mb:gun.maxB, rb:buffs.rubber>0?1:0});
}
function remoteShoot(m){
  const g=GUNS[m.g]||GUNS[0];
  for(let i=0;i<g.pellets;i++){
    let a=m.a;
    if(g.pellets>1) a += (i/(g.pellets-1)-0.5)*g.spread + rnd(-0.02,0.02);
    else a += rnd(-0.5,0.5)*g.spread;
    fireBeam(m.x, m.y, a, g, m.dm||1, {isLocal:false, maxB:m.mb!=null?m.mb:g.maxB, rubberSim:!!m.rb});
  }
  if(peers[m.who]) peers[m.who].gunFlash=0.07;
  sfxShoot(g);
}
function breakMirrorById(id, broadcast){
  const m=playerMirrors.find(x=>x.id===id);
  if(!m) return;
  playerMirrors=playerMirrors.filter(x=>x!==m);
  sparks(m.x,m.y,'#e8f7ff',14,240); sparks(m.x,m.y,'#c9ffb8',8,160);
  popup(m.x,m.y-16,'SHATTERED','#e8f7ff',12);
  sfxShatter();
  if(broadcast) net.send({t:'mbreak', id});
}
function fireBeam(ox,oy,angle,gun,dmgMul,opts){
  opts=opts||{};
  const maxB = opts.maxB!=null? opts.maxB : gun.maxB;
  let x=ox, y=oy, dx=Math.cos(angle), dy=Math.sin(angle);
  let dmg=gun.dmg*(dmgMul||1), range=gun.range, bounces=0, skipM=null;
  const pts=[{x,y}];
  const pierced = gun.pierce? new Set() : null;
  const damaging = opts.isLocal || (opts.fromBall && opts.ballMine);
  const wantPvp = opts.isLocal && !opts.fromBall && MP.on && MP.mode==='vs';
  const localSim = opts.isLocal || opts.fromBall;
  for(let iter=0; iter<48; iter++){
    const ex=[];
    if(wantPvp) for(let i=0;i<4;i++){ if(i!==MP.you && peers[i].on && peers[i].hp>0) ex.push({rect:peerRect(i), kind:'player', idx:i}); }
    if(localSim && P.deadT<=0 && (bounces>=1 || opts.fromBall)) ex.push({rect:selfRect(), kind:'self'});
    const hit=castRay(x,y,dx,dy,range,skipM,pierced,ex.length?ex:null);
    if(!hit){ pts.push({x:x+dx*range, y:y+dy*range}); break; }
    const hx=x+dx*hit.t, hy=y+dy*hit.t;
    range-=hit.t;
    pts.push({x:hx,y:hy});
    if(hit.kind==='mirror' && bounces<maxB){
      // player-placed mirrors soak the incoming beam's damage (shooter's sim decides)
      if(hit.mirror.player && damaging){
        hit.mirror.hp=(hit.mirror.hp!=null? hit.mirror.hp : MIRROR_HP)-dmg;
        if(hit.mirror.hp<=0) breakMirrorById(hit.mirror.id, true);
      }
      bounces++; dmg*=gun.bMult;
      if(!opts.quiet) sfxBounce(bounces);
      sparks(hx,hy,gun.color,7,180);
      const d=dx*hit.nx+dy*hit.ny;
      dx-=2*d*hit.nx; dy-=2*d*hit.ny;
      x=hx+dx*0.6; y=hy+dy*0.6; skipM=hit.mirror;
      if(range<=0) break;
      continue;
    }
    if(hit.kind==='player'){
      if(peers[hit.idx] && peers[hit.idx].suit>0 && bounces<maxB){
        // mirror suit: they ARE a mirror
        bounces++; dmg*=1.35;
        sparks(hx,hy,'#e8f7ff',8,200); if(!opts.quiet) sfxBounce(bounces);
        const d=dx*hit.nx+dy*hit.ny;
        dx-=2*d*hit.nx; dy-=2*d*hit.ny;
        x=hx+dx*0.6; y=hy+dy*0.6; skipM=null;
        if(range<=0) break;
        continue;
      }
      const d=Math.round(dmg);
      popup(hx+rnd(-6,6), hy-10, ''+d, '#ff9d2e', 14+bounces*3);
      sparks(hx,hy,'#ff9d2e',6,160);
      net.send({t:'pvp', who:MP.you, to:hit.idx, d, b:bounces, kx:+dx.toFixed(2), ky:+dy.toFixed(2), kb:buffs.mega>0?2.5:1});
      if(buffs.vamp>0){ P.hp=Math.min(P.maxHp, P.hp+Math.max(1,Math.round(d*0.3))); }
      break;
    }
    if(hit.kind==='self'){
      if(buffs.suit>0 && bounces<maxB){
        bounces++; dmg*=1.35;
        sparks(hx,hy,'#e8f7ff',8,200); if(!opts.quiet) sfxBounce(bounces);
        const d=dx*hit.nx+dy*hit.ny;
        dx-=2*d*hit.nx; dy-=2*d*hit.ny;
        x=hx+dx*0.6; y=hy+dy*0.6; skipM=null;
        if(range<=0) break;
        continue;
      }
      const d=Math.max(1,Math.round(dmg*0.5));
      if(buffs.star>0) popup(hx,hy-10,'BLOCKED','#ffe14d',13);
      else{
        damagePlayer(d, {dx,dy,mul:buffs.mega>0?2.5:1}, opts.fromBall?'ball':'self', opts.fromBall? opts.ballOwner : MP.you);
        popup(hx,hy-22,'SELF BOUNCE!','#ff4d6d',12);
      }
      break;
    }
    if(hit.kind==='prop'){
      sparks(hx,hy,'#ffffff',6,160);
      const pr=props[hit.pi];
      if(pr && pr.cdT<=0 && (opts.isLocal || opts.ballMine)) fireProp(hit.pi, false);
      break;
    }
    if(hit.kind==='enemy'){
      if(damaging){
        if(MP.isHost || !MP.on) damageEnemy(hit.enemy, dmg, bounces, hx, hy);
        else clientHit(hit.enemy, dmg, bounces, hx, hy);
        if(buffs.vamp>0 && opts.isLocal){ P.hp=Math.min(P.maxHp, P.hp+Math.max(1,Math.round(dmg*0.3))); }
      }
      if(pierced){ pierced.add(hit.enemy); x=hx+dx*0.6; y=hy+dy*0.6; skipM=null; if(range>0) continue; }
      break;
    }
    if(hit.kind==='wall' && bounces<maxB && ((opts.isLocal && buffs.rubber>0) || opts.rubberSim)){
      // RUBBER RAVE: walls act like mirrors (full bounce power)
      bounces++; dmg*=gun.bMult;
      if(!opts.quiet) sfxBounce(bounces);
      sparks(hx,hy,'#ffb3e6',6,160);
      const d=dx*hit.nx+dy*hit.ny;
      dx-=2*d*hit.nx; dy-=2*d*hit.ny;
      x=hx+dx*0.6; y=hy+dy*0.6; skipM=null;
      if(range<=0) break;
      continue;
    }
    sparks(hx,hy,gun.color,5,140);
    break;
  }
  beams.push({pts, color:gun.color, w:gun.beamW+bounces*1.5, life:0.42, max:0.42, b:bounces});
  if(beams.length>160) beams.shift();
}
function clientHit(en,dmg,bounces,hx,hy){
  const i=enemies.indexOf(en);
  if(en.type==='prism' && bounces<en.minB){
    popup(hx,hy-14,'BOUNCE x'+en.minB+' REQUIRED','#9aa7c7',13);
    sfxClink();
  } else {
    const d=Math.round(dmg);
    const cols=['#ffffff','#ffe14d','#ff9d2e','#ff4d6d','#ff2ef5','#b44bff'];
    popup(hx+rnd(-8,8), hy-10, ''+d, cols[Math.min(bounces,5)], 13+bounces*3);
    if(bounces>bestBounce) bestBounce=bounces;
  }
  net.send({t:'edmg', who:MP.you, i, d:Math.round(dmg), b:bounces, hx:Math.round(hx), hy:Math.round(hy)});
}
const BOUNCE_HYPE = {2:'DOUBLE BOUNCE!',3:'TRIPLE BOUNCE!!',4:'QUAD GEOMETRY!',5:'PENTA-PRISM!!'};
function damageEnemy(en,dmg,bounces,hx,hy){
  if(en.type==='prism' && bounces<en.minB){
    popup(hx,hy-14,'BOUNCE x'+en.minB+' REQUIRED','#9aa7c7',13);
    sfxClink(); sparks(hx,hy,'#9aa7c7',4,100);
    return;
  }
  const d=Math.round(dmg);
  en.hp-=d;
  if(bounces>bestBounce) bestBounce=bounces;
  const cols=['#ffffff','#ffe14d','#ff9d2e','#ff4d6d','#ff2ef5','#b44bff'];
  popup(hx+rnd(-8,8), hy-10, ''+d, cols[Math.min(bounces,5)], 13+bounces*3);
  sparks(hx,hy,'#ffffff',4,120);
  if(en.hp<=0 && !en.dead){
    en.dead=true; en.respawnT = en.type==='prism'? 9 : 6.5;
    kills++;
    const pts=Math.round(100*(1+bounces));
    score+=pts;
    popup(en.x, (en.type==='prism'?en.y:en.y-en.h)-24, '+'+pts, '#7dff5e', 18);
    explosion(en.x, en.type==='prism'?en.y:en.y-en.h/2, en.type==='prism'?'#7de8ff':'#ff3df0');
    cheerKill(en.x, en.type==='prism'?en.y:en.y-en.h/2);
    shake+=5; sfxKill();
    if(bounces>=2){
      announce(BOUNCE_HYPE[Math.min(bounces,5)] || 'APOCALYPSE ANGLES!!!');
      sting('yeah', {x:en.x, y:en.type==='prism'?en.y:en.y-en.h});
    }
  }
}

// ---------- laser sight (local only — no other player ever sees it) ----------
function traceSight(){
  const g=effGun(GUNS[P.gun]);
  let x=P.x+P.w/2, y=P.y+P.h/2;
  const a=aimAngle();
  let dx=Math.cos(a), dy=Math.sin(a), range=g.range, bounces=0, skipM=null;
  const pts=[{x,y}]; let endKind='none';
  for(let iter=0; iter<14; iter++){
    const ex=[];
    if(MP.on && MP.mode==='vs') for(let i=0;i<4;i++){ if(i!==MP.you && peers[i].on && peers[i].hp>0) ex.push({rect:peerRect(i),kind:'player',idx:i}); }
    if(bounces>=1 && P.deadT<=0) ex.push({rect:selfRect(),kind:'self'});
    const hit=castRay(x,y,dx,dy,range,skipM,null,ex.length?ex:null);
    if(!hit){ pts.push({x:x+dx*range,y:y+dy*range}); break; }
    const hx=x+dx*hit.t, hy=y+dy*hit.t;
    range-=hit.t; pts.push({x:hx,y:hy});
    if(hit.kind==='mirror' && bounces<g.maxB){
      bounces++;
      const d=dx*hit.nx+dy*hit.ny;
      dx-=2*d*hit.nx; dy-=2*d*hit.ny;
      x=hx+dx*0.6; y=hy+dy*0.6; skipM=hit.mirror;
      if(range<=0) break;
      continue;
    }
    if(hit.kind==='wall' && bounces<g.maxB && buffs.rubber>0){
      bounces++;
      const d=dx*hit.nx+dy*hit.ny;
      dx-=2*d*hit.nx; dy-=2*d*hit.ny;
      x=hx+dx*0.6; y=hy+dy*0.6; skipM=null;
      if(range<=0) break;
      continue;
    }
    endKind=hit.kind;
    break;
  }
  return {pts, endKind, color:g.color};
}

// ---------- mirrors: placement (cap system, never spent) ----------
function myMirrors(){ return playerMirrors.filter(m=>m.owner===MP.you && !m.temp); } // maze mirrors don't count toward the cap
function ghostValid(mx,my){
  const m={x:mx,y:my,angle:ghostAngle,len:90};
  const e=segPts(m);
  for(let i=0;i<=4;i++){
    const px=lerp(e.x1,e.x2,i/4), py=lerp(e.y1,e.y2,i/4);
    if(px<10||px>W-10||py<10||py>H-10) return false;
    for(const s of solids) if(ptInRect(px,py,s)) return false;
  }
  for(const om of allMirrors()) if(Math.hypot(om.x-mx,om.y-my)<55) return false;
  return true;
}
const MIRROR_REGEN = 1.5; // charges refill 1 per 1.5s — spam your whole inventory, then wait
function tryPlaceMirror(){
  const mx=mouse.x+cam.x, my=mouse.y+cam.y;
  if(P.mCharges<1){ sfxClink(); popup(mx,my,'NO MIRRORS — RECHARGING','#9aa7c7',12); return; }
  if(!ghostValid(mx,my)){ sfxClink(); return; }
  const mine=myMirrors();
  if(mine.length>=mirrorMax){
    const old=mine[0]; // oldest gets recycled
    playerMirrors=playerMirrors.filter(m=>m!==old);
    sparks(old.x,old.y,'#7dff5e',6,120);
    net.send({t:'mpick', id:old.id});
  }
  const m={id:'m'+MP.you+'-'+(mirrorIdSeq++), x:mx,y:my,angle:ghostAngle,len:90,player:true,owner:MP.you,hp:MIRROR_HP};
  playerMirrors.push(m);
  P.mCharges--;
  sfxPlace(); sparks(mx,my,'#7dff5e',8,140);
  net.send({t:'mplace', m});
}
function pickupMirror(){
  const pcx=P.x+P.w/2, pcy=P.y+P.h/2;
  let best=null, bd=150;
  for(const m of myMirrors()){
    const d=Math.hypot(m.x-pcx,m.y-pcy); if(d<bd){bd=d;best=m;}
  }
  if(best){
    playerMirrors=playerMirrors.filter(m=>m!==best);
    P.mCharges=Math.min(mirrorMax,P.mCharges+1); // picking one up refunds a charge
    sfxUI(880); sparks(best.x,best.y,'#7dff5e',6,120);
    net.send({t:'mpick', id:best.id});
  }
}

// ---------- loot / items ----------
function updateLoot(dt){
  if(MP.isHost || !MP.on){
    for(let i=0;i<loot.length;i++){
      const b=loot[i];
      if(!b.active){ b.respawnT-=dt; if(b.respawnT<=0){ b.active=true; net.send({t:'lootUp', i}); } }
    }
  }
  if(P.deadT<=0 && !roul.active){
    for(let i=0;i<loot.length;i++){
      const b=loot[i];
      if(!b.active) continue;
      const vac = buffs.magnet>0 && Math.hypot(b.x-(P.x+P.w/2), b.y-(P.y+P.h/2))<280;
      if(vac || rectsOverlap({x:P.x,y:P.y,w:P.w,h:P.h},{x:b.x-18,y:b.y-18,w:36,h:36})){
        b.active=false;
        if(MP.isHost || !MP.on) b.respawnT=8;
        let p=rollPowerup();
        if(POWERUPS[p].id==='ball' && heldItem==='ball') p=0;
        if(POWERUPS[p].id==='mirror' && mirrorMax>=MIRROR_CAP) p=0;
        if(firstLoot){ // your first box each match pays out your class signature item
          const fi=POWERUPS.findIndex(q=>q.id===CLASSES[P.cls].start);
          if(fi>=0 && itemEnabled(POWERUPS[fi].id)) p=fi;
          firstLoot=false;
        }
        roul.active=true; roul.t=0; roul.pick=p; roul.tickT=0;
        sfxLoot(); sparks(b.x,b.y,'#ff9df5',12,200);
        net.send({t:'loot', who:MP.you, i, p});
        break;
      }
    }
  }
  if(roul.active){
    roul.t+=dt; roul.tickT-=dt;
    if(roul.tickT<=0){ roul.tickT=0.09; tone('sine',600+roul.t*900,700+roul.t*900,0.05,0.12); }
    if(roul.t>=0.9){ roul.active=false; applyPowerup(roul.pick); }
  }
  const wasTiny=buffs.tiny>0;
  for(const k in buffs) if(buffs[k]>0) buffs[k]-=dt;
  if(buffs.hook<=0 && P.hook) P.hook=null;
  if(wasTiny && buffs.tiny<=0){ // grow back (nudge up if the ceiling got closer)
    const C=CLASSES[P.cls];
    P.y-=(C.h-P.h); P.w=C.w; P.h=C.h;
    for(let i=0;i<20;i++){
      let stuck=false;
      for(const s of solids){ if(!s.oneWay && !s.drop && rectsOverlap({x:P.x,y:P.y,w:P.w,h:P.h},s)){ stuck=true; break; } }
      if(!stuck) break;
      P.y-=6;
    }
  }
  // temporary maze mirrors expire (owner broadcasts the break)
  for(const m of playerMirrors.slice()){
    if(m.temp && m.owner===MP.you){
      m.expT=(m.expT!=null?m.expT:12)-dt;
      if(m.expT<=0) breakMirrorById(m.id, true);
    }
  }
  for(let i=decoys.length-1;i>=0;i--){ decoys[i].t-=dt; if(decoys[i].t<=0){ sparks(decoys[i].x,decoys[i].y,'#ff4dd2',8,140); decoys.splice(i,1);} }
}
function applyPowerup(i){
  const p=POWERUPS[i];
  announce(p.name);
  tone('sine',700,1400,0.25,0.3); tone('sine',1050,2100,0.35,0.2);
  switch(p.id){
    case 'heal': P.hp=Math.min(P.maxHp,P.hp+40); popup(P.x+P.w/2,P.y-16,'+40','#7dff5e',18); break;
    case 'mirror': mirrorMax=Math.min(MIRROR_CAP,mirrorMax+1); P.mCharges=Math.min(mirrorMax,P.mCharges+1); popup(P.x+P.w/2,P.y-16,'CAP '+mirrorMax,'#7dff5e',15); break;
    case 'fever': buffs.fever=p.dur; break;
    case 'amp': buffs.amp=p.dur; break;
    case 'over': buffs.over=p.dur; break;
    case 'star': buffs.star=p.dur; sting('wow'); playOverlay('star',6); break;
    case 'hook': buffs.hook=p.dur; break;
    case 'jet': buffs.jet=p.dur; break;
    case 'moon': buffs.moon=p.dur; break;
    case 'blink': buffs.blink=p.dur; break;
    case 'suit': buffs.suit=p.dur; break;
    case 'skate': buffs.skate=p.dur; break;
    case 'ball': heldItem='ball'; break;
    case 'beat': beatDrop(); sting('horn'); break;
    case 'storm': { // disco balls rain across the arena
      for(let k=0;k<5;k++){
        const bx=clamp(P.x+rnd(-800,800),120,W-120);
        const b={x:bx,y:rnd(120,260),vx:rnd(-120,120),vy:0,age:0,sprayT:0,owner:MP.you};
        balls.push(b);
        net.send({t:'ball', who:MP.you, x:Math.round(b.x), y:Math.round(b.y), vx:Math.round(b.vx), vy:0});
      }
      sting('horn');
      break; }
    case 'maze': { // diamond of temporary mirrors around you (12s, no cap cost)
      const cx2=P.x+P.w/2, cy2=P.y+P.h/2;
      for(const [ox,oy,an] of [[130,-130,45],[130,130,-45],[-130,130,45],[-130,-130,-45]]){
        const m={id:'m'+MP.you+'-'+(mirrorIdSeq++), x:cx2+ox, y:cy2+oy, angle:an, len:90,
          player:true, owner:MP.you, hp:MIRROR_HP, temp:true, expT:12};
        playerMirrors.push(m);
        net.send({t:'mplace', m});
      }
      sfxPlace();
      break; }
    case 'tiny': {
      if(buffs.tiny<=0){ const oh=P.h; P.w=Math.max(12,Math.round(P.w*0.6)); P.h=Math.max(22,Math.round(P.h*0.6)); P.y+=oh-P.h; }
      buffs.tiny=p.dur;
      break; }
    case 'rubber': buffs.rubber=p.dur; break;
    case 'ghost': buffs.ghost=p.dur; break;
    case 'magnet': buffs.magnet=p.dur; break;
    case 'bigshot': buffs.bigshot=p.dur; break;
    case 'triple': buffs.triple=p.dur; break;
    case 'vamp': buffs.vamp=p.dur; break;
    case 'pogo': buffs.pogo=p.dur; break;
    case 'mega': buffs.mega=p.dur; break;
    case 'wind': buffs.wind=p.dur; break;
    case 'orbit': buffs.orbit=p.dur; orbitA=0; orbitFT=0.3; break;
    case 'swap': {
      const alive=[]; if(MP.on) for(let k=0;k<4;k++) if(k!==MP.you && peers[k].on && peers[k].hp>0) alive.push(k);
      sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
      if(alive.length){
        // handshake: victim teleports to my spot and replies with THEIR authoritative
        // position — no trusting laggy interpolated coordinates
        const t=alive[Math.floor(Math.random()*alive.length)];
        net.send({t:'swap', who:MP.you, to:t, x:Math.round(P.x), y:Math.round(P.y)});
        popup(P.x+P.w/2,P.y-20,'SWITCHING…','#ffe14d',14);
      } else {
        const sp=spawns[Math.floor(Math.random()*spawns.length)];
        safePlace(sp.x, sp.y-(P.h-46));
        sparks(P.x+P.w/2,P.y+P.h/2,'#ffe14d',12,220);
        popup(P.x+P.w/2,P.y-20,'SWITCHED!','#ffe14d',15);
      }
      break; }
    case 'decoy': {
      const d={x:P.x+P.w/2,y:P.y+P.h,who:MP.you,t:12,seed:rnd(10),cls:P.cls,col:myColor};
      decoys.push(d);
      net.send({t:'decoy', who:MP.you, x:Math.round(d.x), y:Math.round(d.y), cls:P.cls, col:myColor});
      break; }
  }
}
function beatDrop(){
  const cx=P.x+13, cy=P.y+23, R=280;
  particles.push({x:cx,y:cy,vx:0,vy:0,life:0.5,max:0.5,color:'#ff4d6d',size:6,ring:true,grav:0});
  particles.push({x:cx,y:cy,vx:0,vy:0,life:0.7,max:0.7,color:'#ffe14d',size:6,ring:true,grav:0});
  shake+=12; sfxKill(); tone('sawtooth',80,40,0.5,0.5);
  for(let i=0;i<enemies.length;i++){
    const en=enemies[i]; if(en.dead) continue;
    const ex=en.x, ey=en.type==='prism'?en.y:en.y-en.h/2;
    if(Math.hypot(ex-cx,ey-cy)<=R){
      if(MP.isHost||!MP.on) damageEnemy(en,35,0,ex,ey);
      else net.send({t:'edmg', who:MP.you, i, d:35, b:0, hx:Math.round(ex), hy:Math.round(ey)});
    }
  }
  if(MP.on && MP.mode==='vs') for(let i=0;i<4;i++){
    if(i===MP.you || !peers[i].on || peers[i].hp<=0) continue;
    const pc=peerCenter(i);
    const dd=Math.hypot(pc.x-cx, pc.y-cy);
    if(dd<=R)
      net.send({t:'pvp', who:MP.you, to:i, d:25, b:0, kx:+((pc.x-cx)/(dd||1)).toFixed(2), ky:+((pc.y-cy)/(dd||1)).toFixed(2)});
  }
}
function throwItem(){
  if(heldItem!=='ball' || placing) return;
  heldItem=null;
  const a=aimAngle(), cx=P.x+P.w/2, cy=P.y+P.h/2;
  const b={x:cx,y:cy, vx:Math.cos(a)*700+P.vx*0.3, vy:Math.sin(a)*700+P.vy*0.3-120, age:0, sprayT:0, owner:MP.you};
  balls.push(b);
  net.send({t:'ball', who:MP.you, x:Math.round(cx), y:Math.round(cy), vx:Math.round(b.vx), vy:Math.round(b.vy)});
  tone('sine',400,900,0.15,0.25);
}
function updateBalls(dt){
  for(let i=balls.length-1;i>=0;i--){
    const b=balls[i];
    b.age+=dt;
    if(b.age<0.9){
      b.vy+=1500*dt;
      b.x+=b.vx*dt;
      for(const s of solids){ if(!s.oneWay && ptInRect(b.x,b.y,s)){ b.x-=b.vx*dt; b.vx*=-0.45; break; } }
      b.y+=b.vy*dt;
      for(const s of solids){ if(!s.oneWay && ptInRect(b.x,b.y,s)){ b.y-=b.vy*dt; b.vy*=-0.45; b.vx*=0.96; break; } }
    } else if(b.age<3.9){
      b.sprayT-=dt;
      if(b.sprayT<=0){
        b.sprayT=0.12;
        const base=b.age*4;
        for(let k=0;k<3;k++)
          fireBeam(b.x, b.y, base+k*TAU/3, BALLGUN, 1, {fromBall:true, ballMine:b.owner===MP.you, ballOwner:b.owner, isLocal:false, quiet:true, maxB:BALLGUN.maxB});
        tone('triangle',900+Math.sin(b.age*7)*300,900,0.05,0.1);
      }
    } else {
      explosion(b.x,b.y,'#ff9df5'); shake+=4; sfxKill();
      balls.splice(i,1);
    }
  }
}
function tryBlink(){
  if(buffs.blink<=0 || P.blinkCd>0 || placing || P.deadT>0) return;
  const a=aimAngle(), cx=P.x+P.w/2, cy=P.y+P.h/2;
  const dx=Math.cos(a), dy=Math.sin(a);
  const hit=castSolids(cx,cy,dx,dy,450);
  const d=hit? Math.max(0,hit.t-26) : 450;
  for(let i=0;i<8;i++) particles.push({x:lerp(cx,cx+dx*d,i/8),y:lerp(cy,cy+dy*d,i/8),vx:0,vy:0,life:0.3,max:0.3,color:'#7de8ff',size:6,grav:0,ghost:true});
  P.x=cx+dx*d-P.w/2; P.y=cy+dy*d-P.h/2;
  P.x=clamp(P.x,4,W-P.w-4); P.y=clamp(P.y,4,H-P.h-4);
  P.vy=Math.min(P.vy,0); P.blinkCd=1.2;
  tone('sine',1400,500,0.15,0.3); sparks(P.x+13,P.y+23,'#7de8ff',8,180);
}

// ---------- fx ----------
function sparks(x,y,color,n,spd){
  for(let i=0;i<n;i++){ const a=rnd(TAU), s=rnd(0.3,1)*spd;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-40,life:rnd(0.2,0.5),max:0.5,color,size:rnd(1.5,3),grav:600}); }
  if(particles.length>600) particles.splice(0,particles.length-600);
}
function explosion(x,y,color){
  for(let i=0;i<26;i++){ const a=rnd(TAU), s=rnd(60,380);
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rnd(0.3,0.8),max:0.8,color:i%3?color:'#ffffff',size:rnd(2,5),grav:400}); }
  particles.push({x,y,vx:0,vy:0,life:0.35,max:0.35,color,size:6,ring:true,grav:0});
}
function popup(x,y,text,color,size){ popups.push({x,y,text,color,size,life:0.9,max:0.9}); if(popups.length>70)popups.shift(); }
function announce(text){ announceTxt=text; announceT=1.6; }
function confettiBurst(x,y,n){
  for(let i=0;i<n;i++){
    particles.push({x:x+rnd(-30,30), y:y+rnd(-20,20), vx:rnd(-90,90), vy:rnd(-80,30),
      life:rnd(1,1.9), max:1.9, color:`hsl(${rnd(360)},95%,65%)`, size:rnd(3,5), grav:150, conf:true});
  }
  if(particles.length>800) particles.splice(0,particles.length-800);
}
const STREAK_HYPE={2:'DOUBLE KILL!',3:'TRIPLE KILL!!',4:'QUAD FEVER!',5:'RAMPAGE!!'};
function cheerKill(x,y){
  confettiBurst(x,y,18);
  killFreezeT=0.07; // hitstop
  hypeT=Math.min(hypeT+1.2,3);
  streakN++; streakT=5;
  if(streakN>=2){
    announce(STREAK_HYPE[Math.min(streakN,5)]||'UNSTOPPABLE!!!');
    sting(streakN>=4?'airhorn':'yeah');
  }
}

// ---------- player ----------
function tryDash(){
  if(P.dashCd>0 || P.dashT>0) return; // dashing is allowed in mirror/build mode too
  if(!P.grounded && !P.canAirDash) return;
  let dx=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  let dy=(keys.KeyS?1:0)-(keys.KeyW?1:0);
  if(P.grounded) dy=0; // ground dashes stay on the ground (jump first to dash upward)
  if(!dx && !dy) dx=P.facing;
  const l=Math.hypot(dx,dy)||1;
  P.dashVX=dx/l*920; P.dashVY=dy/l*920;
  P.dashGround=P.grounded;
  P.dashT=0.15; P.dashCd = (buffs.skate>0? 0.6:1)*CLASSES[P.cls].dashCd;
  if(!P.grounded) P.canAirDash=false;
  P.hook=null;
  sfxNoise(0.12,0.25,2400);
}
function hookCast(x,y,dx,dy,maxDist){
  let best=castSolids(x,y,dx,dy,maxDist);
  for(const m of allMirrors()){
    const e=segPts(m);
    const h=raySeg(x,y,dx,dy,e.x1,e.y1,e.x2,e.y2);
    if(h && h.t<=maxDist && (!best||h.t<best.t)) best=h; }
  return best;
}
function tryHook(){
  if(buffs.hook<=0 || placing) return;
  if(P.hook){ P.hook=null; P.airJumps=Math.max(P.airJumps,1); return; }
  const a=aimAngle(), cx=P.x+P.w/2, cy=P.y+P.h/2;
  const dx=Math.cos(a), dy=Math.sin(a);
  const hit=hookCast(cx,cy,dx,dy,1400);
  if(hit){ P.hook={x:cx+dx*hit.t, y:cy+dy*hit.t}; tone('square',1200,600,0.1,0.2); sparks(P.hook.x,P.hook.y,'#ffe14d',6,120); }
  else sfxClink();
}
function updatePlayer(dt){
  if(P.deadT>0){
    P.deadT-=dt;
    if(P.deadT<=0){
      const sp = (MP.on && MP.mode==='vs')? spawns[Math.floor(Math.random()*spawns.length)] : P.spawn;
      P.x=sp.x; P.y=sp.y-(P.h-46); P.vx=P.vy=0; P.hp=P.maxHp; P.invulnT=2;
      P.ammo=GUNS[P.gun].mag; P.reloadT=0;
      if(!MP.on || MP.mode!=='vs') score=Math.max(0,score-200);
    }
    return;
  }
  P.facing = (mouse.x+cam.x > P.x+P.w/2)? 1 : -1;
  const move=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  const gravMul = (buffs.moon>0?0.45:1);
  let maxSpd = (buffs.star>0? 510:415)*CLASSES[P.cls].spd;
  if(buffs.skate>0) maxSpd*=1.25;

  if(P.dashT>0){
    P.dashT-=dt;
    P.vx=P.dashVX;
    if(P.dashGround) P.vy=Math.min(P.vy+GRAV*dt,900); // gravity keeps ground dashes glued (and drops you off ledges)
    else P.vy=P.dashVY;
    if(P.dashT<=0) P.airJumps=Math.max(P.airJumps,1);
    if(Math.random()<0.7) particles.push({x:P.x+P.w/2,y:P.y+P.h/2,vx:0,vy:0,life:0.25,max:0.25,color:buffs.star>0?`hsl(${beatT*400%360},100%,65%)`:'#00ffd9',size:9,grav:0,ghost:true});
  } else {
    const acc = P.grounded?3600:2200;
    const dir=Math.sign(P.vx);
    const over = Math.abs(P.vx)>maxSpd+1; // carrying dash momentum
    if(move && !(over && move===dir)) P.vx += move*acc*dt;
    else if(!move && P.grounded && !over){ const f=2800*dt; if(Math.abs(P.vx)<=f)P.vx=0; else P.vx-=Math.sign(P.vx)*f; }
    else if(!move && !P.grounded && !over) P.vx*=Math.pow(0.3,dt);
    if(over){
      // dash momentum bleeds toward run speed instead of hard-stopping;
      // hold the direction to ride the slide, jump out of it to carry it airborne
      const bleed = (P.grounded? (move===dir? 550:1600) : 300)*dt;
      P.vx -= dir*bleed;
      if(Math.abs(P.vx)<maxSpd) P.vx=dir*maxSpd;
    } else {
      P.vx=clamp(P.vx,-maxSpd,maxSpd);
    }
    let g=GRAV*gravMul;
    if(keys.KeyS && !P.grounded) g*=1.7;
    if(P.hook){
      const dxh=P.hook.x-(P.x+P.w/2), dyh=P.hook.y-(P.y+P.h/2);
      const d=Math.hypot(dxh,dyh);
      if(d<34) { P.hook=null; P.airJumps=Math.max(P.airJumps,1); }
      else {
        P.vx+=dxh/d*2800*dt; P.vy+=dyh/d*2800*dt + g*0.25*dt;
        const sp=Math.hypot(P.vx,P.vy);
        if(sp>980){ P.vx*=980/sp; P.vy*=980/sp; }
      }
    } else if(buffs.jet>0 && keys.Space && !P.grounded){
      P.vy-=3600*dt; if(P.vy<-540)P.vy=-540;
      particles.push({x:P.x+P.w/2+rnd(-5,5),y:P.y+P.h,vx:rnd(-40,40),vy:rnd(120,260),life:0.3,max:0.3,color:Math.random()<0.5?'#ff9d2e':'#ffe14d',size:3,grav:0});
      P.vy=Math.min(P.vy+g*dt,1150);
    } else if((P.wallL||P.wallR)&&P.vy>0&&move!==0) P.vy=Math.min(P.vy+g*dt,240);
    else P.vy=Math.min(P.vy+g*dt,1150);
  }
  P.dashCd-=dt; P.coyote-=dt; P.dropT-=dt; P.blinkCd-=dt; P.spikedT-=dt; P.hurtT-=dt;
  P.contactCd-=dt; P.hazardCd-=dt; P.landLagT-=dt;
  if(P.mCharges<mirrorMax){ P.mRegenT+=dt; if(P.mRegenT>=MIRROR_REGEN){ P.mRegenT=0; P.mCharges++; } }
  else P.mRegenT=0;
  if(!(P.dashT>0 && !P.grounded)) P.jumpBuf-=dt; // air dash: hold the buffered jump until the dash ends

  if(P.jumpBuf>0 && !(P.dashT>0 && !P.grounded) && !(P.grounded && P.landLagT>0)){
    if(P.grounded||P.coyote>0){ P.vy=-680; P.grounded=false; P.coyote=0; P.jumpBuf=0; P.hook=null; P.dashT=0; } // jump cancels dash, momentum rides along
    else if(P.hook){ P.hook=null; P.vy=-580; P.jumpBuf=0; P.airJumps=Math.max(P.airJumps,1); }
    else if(P.wallL){ P.vy=-640; P.vx=440; P.jumpBuf=0; sparks(P.x,P.y+P.h/2,'#00ffd9',5,120); }
    else if(P.wallR){ P.vy=-640; P.vx=-440; P.jumpBuf=0; sparks(P.x+P.w,P.y+P.h/2,'#00ffd9',5,120); }
    else if(buffs.jet>0){ P.jumpBuf=0; }
    else if(P.airJumps>0){ P.airJumps--; P.vy=-620; P.jumpBuf=0; sparks(P.x+P.w/2,P.y+P.h,'#ff3df0',6,140); }
  }

  P.x+=P.vx*dt;
  const box=()=>({x:P.x,y:P.y,w:P.w,h:P.h});
  for(const s of solids){
    if(s.oneWay||s.drop) continue; // semi-solids never block sideways movement
    if(rectsOverlap(box(),s)){
      if(P.vx>0) P.x=s.x-P.w; else if(P.vx<0) P.x=s.x+s.w;
      else P.x = (P.x+P.w/2 < s.x+s.w/2)? s.x-P.w : s.x+s.w;
      P.vx=0; P.dashT=0;
    }
  }
  P.wallL=P.wallR=false;
  for(const s of solids){
    if(s.oneWay||s.drop) continue;
    if(rectsOverlap({x:P.x-2,y:P.y+4,w:2,h:P.h-8},s)) P.wallL=true;
    if(rectsOverlap({x:P.x+P.w,y:P.y+4,w:2,h:P.h-8},s)) P.wallR=true;
  }
  const prevBottom=P.y+P.h;
  P.y+=P.vy*dt;
  const wasGrounded=P.grounded;
  P.grounded=false; P.onOneWay=false;
  for(const s of solids){
    if(!rectsOverlap(box(),s)) continue;
    if(s.oneWay||s.drop){ // land from above only; S drops through
      if(P.vy>=0 && prevBottom<=s.y+1 && P.dropT<=0){ P.y=s.y-P.h; P.vy=0; P.grounded=true; P.onOneWay=true; }
    } else {
      if(P.vy>0){ P.y=s.y-P.h; P.vy=0; P.grounded=true; P.dashT=0; }
      else if(P.vy<0){ P.y=s.y+s.h; P.vy=0; P.dashT=0; }
    }
  }
  if(P.y>H+100){ damagePlayer(999,0,'hazard',-1); } // fell out of the world
  // spiked into the stage: bounce off it like a platformer meteor smash
  if(P.grounded && P.spikedT>0){
    P.grounded=false; P.vy=-300; P.spikedT=0; shake+=6;
    sparks(P.x+P.w/2,P.y+P.h,'#ff4d6d',10,220);
    popup(P.x+P.w/2,P.y-14,'BOING','#ffe14d',12);
    sfxNoise(0.14,0.35,600);
  }
  if(P.grounded && !wasGrounded && buffs.pogo>0 && !keys.KeyS){ // pogo pants: auto-bounce (hold S to stop)
    P.grounded=false; P.vy=-620;
    sparks(P.x+P.w/2,P.y+P.h,'#7dff5e',6,150);
  }
  if(P.grounded && !wasGrounded && P.dashT<=0) P.landLagT=0.1; // landing lag — dashing through the landing skips it
  if(P.grounded){ P.coyote=0.1; P.airJumps=1; P.canAirDash=true; }
  else if(wasGrounded) P.coyote=0.1;
  if(P.wallL||P.wallR) P.canAirDash=true;

  // hazards tick on their own cooldown (the death floor always kills)
  for(const h of hazards){
    if((P.hazardCd>0 || P.invulnT>0) && h.dmg<999) continue;
    let r=null;
    if(h.type==='zone') r={x:h.x,y:h.y,w:h.w,h:h.h};
    else if(h.type==='sweep'){ const sx=sweepX(h); r={x:sx-h.w/2,y:h.y,w:h.w,h:h.h}; }
    if(r && rectsOverlap(box(),r)){ damagePlayer(h.dmg,0,'hazard',-1); P.hazardCd=0.5; break; }
  }

  P.fireCd-=dt; P.gunFlash-=dt;
  const g=effGun(GUNS[P.gun]);
  if(P.reloadT>0){
    P.reloadT-=dt*(buffs.fever>0?1.6:1); // fever fire = fast hands
    if(P.reloadT<=0){ P.ammo=g.mag; sfxUI(920); popup(P.x+P.w/2,P.y-24,'LOADED','#7dff5e',12); }
  }
  if(!placing && P.reloadT<=0){
    if(g.charge){
      if(mouse.down && P.fireCd<=0 && P.ammo>0){ if(P.chargeT<0)P.chargeT=0; P.chargeT+=dt/0.85; if(P.chargeT>1)P.chargeT=1; }
    } else if(mouse.down && P.fireCd<=0 && (g.auto||mouse.pressed)){
      if(P.ammo>0){
        shoot(g, aimAngle(), 1); P.fireCd=1/g.rof;
        P.ammo--;
        if(P.ammo<=0) startReload();
      } else startReload();
    }
  } else if(placing && mouse.pressed){
    tryPlaceMirror();
  }
  mouse.pressed=false;

  P.invulnT-=dt; P.sinceHurt+=dt;
  if(P.sinceHurt>4 && P.hp<P.maxHp) P.hp=Math.min(P.maxHp,P.hp+8*dt);
}
// direction-aware knockback: spiked from above = slammed down (floor-bounce),
// shot from below = launched, side hits = shoved.
// teleport that refuses to strand you inside geometry or off the map
function safePlace(x,y){
  P.x=clamp(x,10,W-P.w-10); P.y=clamp(y,10,H-P.h-10);
  P.vx=P.vy=0; P.dashT=0; P.hook=null;
  for(let i=0;i<40;i++){
    let hit=null;
    for(const s of solids){ if(s.oneWay||s.drop) continue;
      if(rectsOverlap({x:P.x,y:P.y,w:P.w,h:P.h},s)){ hit=s; break; } }
    if(!hit) break;
    P.y=hit.y-P.h-2; // pop on top of whatever we're inside
    if(P.y<10) break;
  }
  let bad=P.y<10;
  if(!bad) for(const s of solids){ if(s.oneWay||s.drop) continue;
    if(rectsOverlap({x:P.x,y:P.y,w:P.w,h:P.h},s)){ bad=true; break; } }
  if(bad){ const sp=spawns[Math.floor(Math.random()*spawns.length)]; P.x=sp.x; P.y=sp.y-(P.h-46); P.vx=P.vy=0; }
}
function hitKnock(dx,dy,dmg,mul){
  const k=clamp(dmg,5,60)*(mul||1);
  if(dy>0.65){
    if(P.grounded){ P.vy=-220; P.vx+=dx*k*6; shake+=4; }
    else{
      P.vy=Math.max(P.vy, 480+k*7); P.vx+=dx*k*6; P.spikedT=1.2;
      popup(P.x+P.w/2,P.y-26,'SPIKED!','#ff4d6d',15);
    }
  } else if(dy<-0.65){
    P.vy=-380-k*6; P.vx+=dx*k*5; P.grounded=false;
  } else {
    P.vx+=dx*k*14; P.vy-=160;
  }
}
function damagePlayer(d,knock,cause,by){
  if(P.deadT>0) return;
  if(buffs.star>0 && d<999) return;
  if(P.dashT>0 && d<999){ popup(P.x+P.w/2,P.y-16,'DODGED!','#00ffd9',13); return; } // dash i-frames
  if(P.invulnT>0 && cause!=='self' && cause!=='ball' && cause!=='hazard') return;
  P.hp-=d; P.sinceHurt=0; shake+=6; sfxHurt();
  P.hurtT=0.3; hurtVigT=0.35;
  sparks(P.x+P.w/2,P.y+P.h/2,'#ff4d6d',10,220);
  if(by!=null && by>=0) lastAttacker=by;
  // no free invulnerability after a hit — contact/hazard sources have their own tick cooldowns
  P.airJumps=1; P.canAirDash=true;
  popup(P.x+P.w/2,P.y-10,'-'+Math.min(d,150),'#ff4d6d',15);
  if(knock && typeof knock==='object') hitKnock(knock.dx||0, knock.dy||0, d, knock.mul||1);
  else if(knock){ P.vx=knock; P.vy=-300; }
  if(P.hp<=0 && buffs.wind>0 && d<999){
    // SECOND WIND: cheat death once
    buffs.wind=0;
    P.hp=Math.max(1,Math.round(P.maxHp*0.25));
    announce('SECOND WIND!');
    sparks(P.x+P.w/2,P.y+P.h/2,'#f0f4ff',16,260);
    sting('wow');
    return;
  }
  if(P.hp<=0){
    P.hp=0; P.deadT= mission? 9e9 : 1.6; P.hook=null;
    explosion(P.x+P.w/2,P.y+P.h/2,myCol()); shake+=10; sfxKill();
    if(mission){ missionFail('YOU GOT DROPPED'); }
    else playOverlay('dead',3);
    if(MP.on && MP.mode==='vs'){
      let deathBy = MP.you; // suicide by default (hazards, bots, own bounces)
      if(cause==='pvp') deathBy = (by!=null&&by>=0)? by : lastAttacker;
      else if(cause==='ball' && by!=null && by>=0 && by!==MP.you) deathBy = by;
      net.send({t:'died', who:MP.you, by:deathBy});
      applyDeath(MP.you, deathBy);
    }
  }
}

// ---------- hazards ----------
function sweepX(h){ return h.x0 + (Math.sin(matchT*h.speed*TAU)*0.5+0.5)*(h.x1-h.x0); }

// ---------- enemies ----------
function losClear(x1,y1,x2,y2){
  const d=Math.hypot(x2-x1,y2-y1); if(d<1) return true;
  const dx=(x2-x1)/d, dy=(y2-y1)/d;
  for(const s of solids){ if(s.oneWay) continue; const h=rayRect(x1,y1,dx,dy,s); if(h&&h.t<d) return false; }
  return true;
}
function nearestTarget(en){
  const cands=[];
  if(P.deadT<=0) cands.push({x:P.x+P.w/2,y:P.y+P.h/2});
  for(let i=0;i<4;i++) if(i!==MP.you && peers[i].on && peers[i].hp>0) cands.push(peerCenter(i));
  for(const d of decoys) cands.push({x:d.x,y:d.y-20});
  let best=null,bd=1e9;
  for(const c of cands){ const d=Math.hypot(c.x-en.x, c.y-(en.y-en.h/2)); if(d<bd){bd=d;best=c;} }
  return best? {x:best.x,y:best.y,d:bd} : null;
}
function updateEnemiesHost(dt){
  for(const en of enemies){
    if(en.dead){ if(mission) continue; // missions: kills are permanent
      en.respawnT-=dt; if(en.respawnT<=0){ en.dead=false; en.hp=en.maxHp; en.x=en.sx; en.y=en.sy; } continue; }
    if(en.type==='bot'){
      en.x+=en.dir*60*dt;
      if(en.x<en.patrolL){en.x=en.patrolL;en.dir=1;}
      if(en.x>en.patrolR){en.x=en.patrolR;en.dir=-1;}
      en.shootT-=dt;
      const tgt=nearestTarget(en);
      if(en.shootT<=0 && tgt && tgt.d<950 && losClear(en.x,en.y-en.h+10,tgt.x,tgt.y)){
        const a=Math.atan2(tgt.y-(en.y-en.h+10), tgt.x-en.x);
        const o={x:en.x,y:en.y-en.h+10,vx:Math.cos(a)*300,vy:Math.sin(a)*300,life:5};
        orbs.push(o);
        net.send({t:'orb', x:Math.round(o.x), y:Math.round(o.y), vx:Math.round(o.vx), vy:Math.round(o.vy)});
        en.shootT=2.2+rnd(1.4);
        tone('sine',900,300,0.15,0.15);
      }
    } else {
      en.spin+=dt*1.5;
    }
  }
}
function updateEnemiesClient(dt){
  for(const en of enemies){
    if(en.dead) continue;
    if(en.type==='bot' && en.tx!=null) en.x=lerp(en.x,en.tx,1-Math.pow(0.0001,dt));
    if(en.type==='prism') en.spin+=dt*1.5;
  }
}
function updateEnemyContact(){
  if(P.deadT>0 || P.contactCd>0) return;
  for(const en of enemies){
    if(en.dead || en.type!=='bot') continue;
    if(rectsOverlap({x:P.x,y:P.y,w:P.w,h:P.h},{x:en.x-en.w/2,y:en.y-en.h,w:en.w,h:en.h})){
      damagePlayer(20, Math.sign(P.x+P.w/2-en.x)*400, 'bot', -1);
      P.contactCd=0.8;
      break;
    }
  }
}
function updateOrbs(dt){
  for(let i=orbs.length-1;i>=0;i--){
    const o=orbs[i];
    o.x+=o.vx*dt; o.y+=o.vy*dt; o.life-=dt; o.rcd=(o.rcd||0)-dt;
    // mirrors deflect enemy fire — a reflected orb turns friendly and can smack bots
    if(o.rcd<=0) for(const m of allMirrors()){
      const e=segPts(m);
      const sdx=e.x2-e.x1, sdy=e.y2-e.y1, L2=sdx*sdx+sdy*sdy||1;
      let u=((o.x-e.x1)*sdx+(o.y-e.y1)*sdy)/L2; u=clamp(u,0,1);
      const px=e.x1+u*sdx, py=e.y1+u*sdy;
      const ddx=o.x-px, ddy=o.y-py, d2=ddx*ddx+ddy*ddy;
      if(d2<121){
        let nx=-sdy, ny=sdx; const nl=Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
        if(nx*o.vx+ny*o.vy>0){ nx=-nx; ny=-ny; }
        const dot=o.vx*nx+o.vy*ny;
        o.vx-=2*dot*nx; o.vy-=2*dot*ny;
        const dd=Math.sqrt(d2)||1;
        o.x=px+(ddx/dd)*12; o.y=py+(ddy/dd)*12;
        o.reflected=true; o.rcd=0.12; o.life=Math.max(o.life,2.5);
        sparks(o.x,o.y,'#7de8ff',6,150); sfxBounce(1);
        break;
      }
    }
    let kill=o.life<=0;
    if(!kill) for(const s of solids){ if(!s.oneWay&&ptInRect(o.x,o.y,s)){kill=true;break;} }
    // reflected orbs damage enemies (host applies, same authority as lasers);
    // deflecting one into a prism counts as its required bounce
    if(!kill && o.reflected && (MP.isHost||!MP.on)) for(const en of enemies){
      if(en.dead) continue;
      const ex=en.x, ey=en.type==='prism'? en.y : en.y-en.h/2;
      const rr=en.type==='prism'? en.r+7 : 24;
      if(Math.hypot(o.x-ex,o.y-ey)<rr){
        damageEnemy(en, 18, en.type==='prism'? en.minB:1, o.x, o.y);
        kill=true; break;
      }
    }
    if(!kill && P.deadT<=0 && o.x>P.x-7&&o.x<P.x+P.w+7&&o.y>P.y-7&&o.y<P.y+P.h+7){
      const om=Math.hypot(o.vx,o.vy)||1;
      damagePlayer(12,{dx:o.vx/om,dy:o.vy/om},'orb',-1); kill=true;
    }
    if(kill){ sparks(o.x,o.y,o.reflected?'#7de8ff':'#ff9d2e',5,120); orbs.splice(i,1); }
  }
}
function applyEsnap(m){
  if(MP.isHost) return;
  score=m.sc; kills=m.k; if(m.bb>bestBounce) bestBounce=m.bb;
  for(const e of m.e){
    const en=enemies[e[0]]; if(!en) continue;
    const wasDead=en.dead, dead=!!e[4];
    en.tx=e[1]; en.dir=e[2]; en.hp=e[3];
    if(dead&&!wasDead){
      explosion(en.x, en.type==='prism'?en.y:en.y-en.h/2, en.type==='prism'?'#7de8ff':'#ff3df0');
      sfxKill();
    }
    if(!dead&&wasDead){ en.x=en.sx; en.tx=en.sx; }
    en.dead=dead;
  }
}

// ---------- main update ----------
let lastT=performance.now();
function update(dt){
  beatT+=dt;
  musicTick(dt);
  if(musicActive()) beatT=music.main.el.currentTime; // visuals dance to the actual track
  if(state==='browse'){ // keep the party list fresh even if a push gets lost
    browsePollT-=dt;
    if(browsePollT<=0){ browsePollT=3; net.raw({t:'list'}); }
  }
  if(state!=='play'||paused) return;
  if(killFreezeT>0){ killFreezeT-=dt; return; } // hitstop: the world savors the kill
  streakT-=dt; if(streakT<=0) streakN=0;
  if(matchEndT>0){
    matchEndT-=dt;
    if(Math.random()<0.35) confettiBurst(cam.x+rnd(VW), cam.y+rnd(-40,0), 2); // podium confetti rain
    if(matchEndT<=0 && MP.on && MP.isHost) net.raw({t:'rematch'}); // everyone back to the lobby
  }
  matchT+=dt;
  helpT-=dt; announceT-=dt; escT-=dt; hurtVigT-=dt; shake=Math.max(0,shake-dt*22);

  updatePlayer(dt);
  if(MP.isHost || !MP.on) updateEnemiesHost(dt);
  else updateEnemiesClient(dt);
  updateEnemyContact();
  updateOrbs(dt);
  updateLoot(dt);
  updateBalls(dt);
  missionTick(dt);
  // DISCO BUDDY: orbiting turret that pot-shots the nearest target
  if(buffs.orbit>0 && P.deadT<=0){
    orbitA+=dt*2.6; orbitFT-=dt;
    const ox=P.x+P.w/2+Math.cos(orbitA)*70, oy=P.y+P.h/2+Math.sin(orbitA)*70;
    if(orbitFT<=0){
      let bt=null,bd=700;
      for(const en of enemies){ if(en.dead) continue;
        const ex=en.x, ey=en.type==='prism'?en.y:en.y-en.h/2;
        const d0=Math.hypot(ex-ox,ey-oy); if(d0<bd){bd=d0;bt={x:ex,y:ey};} }
      if(MP.on && MP.mode==='vs') for(let oi=0;oi<4;oi++){
        if(oi===MP.you || !peers[oi].on || peers[oi].hp<=0) continue;
        const pc0=peerCenter(oi); const d0=Math.hypot(pc0.x-ox,pc0.y-oy);
        if(d0<bd){bd=d0;bt=pc0;} }
      if(bt){ orbitFT=0.7; fireBeam(ox,oy,Math.atan2(bt.y-oy,bt.x-ox),BALLGUN,1,{isLocal:true,maxB:2,quiet:true}); tone('triangle',1100,1500,0.06,0.12); }
      else orbitFT=0.3;
    }
  }
  for(const pr of props) pr.cdT-=dt;
  hypeT=Math.max(0,hypeT-dt);

  for(const p of peers){
    if(!p.on) continue;
    p.x=lerp(p.x,p.tx,1-Math.pow(0.000005,dt));
    p.y=lerp(p.y,p.ty,1-Math.pow(0.000005,dt));
    p.gunFlash-=dt; p.hurtT-=dt;
  }
  if(MP.on){
    psT-=dt;
    if(psT<=0){
      psT=0.05;
      net.send({t:'ps', who:MP.you, x:Math.round(P.x), y:Math.round(P.y), vx:Math.round(P.vx),
        f:P.facing, a:+aimAngle().toFixed(2), g:P.gun, hp:Math.round(P.deadT>0?0:P.hp),
        s:buffs.star>0?1:0, su:buffs.suit>0?1:0, hk:P.hook?[Math.round(P.hook.x),Math.round(P.hook.y)]:0,
        dsh:P.dashT>0?1:0, gh:buffs.ghost>0?1:0, tn:buffs.tiny>0?1:0, cls:P.cls, col:myColor});
    }
    if(MP.isHost){
      esnapT-=dt;
      if(esnapT<=0){
        esnapT=0.08;
        net.send({t:'esnap', sc:score, k:kills, bb:bestBounce,
          e:enemies.map((en,i)=>[i,Math.round(en.x),en.dir||1,Math.round(en.hp),en.dead?1:0])});
      }
    }
  }

  if(demoT>0){
    demoT-=dt;
    let best=null,bd=1e9; const pcx=P.x+P.w/2,pcy=P.y+P.h/2;
    for(const m of allMirrors()){ const d=Math.hypot(m.x-pcx,m.y-pcy); if(d<bd){bd=d;best=m;} }
    if(best && P.fireCd<=0){ shoot(GUNS[0], Math.atan2(best.y-pcy,best.x-pcx), 1); P.fireCd=0.16; }
  }

  for(let i=beams.length-1;i>=0;i--){ beams[i].life-=dt; if(beams[i].life<=0) beams.splice(i,1); }
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i];
    p.life-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=(p.grav||0)*dt;
    if(p.life<=0) particles.splice(i,1); }
  for(let i=popups.length-1;i>=0;i--){ const p=popups[i]; p.life-=dt; p.y-=40*dt; if(p.life<=0) popups.splice(i,1); }

  const tx=clamp(P.x+P.w/2-VW/2+(mouse.x-VW/2)*0.12, 0, Math.max(0,W-VW));
  const ty=clamp(P.y+P.h/2-VH/2+(mouse.y-VH/2)*0.08, 0, Math.max(0,H-VH));
  cam.x=lerp(cam.x,tx,1-Math.pow(0.001,dt));
  cam.y=lerp(cam.y,ty,1-Math.pow(0.001,dt));
}

// ---------- render ----------
function beatPulse(){ const ph=(beatT*BPM/60)%1; return Math.max(0,1-ph*3); }
function drawBg(){
  const pulse=beatPulse();
  const grad=ctx.createLinearGradient(0,0,0,VH);
  grad.addColorStop(0,'#0b0218'); grad.addColorStop(0.6,'#1a0530'); grad.addColorStop(1,'#2b0a3d');
  ctx.fillStyle=grad; ctx.fillRect(0,0,VW,VH);
  for(let i=0;i<70;i++){
    const x=(sr(i)*4200-cam.x*0.1)%(VW+40)-20, y=sr(i+99)*VH*0.7;
    ctx.globalAlpha=0.3+0.5*sr(i+7)*(0.6+0.4*Math.sin(beatT*2+i));
    ctx.fillStyle='#cfe8ff'; ctx.fillRect(((x%(VW+40))+VW+40)%(VW+40)-20,y,2,2);
  }
  ctx.globalAlpha=1;
  const sx=VW*0.72-cam.x*0.05, sy=200-cam.y*0.04, sr0=110*(1+0.04*pulse);
  const sg=ctx.createRadialGradient(sx,sy,10,sx,sy,sr0*2.2);
  sg.addColorStop(0,'rgba(255,61,240,0.8)'); sg.addColorStop(0.5,'rgba(255,61,240,0.15)'); sg.addColorStop(1,'rgba(255,61,240,0)');
  ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(sx,sy,sr0*2.2,0,TAU); ctx.fill();
  ctx.fillStyle='#ff3df0'; ctx.beginPath(); ctx.arc(sx,sy,sr0,0,TAU); ctx.fill();
  ctx.fillStyle='#1a0530';
  for(let i=0;i<6;i++) ctx.fillRect(sx-sr0,sy+10+i*14,sr0*2,4+i);
  for(const [p,col,hb] of [[0.25,'#160a2e',300],[0.45,'#211042',210]]){
    const sy2=1380-cam.y*p-(1-p)*430;
    ctx.fillStyle=col;
    const sp=110;
    const i0=Math.floor(cam.x*p/sp)-1;
    for(let i=i0;i<i0+VW/sp+3;i++){
      const bx=i*sp-cam.x*p, bh=60+sr(i*3+p*10)*hb, bw=sp*(0.55+0.35*sr(i+5));
      ctx.fillRect(bx,sy2-bh,bw,bh+600);
      if(sr(i+2)>0.6){
        ctx.fillStyle='#0b0218';
        ctx.beginPath(); ctx.moveTo(bx,sy2-bh); ctx.lineTo(bx+bw*0.5,sy2-bh+22); ctx.lineTo(bx+bw,sy2-bh); ctx.closePath(); ctx.fill();
        ctx.fillStyle=col;
      }
      if(sr(i+31)>0.4){ ctx.fillStyle=`hsla(${(i*47)%360},90%,60%,${0.25+0.3*pulse})`;
        ctx.fillRect(bx+bw*0.3,sy2-bh*0.6,4,4); ctx.fillRect(bx+bw*0.6,sy2-bh*0.35,4,4); ctx.fillStyle=col; }
    }
  }
}
function strokePoly(pts){
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
}
function drawHpBar(x,y,w,f){
  if(f>=1) return;
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(x,y,w,5);
  ctx.fillStyle= f>0.5? '#7dff5e' : f>0.25? '#ffe14d':'#ff4d6d';
  ctx.fillRect(x+1,y+1,(w-2)*clamp(f,0,1),3);
}
function drawHazards(){
  const pulse=beatPulse();
  for(const h of hazards){
    if(h.type==='zone'){
      const deadly=h.dmg>=999;
      ctx.fillStyle=`rgba(255,${deadly?30:80},60,${0.16+0.14*pulse})`;
      ctx.fillRect(h.x,h.y,h.w,h.h);
      if(deadly){
        const g2=ctx.createLinearGradient(0,h.y-120,0,h.y);
        g2.addColorStop(0,'rgba(255,40,60,0)'); g2.addColorStop(1,`rgba(255,40,60,${0.25+0.1*pulse})`);
        ctx.fillStyle=g2; ctx.fillRect(h.x,h.y-120,h.w,120);
      }
      ctx.strokeStyle=`rgba(255,80,80,${0.6+0.3*pulse})`; ctx.lineWidth=2;
      ctx.setLineDash([12,8]); ctx.lineDashOffset=-beatT*40;
      ctx.beginPath(); ctx.moveTo(h.x,h.y); ctx.lineTo(h.x+h.w,h.y); ctx.stroke(); ctx.setLineDash([]);
    } else if(h.type==='sweep'){
      const sx=sweepX(h);
      ctx.save();
      ctx.shadowColor='#ff4d4d'; ctx.shadowBlur=20;
      ctx.fillStyle=`rgba(255,60,60,${0.35+0.2*pulse})`;
      ctx.fillRect(sx-h.w/2,h.y,h.w,h.h);
      ctx.fillStyle='#ffd0d0';
      ctx.fillRect(sx-2,h.y,4,h.h);
      ctx.restore();
      if(Math.random()<0.4) sparks(sx+rnd(-6,6), h.y+h.h-4, '#ff6b6b', 1, 90);
    }
  }
}
function drawWorld(){
  const pulse=beatPulse();
  ctx.save();
  ctx.translate(-Math.round(cam.x+rnd(-shake,shake)), -Math.round(cam.y+rnd(-shake,shake)));

  for(let si=0;si<solids.length;si++){
    const s=solids[si];
    if(s.x<-100||s.x>=W+1) continue;
    if(s.oneWay){
      ctx.fillStyle='rgba(0,255,217,0.25)';
      ctx.fillRect(s.x,s.y,s.w,s.h);
      ctx.fillStyle='#00ffd9';
      for(let x=s.x;x<s.x+s.w;x+=14) ctx.fillRect(x,s.y,7,3);
      continue;
    }
    ctx.fillStyle='#160f2e';
    ctx.fillRect(s.x,s.y,s.w,s.h);
    ctx.strokeStyle='rgba(120,80,255,0.35)'; ctx.lineWidth=2;
    ctx.strokeRect(s.x+1,s.y+1,s.w-2,s.h-2);
    if(s.drop){
      // droppable: dashed underside + down-chevrons (press S to fall through)
      ctx.strokeStyle='rgba(0,255,217,0.45)'; ctx.lineWidth=1.5;
      ctx.setLineDash([7,6]); ctx.lineDashOffset=-beatT*20;
      ctx.beginPath(); ctx.moveTo(s.x+4,s.y+s.h-3); ctx.lineTo(s.x+s.w-4,s.y+s.h-3); ctx.stroke();
      ctx.setLineDash([]);
      for(let x=s.x+30;x<s.x+s.w-20;x+=80){
        ctx.beginPath(); ctx.moveTo(x-4,s.y+s.h-9); ctx.lineTo(x,s.y+s.h-5); ctx.lineTo(x+4,s.y+s.h-9); ctx.stroke();
      }
    }
    if(s.floor){
      const beatCount=Math.floor(beatT*BPM/60);
      const hypeMul=1+Math.min(hypeT,2)*0.55; // stingers crank the dancefloor
      for(let x=s.x;x<s.x+s.w;x+=90){
        const i=Math.floor(x/90);
        const hot=(i+beatCount)%4===0;
        ctx.fillStyle=`hsla(${(i*47+beatT*40)%360},95%,60%,${Math.min(0.85,(hot?0.25+0.5*pulse:0.18)*hypeMul)})`;
        ctx.fillRect(x,s.y,86,8);
      }
    } else {
      ctx.fillStyle=`hsla(${(si*70+beatT*30)%360},90%,65%,${0.5+0.3*pulse})`;
      ctx.fillRect(s.x,s.y,s.w,3);
    }
  }

  drawHazards();

  for(const m of allMirrors()){
    const e=segPts(m);
    ctx.save();
    ctx.shadowColor = m.player? '#7dff5e' : '#9ddcff';
    ctx.shadowBlur = 12+8*pulse;
    ctx.strokeStyle = m.player? '#c9ffb8' : '#e8f7ff';
    ctx.lineWidth=5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(e.x1,e.y1); ctx.lineTo(e.x2,e.y2); ctx.stroke();
    const sh=(beatT*0.7+m.x*0.01)%1;
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2;
    const ax=lerp(e.x1,e.x2,clamp(sh-0.08,0,1)), ay=lerp(e.y1,e.y2,clamp(sh-0.08,0,1));
    const bx=lerp(e.x1,e.x2,clamp(sh,0,1)), by=lerp(e.y1,e.y2,clamp(sh,0,1));
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    if(m.player && m.hp!=null && m.hp<MIRROR_HP){
      // cracks grow as the mirror's HP drains
      ctx.strokeStyle='rgba(20,30,40,0.9)'; ctx.lineWidth=1.5;
      const cracks=1+Math.floor((1-Math.max(0,m.hp)/MIRROR_HP)*3);
      for(let k=0;k<cracks;k++){
        const u=0.2+0.6*sr(k*7+m.x);
        const mx=lerp(e.x1,e.x2,u), my=lerp(e.y1,e.y2,u);
        ctx.beginPath(); ctx.moveTo(mx-7,my-6+k); ctx.lineTo(mx,my); ctx.lineTo(mx-2,my+7-k);
        ctx.moveTo(mx+2,my-7); ctx.lineTo(mx+1,my-1); ctx.lineTo(mx+8,my+4); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.fillStyle = m.player? '#7dff5e' : '#6db6ff';
    ctx.fillRect(e.x1-3,e.y1-3,6,6); ctx.fillRect(e.x2-3,e.y2-3,6,6);
  }

  for(let i=0;i<loot.length;i++){
    const b=loot[i];
    if(!b.active) continue;
    const bob=Math.sin(beatT*2+i)*5;
    ctx.save(); ctx.translate(b.x,b.y+bob); ctx.rotate(beatT*1.2+i);
    const hue=(beatT*90+i*40)%360;
    ctx.shadowColor=`hsl(${hue},100%,65%)`; ctx.shadowBlur=16;
    ctx.fillStyle=`hsla(${hue},90%,55%,0.25)`;
    ctx.strokeStyle=`hsl(${hue},100%,70%)`; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.rect(-14,-14,28,28); ctx.fill(); ctx.stroke();
    ctx.rotate(-(beatT*1.2+i));
    ctx.fillStyle='#fff'; ctx.font='bold 18px Segoe UI'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('?',0,1);
    ctx.textBaseline='alphabetic';
    ctx.restore();
  }

  // hype speakers
  for(const pr of props){
    const d=STING_DEFS[pr.kind];
    const ready=pr.cdT<=0;
    ctx.save(); ctx.translate(pr.x,pr.y);
    ctx.globalAlpha= ready? 1:0.4;
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(0,-52); ctx.stroke();
    ctx.shadowColor=d.color; ctx.shadowBlur= ready? 14+10*pulse : 4;
    ctx.fillStyle='#161028';
    ctx.beginPath(); ctx.roundRect(-19,-14,38,28,6); ctx.fill();
    ctx.strokeStyle=d.color; ctx.lineWidth=2; ctx.stroke();
    ctx.shadowBlur=0;
    const k= ready? 1+0.15*pulse : 1;
    ctx.strokeStyle=d.color;
    ctx.beginPath(); ctx.arc(-8,0,5*k,0,TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(7,0,3.5*k,0,TAU); ctx.stroke();
    ctx.fillStyle=d.color; ctx.font='bold 10px Segoe UI'; ctx.textAlign='center';
    ctx.fillText(d.label, 0, 28);
    if(!ready){
      ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,22,-Math.PI/2,-Math.PI/2+TAU*(1-pr.cdT/2.5)); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha=1;

  for(const en of enemies){
    if(en.dead) continue;
    const dance=1+0.1*pulse*Math.sin(en.seed*9);
    if(en.type==='bot'){
      const bx=en.x, by=en.y;
      ctx.save(); ctx.translate(bx,by); ctx.scale(2-dance,dance);
      ctx.shadowColor='#ff3df0'; ctx.shadowBlur=10;
      ctx.fillStyle='#2a1140';
      ctx.beginPath(); ctx.roundRect(-en.w/2,-en.h,en.w,en.h-6,6); ctx.fill();
      ctx.strokeStyle='#ff3df0'; ctx.lineWidth=2; ctx.stroke();
      ctx.shadowBlur=0;
      ctx.fillStyle='#ff3df0';
      ctx.fillRect(en.dir>0?-2:-en.w/2+4, -en.h+9, en.w/2-2, 6);
      ctx.strokeStyle='#ffe14d'; ctx.beginPath(); ctx.moveTo(0,-en.h); ctx.lineTo(0,-en.h-9); ctx.stroke();
      ctx.fillStyle='#ffe14d'; ctx.beginPath(); ctx.arc(0,-en.h-11,3,0,TAU); ctx.fill();
      const ph=Math.sin(beatT*10+en.seed)*4;
      ctx.strokeStyle='#ff3df0';
      ctx.beginPath(); ctx.moveTo(-7,-6); ctx.lineTo(-7+ph,0); ctx.moveTo(7,-6); ctx.lineTo(7-ph,0); ctx.stroke();
      ctx.restore();
      drawHpBar(bx-20,by-en.h-14,40,en.hp/en.maxHp);
    } else {
      const py=en.y+Math.sin(beatT*2+en.seed)*7;
      ctx.save(); ctx.translate(en.x,py); ctx.rotate(en.spin);
      ctx.shadowColor = en.minB>=2? '#ffe14d':'#7de8ff'; ctx.shadowBlur=16;
      ctx.fillStyle = en.minB>=2? '#4d3b00':'#0a3547';
      ctx.strokeStyle = en.minB>=2? '#ffe14d':'#7de8ff'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(0,-en.r); ctx.lineTo(en.r,0); ctx.lineTo(0,en.r); ctx.lineTo(-en.r,0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(en.x,py);
      ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2; ctx.setLineDash([8,7]); ctx.lineDashOffset=-beatT*30;
      ctx.beginPath(); ctx.arc(0,0,en.r+9,0,TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      drawHpBar(en.x-20,py-en.r-18,40,en.hp/en.maxHp);
      ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='10px Segoe UI'; ctx.textAlign='center';
      ctx.fillText('BOUNCE x'+en.minB+'+', en.x, py+en.r+22);
    }
  }

  for(const o of orbs){
    ctx.shadowColor= o.reflected? '#00ffd9':'#ff9d2e'; ctx.shadowBlur=12;
    ctx.fillStyle= o.reflected? '#9ffcef':'#ffcf7a'; ctx.beginPath(); ctx.arc(o.x,o.y,6,0,TAU); ctx.fill();
    ctx.shadowBlur=0;
  }

  for(const b of balls){
    const spraying=b.age>=0.9;
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.age*4);
    const hue=(beatT*200)%360;
    ctx.shadowColor=`hsl(${hue},100%,70%)`; ctx.shadowBlur=spraying?22:10;
    ctx.fillStyle='#cfd8ea';
    ctx.beginPath(); ctx.arc(0,0,10,0,TAU); ctx.fill();
    ctx.strokeStyle='rgba(60,70,110,0.8)'; ctx.lineWidth=1;
    for(let k=-6;k<=6;k+=4){ ctx.beginPath(); ctx.moveTo(k,-10); ctx.lineTo(k,10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-10,k); ctx.lineTo(10,k); ctx.stroke(); }
    ctx.restore();
  }

  // disco buddy turret
  if(buffs.orbit>0 && P.deadT<=0){
    const ox=P.x+P.w/2+Math.cos(orbitA)*70, oy=P.y+P.h/2+Math.sin(orbitA)*70;
    ctx.save(); ctx.translate(ox,oy); ctx.rotate(orbitA*2);
    ctx.shadowColor='#ff9df5'; ctx.shadowBlur=12;
    ctx.fillStyle='#cfd8ea'; ctx.beginPath(); ctx.arc(0,0,7,0,TAU); ctx.fill();
    ctx.strokeStyle='rgba(60,70,110,0.8)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-7,0); ctx.lineTo(7,0); ctx.moveTo(0,-7); ctx.lineTo(0,7); ctx.stroke();
    ctx.restore();
  }

  // decoys — holographic dancers
  for(const d of decoys){
    const dc=CLASSES[d.cls||0];
    ctx.globalAlpha=0.55+0.2*Math.sin(beatT*8+d.seed);
    drawDancer(d.x-dc.w/2, d.y-dc.h-Math.abs(Math.sin(beatT*4+d.seed))*10, Math.sin(beatT*2+d.seed)>0?1:-1, Math.sin(beatT*3+d.seed), dc.gun, (d.col!=null?COLORS[d.col]:PCOLS[d.who])||'#ff4dd2', true, false, 100, 'P'+(d.who+1)+'?', d.cls||0);
    ctx.globalAlpha=1;
  }

  // peers
  for(let i=0;i<4;i++){
    const p=peers[i];
    if(i===MP.you || !p.on || p.hp<=0) continue;
    const pc=peerCls(i);
    if(p.dsh) drawDashShell(p.x+pc.w/2, p.y+pc.h/2, pc.w, pc.h);
    const pcol = (p.hurtT>0 && Math.floor(beatT*24)%2===0)? '#ffffff' : peerColor(i);
    if(p.gh) ctx.globalAlpha=0.15; // smoke machine: barely there
    if(p.tn){
      const fx=p.x+pc.w*0.31, fy=p.y+pc.h*0.62; // their synced x/y is the shrunk box
      ctx.save(); ctx.translate(fx,fy); ctx.scale(0.62,0.62); ctx.translate(-fx,-fy);
      drawDancer(fx-pc.w/2, fy-pc.h, p.facing, p.aim, p.gun, pcol, p.star>0||p.suit>0, p.gunFlash>0, p.vx, null, p.cls||0);
      ctx.restore();
      ctx.globalAlpha=1;
      ctx.fillStyle=pcol; ctx.font='bold 11px Segoe UI'; ctx.textAlign='center';
      ctx.fillText('P'+(i+1), p.x+pc.w*0.31, p.y-8);
    } else {
      drawDancer(p.x, p.y, p.facing, p.aim, p.gun, pcol, p.star>0||p.suit>0, p.gunFlash>0, p.vx, 'P'+(i+1), p.cls||0);
    }
    ctx.globalAlpha=1;
    if(p.suit>0){
      ctx.strokeStyle='rgba(232,247,255,0.8)'; ctx.lineWidth=2; ctx.setLineDash([4,4]); ctx.lineDashOffset=-beatT*20;
      ctx.strokeRect(p.x-4,p.y-4,pc.w+8,pc.h+8); ctx.setLineDash([]);
    }
    if(p.hook){
      ctx.strokeStyle='rgba(255,225,77,0.7)'; ctx.setLineDash([6,5]); ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(p.x+pc.w/2,p.y+pc.h/2); ctx.lineTo(p.hook[0],p.hook[1]); ctx.stroke(); ctx.setLineDash([]);
    }
    if(p.hp<peerMaxHp(i)) drawHpBar(p.x+pc.w/2-20,p.y-14,40,p.hp/peerMaxHp(i));
  }

  if(P.hook && P.deadT<=0){
    ctx.strokeStyle='rgba(255,225,77,0.9)'; ctx.setLineDash([6,5]); ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(P.x+P.w/2,P.y+P.h/2); ctx.lineTo(P.hook.x,P.hook.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#ffe14d'; ctx.beginPath(); ctx.arc(P.hook.x,P.hook.y,4,0,TAU); ctx.fill();
  }

  // laser sight — drawn only on YOUR screen; never sent to anyone
  if(sightOn && state==='play' && !placing && P.deadT<=0){
    const s=traceSight();
    ctx.save();
    ctx.setLineDash([5,9]); ctx.lineDashOffset=-beatT*60;
    ctx.strokeStyle=s.color; ctx.globalAlpha=0.22; ctx.lineWidth=1.5;
    strokePoly(s.pts);
    ctx.setLineDash([]);
    for(let i=1;i<s.pts.length-1;i++){
      ctx.globalAlpha=0.5; ctx.fillStyle=s.color;
      ctx.beginPath(); ctx.arc(s.pts[i].x,s.pts[i].y,3,0,TAU); ctx.fill();
    }
    const end=s.pts[s.pts.length-1];
    if(s.endKind==='self'){
      ctx.globalAlpha=0.9; ctx.strokeStyle='#ff4d6d'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(end.x-6,end.y-6); ctx.lineTo(end.x+6,end.y+6); ctx.moveTo(end.x+6,end.y-6); ctx.lineTo(end.x-6,end.y+6); ctx.stroke();
      ctx.fillStyle='#ff4d6d'; ctx.font='bold 10px Segoe UI'; ctx.textAlign='center'; ctx.fillText('YOU!',end.x,end.y-10);
    } else if(s.endKind==='enemy'||s.endKind==='player'||s.endKind==='prop'){
      ctx.globalAlpha=0.8; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(end.x,end.y,6,0,TAU); ctx.stroke();
    }
    ctx.restore(); ctx.globalAlpha=1;
  }

  if(P.deadT<=0){
    if(P.dashT>0) drawDashShell(P.x+P.w/2, P.y+P.h/2, P.w, P.h);
    if(P.invulnT>0 && Math.floor(beatT*14)%2===0) ctx.globalAlpha=0.35;
    if(buffs.ghost>0) ctx.globalAlpha*=0.5; // you can still see yourself, faintly
    const lcol = (P.hurtT>0 && Math.floor(beatT*24)%2===0)? '#ffffff' : myCol();
    const C0=CLASSES[P.cls];
    if(buffs.tiny>0){
      const fx=P.x+P.w/2, fy=P.y+P.h;
      ctx.save(); ctx.translate(fx,fy); ctx.scale(0.62,0.62); ctx.translate(-fx,-fy);
      drawDancer(fx-C0.w/2, fy-C0.h, P.facing, aimAngle(), P.gun, lcol, buffs.star>0||buffs.suit>0, P.gunFlash>0, P.vx, null, P.cls);
      ctx.restore();
    } else {
      drawDancer(P.x, P.y, P.facing, aimAngle(), P.gun, lcol, buffs.star>0||buffs.suit>0, P.gunFlash>0, P.vx, MP.on?'YOU':null, P.cls);
    }
    ctx.globalAlpha=1;
    if(buffs.suit>0){
      ctx.strokeStyle='rgba(232,247,255,0.85)'; ctx.lineWidth=2; ctx.setLineDash([4,4]); ctx.lineDashOffset=-beatT*20;
      ctx.strokeRect(P.x-4,P.y-4,P.w+8,P.h+8); ctx.setLineDash([]);
    }
    if(P.chargeT>=0){
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(P.x-11,P.y-16,48,7);
      ctx.fillStyle=GUNS[P.gun].color; ctx.fillRect(P.x-10,P.y-15,46*clamp(P.chargeT,0,1),5);
    }
    if(roul.active){
      const nm=POWERUPS[Math.floor(roul.t*14)%POWERUPS.length].short;
      ctx.font='bold 15px Segoe UI'; ctx.textAlign='center';
      ctx.fillStyle=`hsl(${beatT*500%360},100%,70%)`;
      ctx.fillText('[ '+nm+' ]', P.x+P.w/2, P.y-26);
    }
  }

  ctx.globalCompositeOperation='lighter';
  for(const b of beams){
    const a=b.life/b.max;
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle=b.color; ctx.globalAlpha=a*0.5; ctx.lineWidth=b.w*3.2;
    strokePoly(b.pts);
    ctx.globalAlpha=a; ctx.lineWidth=b.w;
    strokePoly(b.pts);
    ctx.strokeStyle='#ffffff'; ctx.globalAlpha=a*0.9; ctx.lineWidth=Math.max(1,b.w*0.4);
    strokePoly(b.pts);
  }
  ctx.globalAlpha=1;
  for(const p of particles){
    const a=p.life/p.max;
    if(p.ring){ ctx.strokeStyle=p.color; ctx.globalAlpha=a; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,(1-a)*280*(p.max||0.35)+8,0,TAU); ctx.stroke(); continue; }
    if(p.conf){
      ctx.fillStyle=p.color; ctx.globalAlpha=a;
      const wob=Math.sin(p.life*7+p.size)*6;
      ctx.fillRect(p.x+wob-p.size/2, p.y-p.size*0.3, p.size, p.size*0.6);
      continue;
    }
    ctx.fillStyle=p.color; ctx.globalAlpha= p.ghost? a*0.35 : a;
    ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
  }
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';

  for(const p of popups){
    ctx.globalAlpha=clamp(p.life/p.max*1.4,0,1);
    ctx.font='bold '+p.size+'px Segoe UI'; ctx.textAlign='center';
    ctx.fillStyle='#000'; ctx.fillText(p.text,p.x+1,p.y+1);
    ctx.fillStyle=p.color; ctx.fillText(p.text,p.x,p.y);
  }
  ctx.globalAlpha=1;

  if(placing||rmbGhost){
    const mx=mouse.x+cam.x, my=mouse.y+cam.y;
    const ok=ghostValid(mx,my) && P.mCharges>=1;
    const e=segPts({x:mx,y:my,angle:ghostAngle,len:90});
    ctx.setLineDash([7,6]);
    ctx.strokeStyle= ok? 'rgba(125,255,94,0.9)':'rgba(255,77,109,0.9)';
    ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(e.x1,e.y1); ctx.lineTo(e.x2,e.y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='11px Segoe UI'; ctx.textAlign='center';
    const mine=myMirrors();
    ctx.fillText(P.mCharges<1? ('⟳ +1 in '+(MIRROR_REGEN-P.mRegenT).toFixed(1)+'s') : ghostAngle+'°'+(mine.length>=mirrorMax?' (recycles oldest)':''), mx, my-14);
  }

  ctx.restore();
}
function drawDashShell(cx,cy,w,h){
  // untouchable while dashing — bright energy shell so everyone can read it
  ctx.save();
  ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2.5;
  ctx.shadowColor='#00ffd9'; ctx.shadowBlur=16;
  ctx.setLineDash([10,6]); ctx.lineDashOffset=-beatT*90;
  ctx.beginPath(); ctx.ellipse(cx,cy,w*0.95,h*0.72,0,0,TAU); ctx.stroke();
  ctx.restore();
}
function drawDancer(px,py,facing,aim,gunIdx,col,glow,flash,vx,tag,cls){
  const C=CLASSES[cls||0], w=C.w, h=C.h;
  const cx=px+w/2, cy=py+h/2;
  ctx.save(); ctx.translate(cx,cy);
  const bodyCol = glow? `hsl(${beatT*400%360},100%,65%)` : col;
  ctx.shadowColor=bodyCol; ctx.shadowBlur=glow?20:12;
  ctx.fillStyle='#0d2b33';
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,7); ctx.fill();
  ctx.strokeStyle=bodyCol; ctx.lineWidth=(C.id==='titan'?3:2)+(glow?1:0); ctx.stroke();
  ctx.shadowBlur=0;
  ctx.fillStyle=bodyCol;
  ctx.fillRect(facing>0? -1:-(w/2)+3, -h/2+7, w/2-2, 5);
  // class flair
  if(C.id==='titan'){
    ctx.fillStyle='#1c1533'; ctx.strokeStyle=bodyCol; ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect(-w/2-5,-h/2+3,10,12,3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(w/2-5,-h/2+3,10,12,3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w/2+5,5); ctx.lineTo(w/2-5,5); ctx.stroke();
  } else if(C.id==='raver'){
    ctx.fillStyle=bodyCol;
    for(let k=-1;k<=1;k++){
      ctx.beginPath(); ctx.moveTo(k*6-3,-h/2+1); ctx.lineTo(k*6,-h/2-7-(k===0?4:0)); ctx.lineTo(k*6+3,-h/2+1); ctx.closePath(); ctx.fill();
    }
  } else if(C.id==='prism'){
    ctx.save(); ctx.translate(0,-h/2-11); ctx.rotate(beatT*2);
    ctx.strokeStyle=bodyCol; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(5,0); ctx.lineTo(0,6); ctx.lineTo(-5,0); ctx.closePath(); ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle=bodyCol; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,-h/2); ctx.lineTo(0,-h/2-7); ctx.stroke();
    ctx.fillStyle=bodyCol; ctx.beginPath(); ctx.arc(0,-h/2-9,2.5,0,TAU); ctx.fill();
  }
  const run=Math.abs(vx)>20? Math.sin(beatT*22)*5:0;
  ctx.strokeStyle=bodyCol; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-w/4,h/2-2); ctx.lineTo(-w/4+run,h/2+6); ctx.moveTo(w/4,h/2-2); ctx.lineTo(w/4-run,h/2+6); ctx.stroke();
  ctx.rotate(aim);
  const g=GUNS[gunIdx]||GUNS[0];
  const bl = C.id==='titan'? 30 : C.id==='raver'? 19 : 24;
  ctx.fillStyle='#1c1533'; ctx.strokeStyle=g.color;
  ctx.beginPath(); ctx.roundRect(6,-4,bl,8,3); ctx.fill(); ctx.stroke();
  if(flash){ ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(bl+8,0,6,0,TAU); ctx.fill(); }
  ctx.restore();
  if(tag){
    ctx.fillStyle=col; ctx.font='bold 11px Segoe UI'; ctx.textAlign='center';
    ctx.fillText(tag, cx, py-20);
  }
}
function drawHUD(){
  const pulse=beatPulse();
  if(hurtVigT>0){
    // red edge vignette: you just got hit
    const a=clamp(hurtVigT/0.35,0,1)*0.45;
    const vg=ctx.createRadialGradient(VW/2,VH/2,Math.min(VW,VH)*0.35,VW/2,VH/2,Math.max(VW,VH)*0.72);
    vg.addColorStop(0,'rgba(255,40,80,0)'); vg.addColorStop(1,`rgba(255,40,80,${a})`);
    ctx.fillStyle=vg; ctx.fillRect(0,0,VW,VH);
  }
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(18,16,240,26,7); ctx.fill();
  ctx.fillStyle= P.hp>P.maxHp*0.5? '#7dff5e' : P.hp>P.maxHp*0.25? '#ffe14d':'#ff4d6d';
  ctx.beginPath(); ctx.roundRect(21,19,234*clamp(P.hp/P.maxHp,0,1),20,5); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='bold 13px Segoe UI'; ctx.textAlign='left';
  ctx.fillText('HP '+Math.ceil(P.hp), 26, 34);
  let bx=18, by=50;
  const chip=(label,col)=>{
    ctx.font='bold 11px Segoe UI';
    const w=ctx.measureText(label).width+14;
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(bx,by,w,18,5); ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle=col; ctx.fillText(label,bx+7,by+13);
    bx+=w+6;
    if(bx>420){bx=18;by+=22;}
  };
  for(const p of POWERUPS){
    if(p.dur && buffs[p.id]>0) chip(p.short+' '+Math.ceil(buffs[p.id])+'s', p.color);
  }
  if(MP.on){
    ctx.font='11px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.textAlign='left';
    ctx.fillText('ROOM '+MP.code+' · '+(MP.mode==='vs'?'FACE-OFF':'CO-OP')+' · '+STAGES[stageIdx].name+' · YOU = P'+(MP.you+1), 18, VH-112);
  }
  ctx.textAlign='center';
  if(mission){
    const def=mission.def;
    ctx.font='bold 18px Segoe UI';
    ctx.fillStyle='#000'; ctx.fillText(def.name, VW/2+1, 33);
    ctx.fillStyle='#ffe14d'; ctx.fillText(def.name, VW/2, 32);
    let obj='';
    if(def.type==='clear') obj=def.goal+' — LEFT: '+enemies.filter(e=>!e.dead).length;
    else if(def.type==='timed') obj='TARGETS '+enemies.filter(e=>!e.dead).length+' · TIME '+Math.max(0,def.timeLimit-mission.t).toFixed(1);
    else if(def.type==='survive') obj='SURVIVE '+Math.max(0,def.surviveTime-mission.t).toFixed(1)+'s';
    else if(def.type==='boss') obj=def.goal;
    ctx.font='bold 13px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.fillText(obj, VW/2, 54);
    if(def.type==='boss' && enemies[0] && !enemies[0].dead){
      const b=enemies[0];
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(VW/2-220,62,440,14,6); ctx.fill();
      ctx.fillStyle='#ff4dd2'; ctx.beginPath(); ctx.roundRect(VW/2-217,65,434*clamp(b.hp/b.maxHp,0,1),8,4); ctx.fill();
    }
  } else if(MP.on && MP.mode==='vs'){
    ctx.font='bold 24px Segoe UI';
    ctx.fillStyle='#000'; ctx.fillText(fragLine(), VW/2+2, 42);
    ctx.fillStyle='#ffe14d'; ctx.fillText(fragLine(), VW/2, 40);
    ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.fillText('FIRST TO 10 · BEST BOUNCE ×'+bestBounce, VW/2, 60);
  } else {
    ctx.font='bold 30px Segoe UI';
    ctx.fillStyle='#000'; ctx.fillText(score, VW/2+2, 42);
    ctx.fillStyle='#ffe14d'; ctx.fillText(score, VW/2, 40);
    ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.fillText('KILLS '+kills+'   ·   BEST BOUNCE ×'+bestBounce, VW/2, 60);
  }
  {
    // your class + signature weapon (upgrades included)
    const C=CLASSES[P.cls], g=effGun(GUNS[P.gun]), x=18, y=VH-96;
    ctx.fillStyle='rgba(20,16,50,0.9)';
    ctx.beginPath(); ctx.roundRect(x,y,235,66,8); ctx.fill();
    ctx.strokeStyle=g.color; ctx.lineWidth=2; ctx.shadowColor=g.color; ctx.shadowBlur=8+6*pulse; ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle=myCol(); ctx.font='bold 14px Segoe UI'; ctx.textAlign='left';
    ctx.fillText(C.name, x+12, y+21);
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='10px Segoe UI';
    ctx.fillText(C.desc, x+95, y+21);
    ctx.fillStyle=g.color; ctx.font='bold 12px Segoe UI';
    ctx.fillText(g.name, x+12, y+40);
    ctx.font='10px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText(g.desc, x+12, y+56);
    ctx.textAlign='right';
    if(P.reloadT>0){
      ctx.fillStyle='#ffe14d'; ctx.font='bold 11px Segoe UI';
      ctx.fillText('RELOADING', x+223, y+40);
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(x+153,y+46,70,6);
      ctx.fillStyle='#ffe14d'; ctx.fillRect(x+153,y+46,70*clamp(1-P.reloadT/g.rel,0,1),6);
    } else {
      ctx.fillStyle= P.ammo<=Math.ceil(g.mag*0.25)? '#ff4d6d':'#fff';
      ctx.font='bold 20px Segoe UI';
      ctx.fillText(P.ammo+'/'+g.mag, x+223, y+44);
    }
  }
  if(heldItem==='ball'){
    ctx.save(); ctx.translate(VW/2, VH-46);
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(-86,-24,172,48,9); ctx.fill();
    ctx.strokeStyle=`hsl(${beatT*200%360},100%,70%)`; ctx.lineWidth=2+pulse*2; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='bold 14px Segoe UI'; ctx.textAlign='center';
    ctx.fillText('DISCO BALL', 12, -2);
    ctx.font='11px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillText('[F] THROW', 12, 15);
    ctx.translate(-58,0); ctx.rotate(beatT*2);
    ctx.fillStyle='#cfd8ea'; ctx.beginPath(); ctx.arc(0,0,12,0,TAU); ctx.fill();
    ctx.strokeStyle='rgba(60,70,110,0.8)'; ctx.lineWidth=1;
    for(let k=-8;k<=8;k+=4){ ctx.beginPath(); ctx.moveTo(k,-12); ctx.lineTo(k,12); ctx.stroke(); }
    ctx.restore();
  }
  ctx.textAlign='right'; ctx.font='bold 15px Segoe UI';
  ctx.fillStyle= placing? '#7dff5e':'#cfe8ff';
  ctx.fillText('◇ MIRRORS '+P.mCharges+'/'+mirrorMax+(P.mCharges<mirrorMax? '  ⟳+1 in '+(MIRROR_REGEN-P.mRegenT).toFixed(1)+'s':''), VW-20, VH-46);
  ctx.font='11px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText('HOLD RMB = quick place · [E] place mode · [X] pick up · [T] sight '+(sightOn?'ON':'OFF'), VW-20, VH-28);
  if(placing){
    ctx.textAlign='center'; ctx.font='bold 15px Segoe UI';
    ctx.fillStyle='#7dff5e';
    ctx.fillText('— MIRROR MODE: click to place · scroll to rotate · E to exit —', VW/2, VH-84);
  }
  if(announceT>0){
    const t=clamp(announceT/1.6,0,1);
    ctx.save(); ctx.translate(VW/2,VH*0.3); ctx.scale(1+(1-t)*0.1,1+(1-t)*0.1);
    ctx.globalAlpha=clamp(t*2,0,1);
    ctx.font='bold 42px Segoe UI'; ctx.textAlign='center';
    ctx.fillStyle='#000'; ctx.fillText(announceTxt,3,3);
    ctx.fillStyle=`hsl(${beatT*300%360},100%,65%)`; ctx.fillText(announceTxt,0,0);
    ctx.restore(); ctx.globalAlpha=1;
  }
  if(escT>0){
    ctx.textAlign='center'; ctx.font='bold 14px Segoe UI';
    ctx.fillStyle='rgba(255,255,255,'+clamp(escT/1.2,0,1)+')';
    ctx.fillText('press ESC again to quit to the menu', VW/2, 84);
  }
  if(helpT>0||helpPin) drawHelp();
  else { ctx.textAlign='left'; ctx.font='11px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.fillText('[H] help · [ESC×2] menu', 20, VH-16); }
  if(music.nameT>0 && music.name){
    ctx.globalAlpha=clamp(music.nameT,0,1);
    ctx.textAlign='center'; ctx.font='bold 13px Segoe UI';
    ctx.fillStyle=`hsl(${beatT*220%360},90%,70%)`;
    ctx.fillText('♫ '+music.name, VW/2, VH-96);
    ctx.globalAlpha=1;
  }
  if(paused){
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,VW,VH);
    ctx.fillStyle='#fff'; ctx.font='bold 40px Segoe UI'; ctx.textAlign='center';
    ctx.fillText('PAUSED', VW/2, VH/2);
  }
  if(mission && missionOver){
    ctx.fillStyle= missionOver===1? 'rgba(4,22,10,0.7)':'rgba(30,0,20,0.7)';
    ctx.fillRect(0,0,VW,VH);
    ctx.textAlign='center';
    ctx.font='bold 46px Segoe UI';
    ctx.fillStyle='#000'; ctx.fillText(missionOver===1?'STAGE CLEAR ★':'STAGE FAILED', VW/2+3, VH*0.4+3);
    ctx.fillStyle= missionOver===1? '#7dff5e':'#ff4d6d';
    ctx.fillText(missionOver===1?'STAGE CLEAR ★':'STAGE FAILED', VW/2, VH*0.4);
    ctx.font='15px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.fillText(mission.def.name+'  ·  '+mission.t.toFixed(1)+'s', VW/2, VH*0.4+34);
    ctx.font='bold 15px Segoe UI'; ctx.fillStyle='#ffe14d';
    ctx.fillText(missionOver===1
      ? (missionIdx+1<MISSIONS.length? '[SPACE] next stage · [ESC] menu':'[SPACE] finish · [ESC] menu — GAUNTLET COMPLETE!')
      : '[SPACE] retry · [ESC] menu', VW/2, VH*0.4+70);
  }
  if(P.deadT>0 && matchEndT<=0 && !(mission && missionOver)){
    ctx.fillStyle='rgba(30,0,20,0.5)'; ctx.fillRect(0,0,VW,VH);
    ctx.fillStyle='#ff4d6d'; ctx.font='bold 38px Segoe UI'; ctx.textAlign='center';
    ctx.fillText('YOU GOT DROPPED', VW/2, VH/2-10);
    ctx.font='16px Segoe UI'; ctx.fillStyle='#fff';
    ctx.fillText('respawning on the beat…', VW/2, VH/2+24);
  }
  if(matchEndT>0){
    // podium: winner's dancer performs while confetti rains and rewards roll in
    ctx.fillStyle='rgba(6,2,18,0.72)'; ctx.fillRect(0,0,VW,VH);
    const iWon = matchWinner===MP.you;
    const wCls = iWon? myClass : (peers[matchWinner]? peers[matchWinner].cls||0 : 0);
    const wCol = iWon? myColor : (peers[matchWinner] && peers[matchWinner].col!=null? peers[matchWinner].col : 0);
    ctx.textAlign='center';
    ctx.font='bold 44px Segoe UI';
    ctx.fillStyle='#000'; ctx.fillText(iWon? 'YOU TAKE THE CROWN':'P'+(matchWinner+1)+' TAKES THE CROWN', VW/2+3, VH*0.22+3);
    ctx.fillStyle=`hsl(${beatT*260%360},100%,65%)`; ctx.fillText(iWon? 'YOU TAKE THE CROWN':'P'+(matchWinner+1)+' TAKES THE CROWN', VW/2, VH*0.22);
    // spinning crown over the champion
    ctx.save(); ctx.translate(VW/2, VH*0.32); ctx.rotate(Math.sin(beatT*2)*0.15);
    ctx.fillStyle='#ffe14d'; ctx.font='bold 34px Segoe UI'; ctx.fillText('♛', 0, 0); ctx.restore();
    drawCharacter(wCls, wCol, VW/2, VH*0.62, 2.4, matchWinner+3);
    ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(VW/2-140,VH*0.62); ctx.lineTo(VW/2+140,VH*0.62); ctx.stroke();
    ctx.font='bold 16px Segoe UI'; ctx.fillStyle='#7dff5e';
    ctx.fillText('ROUND REWARD: '+lastReward, VW/2, VH*0.7);
    if(upgLine()){
      ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.6)';
      ctx.fillText('your arsenal: '+upgLine(), VW/2, VH*0.7+22);
    }
    ctx.font='13px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillText('back to the lobby in '+Math.ceil(matchEndT)+'…', VW/2, VH*0.7+46);
    drawCardFx();
  }
  drawCrosshair();
}
function drawHelp(){
  const lines=[
    ['MOVE','A D · W = up (for dash aiming)'],
    ['JUMP ×2','SPACE (walls: wall-jump)'],
    ['DASH 8-WAY','SHIFT + A/D/W/S · refunds a jump'],
    ['FAST-FALL / DROP','S'],
    ['FIRE','LMB · #4 hold + release'],
    ['LASER SIGHT','[T] · only YOU can see yours'],
    ['WEAPON','fixed by your class — pick in the menu'],
    ['RELOAD','R · automatic when the mag runs dry'],
    ['MIRRORS','HOLD RMB, release to place · E = mode · X pick up'],
    ['MIRROR AIM','scroll rotates · SHIFT+scroll fine · '+mirrorMax+' out max'],
    ['LOOT KEYS','Q hook · F throw · C blink'],
    ['VOLUME','- / = master · sliders in the menu'],
    ['','—'],
    ['★ EVERY BOUNCE','multiplies laser damage'],
    ['★ BOUNCED SHOTS','can hit YOU — laser-jump with them'],
    ['★ YOUR MIRRORS','have HP — heavy lasers chew them faster'],
    ['★ PRISMS / ? BOXES','need bounces / respawn loot'],
    ['★ DASHED PLATFORMS','press S to drop through them'],
    ['★ HYPE SPEAKERS','shoot them — stingers drop ON the beat'],
    ['★ RED ZONES','hazards — do not dance there'],
    ['','—'],
    ['HELP / PAUSE / MUTE','H / P / M'],
    ['SKIP TRACK','N'],
    ['QUIT TO MENU','ESC twice'],
  ];
  const x=VW-350, y=90, alpha= helpPin?0.92:clamp(helpT/2,0,0.92);
  ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(6,2,18,0.85)'; ctx.beginPath(); ctx.roundRect(x,y,330,26+lines.length*20,10); ctx.fill();
  ctx.strokeStyle='rgba(0,255,217,0.4)'; ctx.stroke();
  ctx.font='bold 13px Segoe UI'; ctx.fillStyle='#00ffd9'; ctx.textAlign='left';
  ctx.fillText('HOW TO REVOLUTION', x+16, y+22);
  ctx.font='11px Segoe UI';
  lines.forEach((l,i)=>{
    ctx.fillStyle='#ffe14d'; ctx.fillText(l[0], x+16, y+42+i*20);
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillText(l[1], x+150, y+42+i*20);
  });
  ctx.globalAlpha=1;
}
function drawCrosshair(){
  if(placing||state!=='play') return;
  const g=GUNS[P.gun];
  ctx.strokeStyle=g.color; ctx.lineWidth=1.6;
  ctx.beginPath(); ctx.arc(mouse.x,mouse.y,9,0.3,1.3); ctx.stroke();
  ctx.beginPath(); ctx.arc(mouse.x,mouse.y,9,0.3+Math.PI,1.3+Math.PI); ctx.stroke();
  ctx.fillStyle=g.color; ctx.fillRect(mouse.x-1,mouse.y-1,2,2);
  if(P.reloadT>0){
    ctx.strokeStyle='#ffe14d'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(mouse.x,mouse.y,14,-Math.PI/2,-Math.PI/2+TAU*clamp(1-P.reloadT/effGun(GUNS[P.gun]).rel,0,1)); ctx.stroke();
  }
}

// ---------- menu / lobby ----------
function drawMenu(){
  drawBg();
  const pulse=beatPulse();
  menuBtns=[];
  ctx.textAlign='center';
  ctx.save(); ctx.translate(VW/2,VH*0.2); ctx.scale(1+0.015*pulse,1+0.015*pulse);
  ctx.font='bold 52px Segoe UI';
  ctx.fillStyle='rgba(255,0,80,0.7)'; ctx.fillText('LASER REVOLUTION 4', -4, 0);
  ctx.fillStyle='rgba(0,180,255,0.7)'; ctx.fillText('LASER REVOLUTION 4', 4, 0);
  ctx.fillStyle='#ffffff'; ctx.fillText('LASER REVOLUTION 4', 0, 0);
  ctx.font='bold 26px Segoe UI';
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`;
  ctx.fillText('☠ APOCALYPSE DANCE PARTY ☠', 0, 42);
  ctx.restore();
  ctx.font='13px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.7)';
  ctx.fillText('1-4 players · 4 stages · 4 classes · loot roulette · v0.6', VW/2, VH*0.2+78);

  const bw=320, bh=46, bxx=VW/2-bw/2;
  let by=VH*0.34;
  const addBtn=(label,sub,action,enabled)=>{
    menuBtns.push({x:bxx,y:by,w:bw,h:bh,label,sub,action,enabled:enabled!==false}); by+=bh+11;
  };
  addBtn('SOLO PARTY','pick your dancer, then go',()=>{ initAudio(); state='select'; });
  addBtn('SOLO GAUNTLET'+(doneMissions.size? '  ('+doneMissions.size+'/'+MISSIONS.length+')':''),
    'puzzles · bullet hell · a boss',()=>{ initAudio(); state='missions'; });
  addBtn('HOST CO-OP','up to 4 dancers vs the bots',()=>hostRoom('coop'),net.ready);
  addBtn('HOST FACE-OFF','pure PvP · 1v1 up to 4 · first to 10',()=>hostRoom('vs'),net.ready);
  const stName = menuStageSel===0? 'RANDOM' : STAGES[menuStageSel-1].name;
  addBtn('STAGE: '+stName+'  ⟳','face-off arena · click to cycle',()=>{ menuStageSel=(menuStageSel+1)%(STAGES.length+1); sfxUI(600); });
  addBtn('JOIN A PARTY'+(roomListData.length? '  ('+roomListData.length+' open)':''),
    roomListData.length? 'live parties are waiting for dancers':'browse sessions or enter a friend\'s code',
    ()=>{ initAudio(); codeInput=''; menuNotice=''; browsePollT=0; state='browse'; }, net.ready);
  for(const b of menuBtns){
    const hov = b.enabled && mouse.x>=b.x&&mouse.x<=b.x+b.w&&mouse.y>=b.y&&mouse.y<=b.y+b.h;
    ctx.fillStyle= b.enabled? (hov? 'rgba(30,20,70,0.95)':'rgba(10,6,30,0.8)') : 'rgba(10,6,30,0.5)';
    ctx.beginPath(); ctx.roundRect(b.x,b.y,b.w,b.h,9); ctx.fill();
    ctx.strokeStyle= b.enabled? (hov? '#00ffd9':'rgba(0,255,217,0.4)') : 'rgba(255,255,255,0.15)';
    ctx.lineWidth=hov?2.5:1.5;
    if(hov){ ctx.shadowColor='#00ffd9'; ctx.shadowBlur=12; }
    ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle= b.enabled? (hov? '#fff':'rgba(255,255,255,0.85)') : 'rgba(255,255,255,0.3)';
    ctx.font='bold 15px Segoe UI'; ctx.textAlign='center';
    ctx.fillText(b.label, b.x+b.w/2, b.y+20);
    ctx.font='10px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.45)';
    ctx.fillText(b.enabled? b.sub:'server offline', b.x+b.w/2, b.y+35);
    if(!b.enabled) b.action=()=>{ menuNotice='multiplayer server offline'; };
  }
  if(menuNotice){
    ctx.fillStyle='#ff9d2e'; ctx.font='13px Segoe UI'; ctx.textAlign='center';
    ctx.fillText(menuNotice, VW/2, by+16);
  }
  drawVolumePanel();
  drawCursorDot();
}
function drawLocker(){
  if(VW<1000) return; // narrow windows use the cycle buttons instead
  const x=34, y=VH*0.34, w=270;
  const C=CLASSES[myClass], g=GUNS[C.gun];
  ctx.textAlign='left'; ctx.font='bold 13px Segoe UI'; ctx.fillStyle='#00ffd9';
  ctx.fillText('YOUR DANCER', x, y-10);
  // class card (click to cycle)
  const card={x,y,w,h:150,label:'',action:()=>{ myClass=(myClass+1)%CLASSES.length; localStorage.setItem('lr4_class',myClass); sfxUI(640); }};
  menuBtns.push(card);
  const hov = mouse.x>=x&&mouse.x<=x+w&&mouse.y>=y&&mouse.y<=y+150;
  ctx.fillStyle= hov? 'rgba(24,16,56,0.95)':'rgba(10,6,30,0.8)';
  ctx.beginPath(); ctx.roundRect(x,y,w,150,10); ctx.fill();
  ctx.strokeStyle= hov? myCol():'rgba(255,255,255,0.25)'; ctx.lineWidth=hov?2.5:1.5; ctx.stroke();
  // preview dancer dancing on the card
  const bob=Math.abs(Math.sin(beatT*4))*6;
  drawDancer(x+34-C.w/2, y+96-C.h-bob, 1, -0.4+Math.sin(beatT*2)*0.2, C.gun, myCol(), false, false, 30, null, myClass);
  ctx.textAlign='left';
  ctx.fillStyle=myCol(); ctx.font='bold 17px Segoe UI';
  ctx.fillText(C.name, x+78, y+30);
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='11px Segoe UI';
  ctx.fillText(C.desc, x+78, y+48);
  ctx.fillStyle=g.color; ctx.font='bold 11px Segoe UI';
  ctx.fillText(g.name, x+78, y+66);
  ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px Segoe UI';
  ctx.fillText('HP '+C.hp+' · SPD '+Math.round(C.spd*100)+'% · first loot: '+ (POWERUPS.find(q=>q.id===C.start)||{short:'?'}).short, x+78, y+84);
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='10px Segoe UI';
  ctx.fillText('click card to change class', x+78, y+102);
  // color swatches
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='11px Segoe UI';
  ctx.fillText('SUIT COLOR', x, y+172);
  for(let i=0;i<COLORS.length;i++){
    const sx=x+i*33, sy=y+184, r=11;
    menuBtns.push({x:sx-2,y:sy-2,w:r*2+4,h:r*2+4,action:((ci)=>()=>{ myColor=ci; localStorage.setItem('lr4_color',ci); sfxUI(760); })(i)});
    ctx.fillStyle=COLORS[i];
    ctx.beginPath(); ctx.arc(sx+r,sy+r,r-2,0,TAU); ctx.fill();
    if(i===myColor){
      ctx.strokeStyle='#fff'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(sx+r,sy+r,r+1,0,TAU); ctx.stroke();
    }
  }
}
function drawVolumePanel(){
  menuSliders=[];
  if(VW<1000) return;
  const x=VW-300, y=VH*0.34, w=250;
  ctx.textAlign='left'; ctx.font='bold 13px Segoe UI'; ctx.fillStyle='#00ffd9';
  ctx.fillText('VOLUME', x, y-10);
  ctx.fillStyle='rgba(10,6,30,0.8)';
  ctx.beginPath(); ctx.roundRect(x-14,y,w+28,132,10); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1.5; ctx.stroke();
  const rows=[['master','MASTER'],['music','MUSIC'],['sfx','SFX']];
  rows.forEach((r,i)=>{
    const sy=y+30+i*38;
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='bold 11px Segoe UI'; ctx.textAlign='left';
    ctx.fillText(r[1], x, sy-8);
    ctx.textAlign='right';
    ctx.fillText(Math.round(vol[r[0]]*100)+'%', x+w, sy-8);
    menuSliders.push({x, y:sy, w, h:8, key:r[0]});
    ctx.fillStyle='rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.roundRect(x,sy,w,8,4); ctx.fill();
    ctx.fillStyle= volDrag===r[0]? '#00ffd9':'#7de8ff';
    ctx.beginPath(); ctx.roundRect(x,sy,w*clamp(vol[r[0]],0,1),8,4); ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(x+w*clamp(vol[r[0]],0,1),sy+4,7,0,TAU); ctx.fill();
  });
  ctx.textAlign='left'; ctx.font='10px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.35)';
  ctx.fillText('in game: - / = master volume · M mute', x, y+124);
}

// ---------- character select (shared by the solo select screen + lobby) ----------
let cardFx=[], cardPrevAct={};
function setMyPick(cls,col){
  const changed=(cls!==myClass||col!==myColor);
  myClass=clamp(cls|0,0,CLASSES.length-1); myColor=clamp(col|0,0,COLORS.length-1);
  try{ localStorage.setItem('lr4_class',myClass); localStorage.setItem('lr4_color',myColor); }catch(e){}
  if(changed) sfxUI(680);
  lobbyPicks[MP.you]={cls:myClass,col:myColor};
  if(state==='lobby') net.raw({t:'pick', who:MP.you, cls:myClass, col:myColor});
}
// idle groove + a personality action every ~5s (staggered per card)
function charPose(C,seed){
  const t=beatT;
  const cyc=(t+seed*1.61)%5.2, act= cyc<1.2? cyc/1.2 : -1;
  const o={bob:0,xoff:0,rot:0,sqx:1,sqy:1,hover:0,vx:0,act,aim:-0.35+Math.sin(t*2+seed)*0.12};
  if(C.id==='bouncer'){        // head-bopping groover · action: backflip
    o.bob=Math.abs(Math.sin(t*4.2+seed))*6; o.vx=40*Math.sin(t*8);
    if(act>=0){ o.bob+=Math.sin(act*Math.PI)*52; o.rot=-act*TAU; }
  } else if(C.id==='raver'){   // double-time bouncing · action: hyper zip with afterimages
    o.bob=Math.abs(Math.sin(t*8.4+seed))*8; o.vx=90;
    if(act>=0) o.xoff=Math.sin(act*Math.PI*3)*30;
  } else if(C.id==='titan'){   // slow heavy sway · action: crouch + ground pound
    o.rot=Math.sin(t*1.6+seed)*0.05; o.bob=Math.abs(Math.sin(t*2.1+seed))*3;
    if(act>=0){
      o.rot=0;
      if(act<0.4){ const q=act/0.4; o.sqy=1-0.3*q; o.sqx=1+0.22*q; }
      else if(act<0.55){ const q=(act-0.4)/0.15; o.bob=Math.sin(q*Math.PI*0.5)*36; o.sqy=1.08; o.sqx=0.94; }
      else { const q=(act-0.55)/0.45; o.bob=Math.max(0,36*(1-q*3));
        o.sqy=1-0.18*Math.max(0,1-q*2.5); o.sqx=1+0.18*Math.max(0,1-q*2.5); }
    }
  } else {                     // prismancer: levitates · action: mini laser show
    o.hover=10+Math.sin(t*2.5+seed)*6;
    if(act>=0) o.hover+=Math.sin(act*Math.PI)*12;
  }
  return o;
}
function drawCharacter(cls,colIdx,cx,groundY,scale,seed){
  const C=CLASSES[cls||0];
  const col=COLORS[colIdx!=null?colIdx:0]||'#00ffd9';
  const o=charPose(C,seed);
  const one=(alpha,xo)=>{
    ctx.save();
    ctx.globalAlpha*=alpha;
    ctx.translate(cx+(o.xoff+xo)*scale, groundY-(o.hover+o.bob)*scale);
    ctx.scale(scale*o.sqx, scale*o.sqy);
    ctx.translate(0,-C.h/2); ctx.rotate(o.rot);
    drawDancer(-C.w/2,-C.h/2,1,o.aim,C.gun,col,false,false,o.vx,null,cls||0);
    ctx.restore();
  };
  if(C.id==='raver' && o.act>=0){
    for(const d of [0.14,0.07]){
      const pa=o.act-d;
      if(pa>0) one(d===0.14?0.16:0.3, Math.sin(pa*Math.PI*3)*30-o.xoff);
    }
  }
  one(1,0);
  if(C.id==='titan'){
    const key='t'+seed, prev=cardPrevAct[key]!=null? cardPrevAct[key] : -1;
    if(prev>=0 && prev<0.56 && o.act>=0.56){
      for(let i=0;i<12;i++){
        const s=rnd(50,180);
        cardFx.push({x:cx+rnd(-16,16)*scale, y:groundY-2, vx:(Math.random()<0.5?-1:1)*s*0.7, vy:-rnd(20,110),
          life:rnd(0.3,0.6), max:0.6, color:Math.random()<0.4?'#cfd8ea':'#8f86b8', size:rnd(2,4)*scale});
      }
    }
    cardPrevAct[key]=o.act;
  }
  if(C.id==='prism' && o.act>=0){
    const p=o.act;
    const pts=[
      {x:cx, y:groundY-(C.h+16+o.hover)*scale},
      {x:cx+46*scale, y:groundY-4},
      {x:cx-38*scale, y:groundY-58*scale},
    ];
    const segLens=[]; let L=0;
    for(let i=1;i<pts.length;i++){ const l=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y); segLens.push(l); L+=l; }
    let draw=Math.min(1,p*1.7)*L;
    const alpha= p>0.72? Math.max(0,(1-p)/0.28) : 1;
    ctx.save(); ctx.globalAlpha*=alpha*0.9;
    ctx.strokeStyle=`hsl(${(beatT*300)%360},100%,70%)`; ctx.lineWidth=2*scale;
    ctx.shadowColor=ctx.strokeStyle; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    let tipX=pts[0].x, tipY=pts[0].y;
    for(let i=1;i<pts.length && draw>0;i++){
      const l=segLens[i-1], f=Math.min(1,draw/l);
      tipX=lerp(pts[i-1].x,pts[i].x,f); tipY=lerp(pts[i-1].y,pts[i].y,f);
      ctx.lineTo(tipX,tipY);
      draw-=l;
    }
    ctx.stroke();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(tipX,tipY,2.5*scale,0,TAU); ctx.fill();
    ctx.restore();
  }
}
function drawCardFx(){
  for(let i=cardFx.length-1;i>=0;i--){
    const f=cardFx[i];
    f.life-=1/60; f.x+=f.vx/60; f.y+=f.vy/60; f.vy+=420/60;
    if(f.life<=0){ cardFx.splice(i,1); continue; }
    ctx.globalAlpha=f.life/f.max; ctx.fillStyle=f.color;
    ctx.fillRect(f.x-f.size/2,f.y-f.size/2,f.size,f.size);
  }
  ctx.globalAlpha=1;
}
function drawClassRow(cxc, topY, cw, ch, small){
  const gap=14, total=4*cw+3*gap, x0=cxc-total/2;
  for(let i=0;i<4;i++){
    const x=x0+i*(cw+gap), C=CLASSES[i], g=GUNS[C.gun], sel=i===myClass;
    menuBtns.push({x,y:topY,w:cw,h:ch,action:((ci)=>()=>setMyPick(ci,myColor))(i)});
    const hov=mouse.x>=x&&mouse.x<=x+cw&&mouse.y>=topY&&mouse.y<=topY+ch;
    ctx.fillStyle= sel? 'rgba(24,18,58,0.95)' : hov? 'rgba(18,12,44,0.9)':'rgba(10,6,30,0.75)';
    ctx.beginPath(); ctx.roundRect(x,topY,cw,ch,10); ctx.fill();
    ctx.strokeStyle= sel? myCol() : hov? 'rgba(255,255,255,0.5)':'rgba(255,255,255,0.18)';
    ctx.lineWidth= sel? 2.5:1.5;
    if(sel){ ctx.shadowColor=myCol(); ctx.shadowBlur=14; }
    ctx.stroke(); ctx.shadowBlur=0;
    const gy=topY+ch-(small?48:74);
    ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x+12,gy); ctx.lineTo(x+cw-12,gy); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x+2,topY+2,cw-4,ch-4); ctx.clip();
    drawCharacter(i, sel? myColor:null, x+cw/2, gy, small?1.15:1.9, i);
    ctx.restore();
    ctx.textAlign='center';
    ctx.fillStyle= sel? myCol():'rgba(255,255,255,0.85)'; ctx.font='bold '+(small?12:15)+'px Segoe UI';
    ctx.fillText(C.name, x+cw/2, gy+(small?16:22));
    if(small){
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px Segoe UI';
      ctx.fillText('HP '+C.hp+' · '+Math.round(C.spd*100)+'%', x+cw/2, gy+30);
      ctx.fillStyle=g.color; ctx.font='bold 9px Segoe UI';
      ctx.fillText(g.name, x+cw/2, gy+43);
    } else {
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='10px Segoe UI';
      ctx.fillText(C.desc, x+cw/2, gy+38);
      ctx.fillStyle=g.color; ctx.font='bold 10px Segoe UI';
      ctx.fillText(g.name, x+cw/2, gy+53);
      ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='10px Segoe UI';
      ctx.fillText('HP '+C.hp+' · SPD '+Math.round(C.spd*100)+'% · loot: '+((POWERUPS.find(q=>q.id===C.start)||{}).short||'?'), x+cw/2, gy+67);
    }
    if(sel){
      ctx.fillStyle=myCol(); ctx.font='bold 10px Segoe UI';
      ctx.fillText('★ YOU', x+cw/2, topY+16);
    }
  }
}
function drawSwatchRow(cxc, y){
  const n=COLORS.length, sp=34, x0=cxc-(n-1)*sp/2;
  for(let i=0;i<n;i++){
    const sx=x0+i*sp;
    menuBtns.push({x:sx-13,y:y-13,w:26,h:26,action:((ci)=>()=>setMyPick(myClass,ci))(i)});
    ctx.fillStyle=COLORS[i];
    ctx.beginPath(); ctx.arc(sx,y,10,0,TAU); ctx.fill();
    if(i===myColor){ ctx.strokeStyle='#fff'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(sx,y,13,0,TAU); ctx.stroke(); }
  }
}
function drawBigBtn(b, hovFill, col, enabled){
  const hov = enabled!==false && mouse.x>=b.x&&mouse.x<=b.x+b.w&&mouse.y>=b.y&&mouse.y<=b.y+b.h;
  ctx.fillStyle= enabled===false? 'rgba(10,6,30,0.5)' : hov? hovFill:'rgba(10,6,30,0.85)';
  ctx.beginPath(); ctx.roundRect(b.x,b.y,b.w,b.h,9); ctx.fill();
  ctx.strokeStyle= enabled===false? 'rgba(255,255,255,0.2)':col; ctx.lineWidth=hov?2.5:1.8; ctx.stroke();
  ctx.fillStyle= enabled===false? 'rgba(255,255,255,0.35)':col; ctx.font='bold 15px Segoe UI'; ctx.textAlign='center';
  ctx.fillText(b.label, b.x+b.w/2, b.y+b.h/2+5);
}
function drawSelect(){
  drawBg(); menuBtns=[]; menuSliders=[];
  ctx.textAlign='center';
  ctx.font='bold 34px Segoe UI';
  ctx.fillStyle='#000'; ctx.fillText('PICK YOUR DANCER', VW/2+2, VH*0.12+2);
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`; ctx.fillText('PICK YOUR DANCER', VW/2, VH*0.12);
  const cw=clamp((VW-160)/4-14,140,215), ch=Math.min(VH*0.52, cw*1.5);
  const topY=VH*0.17;
  drawClassRow(VW/2, topY, cw, ch, false);
  drawSwatchRow(VW/2, topY+ch+32);
  const bw=170, bh=44, byy=Math.min(VH-64, topY+ch+62);
  const back={x:VW/2-bw-bw/2-24,y:byy,w:bw,h:bh,label:'◀ BACK',action:()=>{ state='menu'; }};
  const items={x:VW/2-bw/2,y:byy,w:bw,h:bh,label:'ITEMS ('+(POWERUPS.length-itemsOffList().length)+')',action:()=>{ itemsReturn='select'; state='items'; }};
  const go={x:VW/2+bw/2+24,y:byy,w:bw,h:bh,label:'START ▶',action:()=>startSolo()};
  menuBtns.push(back,items,go);
  drawBigBtn(back,'rgba(60,10,30,0.9)','#ff4d6d');
  drawBigBtn(items,'rgba(30,20,70,0.95)','#7de8ff');
  drawBigBtn(go,'rgba(20,60,30,0.95)','#7dff5e');
  drawCardFx();
  drawCursorDot();
}
function drawItems(){
  drawBg(); menuBtns=[]; menuSliders=[];
  const canEdit = itemsReturn!=='lobby' || MP.isHost;
  ctx.textAlign='center';
  ctx.font='bold 34px Segoe UI';
  ctx.fillStyle='#000'; ctx.fillText('ITEM SETTINGS', VW/2+2, VH*0.1+2);
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`; ctx.fillText('ITEM SETTINGS', VW/2, VH*0.1);
  ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText(canEdit? 'click to toggle what the ? boxes can drop' : 'view only — the host controls the loot pool', VW/2, VH*0.1+24);
  const cols=Math.max(3,Math.min(5,Math.floor((VW-80)/160)));
  const cw2=150, chh=38, gap2=10;
  const total=cols*cw2+(cols-1)*gap2, x0=VW/2-total/2;
  let y=VH*0.17;
  for(let i=0;i<POWERUPS.length;i++){
    const p=POWERUPS[i];
    const x=x0+(i%cols)*(cw2+gap2);
    if(i>0 && i%cols===0) y+=chh+8;
    const on=itemEnabled(p.id);
    if(canEdit) menuBtns.push({x,y,w:cw2,h:chh,action:((id)=>()=>{ itemsOn[id]= itemEnabled(id)? false : true; if(itemsOn[id]) delete itemsOn[id]; saveItems(); sfxUI(on?420:760); })(p.id)});
    const hov=canEdit && mouse.x>=x&&mouse.x<=x+cw2&&mouse.y>=y&&mouse.y<=y+chh;
    ctx.fillStyle= on? (hov?'rgba(24,18,58,0.95)':'rgba(14,10,40,0.85)') : 'rgba(10,6,30,0.5)';
    ctx.beginPath(); ctx.roundRect(x,y,cw2,chh,7); ctx.fill();
    ctx.strokeStyle= on? p.color : 'rgba(255,255,255,0.15)';
    ctx.lineWidth= hov? 2.2:1.4; ctx.stroke();
    ctx.textAlign='left';
    ctx.fillStyle= on? p.color:'rgba(255,255,255,0.3)';
    ctx.font='bold 10px Segoe UI';
    ctx.fillText((on?'● ':'○ ')+p.short, x+9, y+16);
    ctx.fillStyle= on? 'rgba(255,255,255,0.45)':'rgba(255,255,255,0.2)';
    ctx.font='9px Segoe UI';
    const nm=p.name.length>26? p.name.slice(0,25)+'…' : p.name;
    ctx.fillText(nm, x+9, y+29);
  }
  y+=chh+22;
  const offN=itemsOffList().length;
  ctx.textAlign='center'; ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText((POWERUPS.length-offN)+'/'+POWERUPS.length+' items in the pool', VW/2, y);
  const bw2=150, byy=Math.min(VH-56, y+16);
  if(canEdit){
    const allOn={x:VW/2-bw2-170,y:byy,w:bw2,h:38,label:'ALL ON',action:()=>{ itemsOn={}; saveItems(); sfxUI(760); }};
    const allOff={x:VW/2-bw2/2-80,y:byy,w:bw2,h:38,label:'ALL OFF',action:()=>{ for(const p of POWERUPS) itemsOn[p.id]=false; saveItems(); sfxUI(420); }};
    menuBtns.push(allOn,allOff);
    drawBigBtn(allOn,'rgba(20,60,30,0.95)','#7dff5e');
    drawBigBtn(allOff,'rgba(60,10,30,0.9)','#ff9d2e');
  }
  const back={x:VW/2+90,y:byy,w:200,h:38,label:'◀ DONE [ESC]',action:()=>{ state=itemsReturn; }};
  menuBtns.push(back);
  drawBigBtn(back,'rgba(60,10,30,0.9)','#ff4d6d');
  drawCursorDot();
}
function drawMissions(){
  drawBg(); menuBtns=[]; menuSliders=[];
  ctx.textAlign='center';
  ctx.font='bold 34px Segoe UI';
  ctx.fillStyle='#000'; ctx.fillText('SOLO GAUNTLET', VW/2+2, VH*0.11+2);
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`; ctx.fillText('SOLO GAUNTLET', VW/2, VH*0.11);
  ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText(doneMissions.size+'/'+MISSIONS.length+' cleared · no upgrades, no respawns, just you', VW/2, VH*0.11+24);
  const w=Math.min(600,VW-80), x=VW/2-w/2;
  let y=VH*0.19;
  for(let i=0;i<MISSIONS.length;i++){
    const ms=MISSIONS[i], done=doneMissions.has(ms.id);
    menuBtns.push({x,y,w,h:58,action:((mi)=>()=>startMission(mi))(i)});
    const hov=mouse.x>=x&&mouse.x<=x+w&&mouse.y>=y&&mouse.y<=y+58;
    ctx.fillStyle= hov? 'rgba(24,18,58,0.95)':'rgba(10,6,30,0.8)';
    ctx.beginPath(); ctx.roundRect(x,y,w,58,10); ctx.fill();
    ctx.strokeStyle= done? 'rgba(125,255,94,0.6)' : hov? '#00ffd9':'rgba(255,255,255,0.18)';
    ctx.lineWidth=hov?2.5:1.5; ctx.stroke();
    ctx.textAlign='left';
    ctx.fillStyle= done? '#7dff5e':'#fff'; ctx.font='bold 16px Segoe UI';
    ctx.fillText((done?'✓ ':'')+(i+1)+'. '+ms.name, x+18, y+25);
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='11px Segoe UI';
    ctx.fillText(ms.desc, x+18, y+43);
    ctx.textAlign='right';
    ctx.fillStyle='#ffe14d'; ctx.font='bold 11px Segoe UI';
    ctx.fillText(ms.goal, x+w-16, y+25);
    ctx.fillStyle= hov? '#00ffd9':'rgba(0,255,217,0.6)'; ctx.font='bold 13px Segoe UI';
    ctx.fillText('PLAY ▶', x+w-16, y+44);
    y+=66;
  }
  const back={x:VW/2-110,y:y+14,w:220,h:38,label:'◀ BACK [ESC]',action:()=>{ state='menu'; }};
  menuBtns.push(back);
  drawBigBtn(back,'rgba(60,10,30,0.9)','#ff4d6d');
  drawCursorDot();
}
function drawBrowse(){
  drawBg(); menuBtns=[]; menuSliders=[];
  ctx.textAlign='center';
  ctx.font='bold 34px Segoe UI';
  ctx.fillStyle='#000'; ctx.fillText('PARTY BROWSER', VW/2+2, VH*0.11+2);
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`; ctx.fillText('PARTY BROWSER', VW/2, VH*0.11);
  ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText(net.ready? 'live list · updates automatically':'connecting to the party server…', VW/2, VH*0.11+24);
  const w=Math.min(560,VW-80), x=VW/2-w/2;
  let y=VH*0.19;
  if(!roomListData.length){
    ctx.fillStyle='rgba(10,6,30,0.7)';
    ctx.beginPath(); ctx.roundRect(x,y,w,74,10); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='13px Segoe UI';
    ctx.fillText('no open parties right now', VW/2, y+32);
    ctx.font='11px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.fillText("host one from the menu, or punch in a friend's code below", VW/2, y+52);
    y+=90;
  } else {
    for(const r of roomListData.slice(0,8)){
      menuBtns.push({x,y,w,h:52,action:((c)=>()=>joinRoom(c))(r.code)});
      const hov=mouse.x>=x&&mouse.x<=x+w&&mouse.y>=y&&mouse.y<=y+52;
      ctx.fillStyle= hov? 'rgba(24,18,58,0.95)':'rgba(10,6,30,0.8)';
      ctx.beginPath(); ctx.roundRect(x,y,w,52,10); ctx.fill();
      ctx.strokeStyle= hov? '#00ffd9':'rgba(0,255,217,0.3)'; ctx.lineWidth=hov?2.5:1.5; ctx.stroke();
      ctx.textAlign='left';
      ctx.fillStyle='#fff'; ctx.font='bold 17px Segoe UI';
      ctx.fillText(r.code, x+18, y+33);
      ctx.fillStyle= r.mode==='vs'? '#ffe14d':'#7dff5e'; ctx.font='bold 12px Segoe UI';
      ctx.fillText(r.mode==='vs'? 'FACE-OFF':'CO-OP', x+100, y+22);
      ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px Segoe UI';
      ctx.fillText(r.mode==='vs'? STAGES[r.stage||0].name : 'vs the bots', x+100, y+38);
      ctx.textAlign='right';
      if(w>=380){
        ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='bold 12px Segoe UI';
        ctx.fillText((r.count||1)+'/4 dancers', x+w-92, y+32);
      }
      ctx.fillStyle= hov? '#00ffd9':'rgba(0,255,217,0.7)'; ctx.font='bold 14px Segoe UI';
      ctx.fillText('JOIN ▶', x+w-16, y+33);
      y+=60;
    }
    y+=14;
  }
  ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='bold 12px Segoe UI';
  ctx.fillText('HAVE A CODE? TYPE IT:', VW/2, y+8);
  const cwv=46, gapv=10, tot=4*cwv+3*gapv, cx0=VW/2-tot/2;
  for(let i=0;i<4;i++){
    const cx=cx0+i*(cwv+gapv);
    ctx.fillStyle='rgba(10,6,30,0.85)';
    ctx.beginPath(); ctx.roundRect(cx,y+18,cwv,52,8); ctx.fill();
    ctx.strokeStyle= i===codeInput.length? `hsl(${beatT*220%360},100%,65%)`:'rgba(255,255,255,0.25)';
    ctx.lineWidth= i===codeInput.length? 2.5:1.5; ctx.stroke();
    if(codeInput[i]){
      ctx.fillStyle='#fff'; ctx.font='bold 26px Segoe UI';
      ctx.fillText(codeInput[i], cx+cwv/2, y+54);
    } else if(i===codeInput.length && Math.floor(beatT*2)%2===0){
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillRect(cx+cwv/2-1, y+30, 2, 28);
    }
  }
  const canJoin = codeInput.length>=4 && net.ready;
  const jb={x:VW/2-110,y:y+84,w:220,h:42,label:'JOIN '+(codeInput.length? codeInput:'CODE'),action:()=>{ if(canJoin) joinRoom(codeInput); }};
  const back={x:VW/2-110,y:y+136,w:220,h:38,label:'◀ BACK [ESC]',action:()=>{ state='menu'; }};
  menuBtns.push(jb,back);
  drawBigBtn(jb,'rgba(20,60,30,0.95)','#7dff5e',canJoin);
  drawBigBtn(back,'rgba(60,10,30,0.9)','#ff4d6d');
  if(menuNotice){
    ctx.fillStyle='#ff9d2e'; ctx.font='13px Segoe UI'; ctx.textAlign='center';
    ctx.fillText(menuNotice, VW/2, y+196);
  }
  drawCursorDot();
}
function drawLobby(){
  drawBg();
  menuBtns=[]; menuSliders=[];
  const li=lobbyInfo||{players:[0],mode:'coop',stage:0};
  ctx.textAlign='center';
  ctx.font='bold 30px Segoe UI';
  ctx.fillStyle=`hsl(${beatT*220%360},100%,65%)`;
  ctx.fillText('PARTY '+MP.code, VW/2, VH*0.08);
  ctx.font='12px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.65)';
  ctx.fillText((li.mode==='vs'?'FACE-OFF · '+STAGES[li.stage||0].name+' · first to 10':'CO-OP vs the bots')+'  —  pick your dancer while you wait', VW/2, VH*0.08+22);
  // player slots (with everyone's dancer grooving live)
  const sw=150, gap=14, total=4*sw+3*gap, x0=VW/2-total/2, y0=VH*0.13, sh=136;
  for(let i=0;i<4;i++){
    const filled=li.players.includes(i);
    const x=x0+i*(sw+gap);
    const pk=lobbyPicks[i];
    const col= filled? (pk&&pk.col!=null? COLORS[pk.col]:PCOLS[i]) : 'rgba(255,255,255,0.15)';
    ctx.fillStyle= filled? 'rgba(15,10,40,0.9)':'rgba(10,6,30,0.45)';
    ctx.beginPath(); ctx.roundRect(x,y0,sw,sh,9); ctx.fill();
    ctx.strokeStyle= col; ctx.lineWidth=filled?2.5:1.5; ctx.stroke();
    if(filled && pk){
      ctx.save();
      ctx.beginPath(); ctx.rect(x+2,y0+2,sw-4,sh-4); ctx.clip();
      drawCharacter(pk.cls||0, pk.col, x+sw/2, y0+sh-34, 1.0, i+11);
      ctx.restore();
    }
    ctx.textAlign='center';
    ctx.fillStyle= filled? col:'rgba(255,255,255,0.3)';
    ctx.font='bold 13px Segoe UI';
    ctx.fillText(filled? 'P'+(i+1)+(i===MP.you?' (YOU)':i===0?' (HOST)':'') : 'OPEN', x+sw/2, y0+sh-18);
    ctx.font='9px Segoe UI'; ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText(filled? (pk? CLASSES[pk.cls||0].name:'picking…'):'waiting…', x+sw/2, y0+sh-6);
  }
  // live character pick (synced to everyone in the lobby)
  const cw=clamp((VW-200)/4-14,110,150), ch=Math.min(VH*0.32,cw*1.45);
  const rowY=y0+sh+24;
  drawClassRow(VW/2,rowY,cw,ch,true);
  drawSwatchRow(VW/2,rowY+ch+22);
  if(upgLine()){
    ctx.textAlign='center'; ctx.font='bold 12px Segoe UI'; ctx.fillStyle='#7dff5e';
    ctx.fillText('ROUND UPGRADES: '+upgLine(), VW/2, rowY+ch+44);
  }
  const canStart = MP.isHost && li.players.length>=2;
  const byy=Math.min(VH-56, rowY+ch+44);
  if(MP.isHost){
    const b={x:VW/2-236,y:byy,w:230,h:42,label: canStart?'START THE APOCALYPSE':'NEED 2+ DANCERS',
      action:()=>{ if(canStart) net.raw({t:'begin'}); }};
    const it={x:VW/2+2,y:byy,w:110,h:42,label:'ITEMS',action:()=>{ itemsReturn='lobby'; state='items'; }};
    const c={x:VW/2+120,y:byy,w:110,h:42,label:'CANCEL',action:()=>leaveToMenu('')};
    menuBtns.push(b,it,c);
    drawBigBtn(b,'rgba(20,60,30,0.95)','#7dff5e',canStart);
    drawBigBtn(it,'rgba(30,20,70,0.95)','#7de8ff');
    drawBigBtn(c,'rgba(60,10,30,0.9)','#ff4d6d');
  } else {
    ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='13px Segoe UI'; ctx.textAlign='center';
    if(Math.floor(beatT*2)%2===0) ctx.fillText('waiting for the host to start…', VW/2, byy-8);
    const c={x:VW/2-60,y:byy,w:120,h:38,label:'CANCEL [ESC]',action:()=>leaveToMenu('')};
    menuBtns.push(c);
    drawBigBtn(c,'rgba(60,10,30,0.9)','#ff4d6d');
  }
  drawCardFx();
  drawCursorDot();
}
function drawCursorDot(){
  ctx.fillStyle='#00ffd9'; ctx.beginPath(); ctx.arc(mouse.x,mouse.y,4,0,TAU); ctx.fill();
  ctx.strokeStyle='rgba(0,255,217,0.5)'; ctx.beginPath(); ctx.arc(mouse.x,mouse.y,9,0,TAU); ctx.stroke();
}

// ---------- main loop ----------
function frame(now){
  const dt=Math.min((now-lastT)/1000, 1/30); lastT=now;
  update(dt);
  if(state==='menu') drawMenu();
  else if(state==='select') drawSelect();
  else if(state==='browse') drawBrowse();
  else if(state==='missions') drawMissions();
  else if(state==='items') drawItems();
  else if(state==='lobby') drawLobby();
  else { drawBg(); drawWorld(); drawHUD(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- debug hooks ----------
window.LR4 = {
  demo(ms){ demoT=(ms||3000)/1000; },
  tick(dt,steps){ dt=dt||1/60; steps=steps||1; for(let i=0;i<steps;i++) update(dt); },
  setWorld(mode,stage){ MP.on=false; MP.mode=mode||'solo'; MP.isHost=true; MP.you=0; initWorld(mode||'solo', stage||0); state='play'; },
  mouseTo(wx,wy){ mouse.x=wx-cam.x; mouse.y=wy-cam.y; },
  blink(){ tryBlink(); },
  hookAt(){ tryHook(); },
  state:()=>({state,mode:MP.mode,on:MP.on,isHost:MP.isHost,you:MP.you,code:MP.code,frags:MP.frags.slice(),
    stage:STAGES[stageIdx].name, cls:CLASSES[P.cls].name, color:myColor, score,kills,bestBounce,
    hp:Math.round(P.hp), maxHp:P.maxHp, x:P.x,y:P.y,vx:Math.round(P.vx),vy:Math.round(P.vy),
    spiked:+P.spikedT.toFixed(2), beams:beams.length,
    mirrors:playerMirrors.length, mirrorMax, held:heldItem, ammo:P.ammo, reload:+P.reloadT.toFixed(2),
    vol:{...vol},
    peers:peers.map((p,i)=>p.on?{i,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,cls:p.cls,col:p.col}:null).filter(Boolean),
    buffs:Object.fromEntries(Object.entries(buffs).filter(([k,v])=>v>0).map(([k,v])=>[k,+v.toFixed(1)])),
    loot:loot.map(b=>b.active?1:0).join('')}),
  setClass(i){ setMyPick(i, myColor); },
  setColor(i){ setMyPick(myClass, i); },
  openSelect(){ state='select'; },
  openBrowse(){ codeInput=''; browsePollT=0; state='browse'; },
  typeCode(s){ codeInput=(s||'').toUpperCase().slice(0,4); },
  setVol(k,v){ if(k in vol){ vol[k]=clamp(v,0,1); applyVolumes(); saveVol(); } },
  hitFrom(dx,dy,d){ hitKnock(dx,dy,d||20); },
  winTest(){ MP.frags[MP.you]=KILL_TARGET; checkWin(); },
  upg:()=>({...upg}),
  mission(i){ startMission(i); },
  missionState:()=>mission? {id:mission.def.id, t:+mission.t.toFixed(1), over:missionOver, enemies:enemies.filter(e=>!e.dead).length, orbs:orbs.length} : null,
  safeTo(x,y){ safePlace(x,y); },
  setItems(offIds){ itemsOn={}; for(const id of (offIds||[])) itemsOn[id]=false; saveItems(false); },
  itemsOff:()=>itemsOffList(),
  spawnOrb(x,y,vx,vy){ orbs.push({x,y,vx,vy,life:6}); },
  mirrorsDbg:()=>playerMirrors.map(m=>({id:m.id,hp:m.hp,x:m.x,y:m.y,angle:m.angle})),
  orbs:()=>orbs.map(o=>({x:Math.round(o.x),y:Math.round(o.y),vx:Math.round(o.vx),vy:Math.round(o.vy),r:!!o.reflected})),
  solo(){ if(state!=='play') startSolo(); },
  host(mode){ hostRoom(mode||'coop'); },
  join(code){ joinRoom(code); },
  begin(){ net.raw({t:'begin'}); },
  rooms:()=>roomListData,
  lobby:()=>lobbyInfo,
  leave(){ leaveToMenu(''); },
  setStage(i){ menuStageSel=clamp(i|0,0,STAGES.length); },
  teleport(x,y){ P.x=x; P.y=y; P.vx=P.vy=0; },
  placeMirror(x,y,angle){ const m={id:'dbg'+MP.you+'-'+(mirrorIdSeq++),x,y,angle,len:90,player:true,owner:MP.you,hp:MIRROR_HP}; playerMirrors.push(m); net.send({t:'mplace',m}); },
  give(id){ const i=POWERUPS.findIndex(p=>p.id===id); if(i>=0) applyPowerup(i); },
  shootAt(x,y){ const g=effGun(GUNS[P.gun]); shoot(g, Math.atan2(y-(P.y+23), x-(P.x+13)), 1); },
  throwBall(){ throwItem(); },
  sting(n){ sting(n||'yeah', {x:P.x+13, y:P.y}); },
  props:()=>props.map(p=>({kind:p.kind,x:p.x,y:p.y,ready:p.cdT<=0})),
  samples:()=>audio? Object.keys(audio.samples):[],
  music:()=>({key:music.mainKey, name:music.name, playing:musicActive(),
    time:music.main? +music.main.el.currentTime.toFixed(1):0,
    over:!!music.over, danger:!!music.danger, broken:Object.keys(music.broken)}),
  overlay(k){ playOverlay(k, k==='dead'?3:6); },
  P, GUNS, enemies:()=>enemies, POWERUPS, STAGES,
};
