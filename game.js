import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const palette = {common:'#9ca3af',rare:'#55aaff',epic:'#b65cff',legendary:'#ffd700',mythic:'#ff3848'};
const brainrots = [
 ['Tralalero Tralala','common',120,10,'#66cc66'],['Brr Brr Patapim','common',170,14,'#9b7653'],['Lirili Larila','rare',700,55,'#ffd166'],['Chimpanzini Bananini','rare',1200,85,'#ffe84b'],['Bombardiro Crocodilo','rare',1400,95,'#6ac66a'],['Cappucino Assassino','epic',4200,330,'#6f4e37'],['Tung Tung Sahur','epic',6500,520,'#b35b2a'],['La Vaca Saturno','epic',7800,590,'#ec83b0'],['Crocodildo Penispinus','legendary',20000,1500,'#3dbf84'],['Frigo Camelo','legendary',35000,2700,'#c58a55'],['Garama Garamaram','mythic',120000,8500,'#ff2f6d'],['Orangutini Ananasini','mythic',180000,12000,'#ffb000']];
const rarityNames = {common:'Común',rare:'Raro',epic:'Épico',legendary:'Legendario',mythic:'Mítico'};

const saved = JSON.parse(localStorage.getItem('brainrot-save') || 'null');
let state = saved || {money:100,shieldUntil:0,cooldownUntil:0,owned:{}};
if (!saved) state.shieldUntil = Date.now() + 30000;
let started=true, muted=false, carrying=null, stealProgress=0, yaw=0, pitch=-0.1;
let audioContext=null, batCooldown=0;
const clock=new THREE.Clock(), keys={}, creatures=[], bots=[], slots=[], particles=[];
let scene,camera,renderer,player;

class BoxitySDK {
  constructor(){ this.sdk=window.Legion?.SDK || null; this.ready=!!this.sdk; }
  async init(){
    try {
      if(window.__boxityInitialized)return;
      window.__boxityInitialized=true;
      await this.sdk?.init({gameSlug:'roba-un-brainrot',gameName:'Roba un Brainrot',version:'1.0.0'});
      this.sdk?.auth?.onUserChanged?.((user)=>localStorage.setItem('boxity-user-name',user?.username||user?.displayName||'Jugador'));
      this.sdk?.avatar?.onAvatarChanged?.(()=>this.loadPlayerAvatar());
      this.sdk?.onEnvironmentChanged?.((environment)=>console.info('Boxity environment',environment));
      console.info('Boxity environment',this.sdk?.environment?.());
      this.sdk?.game?.registerFeature?.('avatar');
      this.sdk?.game?.registerFeature?.('chat');
      this.sdk?.game?.registerFeature?.('emotes');
      this.sdk?.game?.registerFeature?.('settings');
      this.sdk?.game?.registerFeature?.('party');
      this.sdk?.game?.registerFeature?.('leaderboard');
      this.sdk?.party?.enable?.({maxPartySize:8});
      this.sdk?.game?.loadingStep?.('Escena 3D preparada');
      this.sdk?.game?.loadingEnd?.();
      this.sdk?.game?.gameplayStart?.();
      document.addEventListener('keydown',(event)=>{
        if(event.code==='Escape')this.sdk?.portal?.reportEscape?.();
      });
      window.addEventListener('pagehide',()=>this.sdk?.game?.gameplayEnd?.());
    } catch(e) { console.info('Boxity SDK initialization failed',e); }
    localStorage.setItem('boxity-session',JSON.stringify({game:'Roba un Brainrot',startedAt:Date.now()}));
  }
  save(){ if(this.sdk?.save) this.sdk.save(state); localStorage.setItem('brainrot-save',JSON.stringify(state)); }
  event(name,data={}){ const payload={game:'brainrot',event:name,...data,time:Date.now()}; if(this.sdk?.track) this.sdk.track(name,payload); if(this.sdk?.analytics?.track) this.sdk.analytics.track(name,payload); }
}
const boxity=new BoxitySDK(); boxity.init();

const boxityLoader=new GLTFLoader();
const boxityTextureLoader=new THREE.TextureLoader();
async function loadBoxityAvatar(){
  const character=await boxity.sdk?.avatar?.getCharacter?.();
  if(!character?.glbUrl || !player) return;
  boxityLoader.load(character.glbUrl,(gltf)=>{
    const oldPlayer=player;
    const avatar=new THREE.Group();
    gltf.scene.scale.setScalar(1.5);
    if(character.textureUrl){
      boxityTextureLoader.load(character.textureUrl,(texture)=>{texture.colorSpace=THREE.SRGBColorSpace;gltf.scene.traverse((child)=>{if(child.isMesh){child.material=child.material.clone();child.material.map=texture;child.material.needsUpdate=true}})});
    }
    avatar.add(gltf.scene);
    avatar.position.copy(oldPlayer.position);
    avatar.position.copy(oldPlayer.position);
    avatar.rotation.copy(oldPlayer.rotation);
    avatar.userData.fallbackAvatar=oldPlayer;
    scene.remove(oldPlayer);
    if(scene.children.includes(player)) scene.remove(player);
    player=avatar;
    scene.add(player);
  },undefined,(error)=>console.warn('Boxity avatar unavailable, using articulated fallback',error));
}
BoxitySDK.prototype.loadPlayerAvatar=loadBoxityAvatar;

function format(n){ return '$'+Math.floor(n).toLocaleString('es-ES'); }
function definition(name){ return brainrots.find(b=>b[0]===name); }
function showAlert(text,color='#ffe500'){ const el=$('alert'); el.textContent=text; el.style.color=color; el.style.opacity=1; clearTimeout(showAlert.timer); showAlert.timer=setTimeout(()=>el.style.opacity=0,1600); }
function floatText(text,pos,color='#ffe500'){ const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=64; const ctx=canvas.getContext('2d');ctx.font='900 28px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.strokeStyle='#111';ctx.lineWidth=5;ctx.strokeText(text,128,42);ctx.fillText(text,128,42); const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true}));sprite.position.copy(pos).add(new THREE.Vector3(0,2,0));sprite.scale.set(6,1.5,1);scene.add(sprite);particles.push({sprite,life:1.2}); }

function init(){
  scene=new THREE.Scene(); scene.background=new THREE.Color('#78c9ff'); scene.fog=new THREE.Fog('#78c9ff',38,95);
  camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.1,250); renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=true; $('game').appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#fff','#58644d',2.2)); const sun=new THREE.DirectionalLight('#fff7d6',2.5);sun.position.set(-20,35,10);sun.castShadow=true;scene.add(sun);
  buildMap(); buildPlayer(); buildBases(); spawnBrainrot(true); loadBoxityAvatar();
  $('catalog').innerHTML='<b>BRAINROTS</b>'+brainrots.map(b=>`<div class="cat-row"><span class="rare" style="color:${palette[b[1]]}">${b[0]}</span><span>${format(b[2])}</span></div>`).join('');
  window.addEventListener('resize',onResize); document.addEventListener('mousemove',onMouse);
  document.addEventListener('pointerlockchange',()=>{started=document.pointerLockElement===renderer.domElement || started;});
  document.addEventListener('click',(event)=>{if(event.target.closest('button'))return;if(!document.pointerLockElement)renderer.domElement.requestPointerLock();});
  renderer.domElement.addEventListener('click',()=>{if(!document.pointerLockElement)renderer.domElement.requestPointerLock();});
  $('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'🔇':'🔊'};
  $('shieldBtn').onclick=toggleShield;
  $('reset').onclick=resetGame;
  addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Tab'||e.code==='KeyM'){e.preventDefault();$('catalog').classList.toggle('hidden')}if(e.code==='KeyE')e.preventDefault()}); addEventListener('keyup',e=>keys[e.code]=false);
  animate();
}

function ground(x,z,w,d,color){const m=new THREE.Mesh(new THREE.BoxGeometry(w,.2,d),new THREE.MeshStandardMaterial({color}));m.position.set(x,-.1,z);m.receiveShadow=true;scene.add(m);return m}
function buildMap(){
  ground(0,0,110,110,'#8fcf66'); ground(0,0,12,86,'#d5c8aa'); ground(0,-43,12,14,'#b6a98d'); ground(0,43,12,14,'#b6a98d');
  for(let i=-35;i<=35;i+=10){ground(0,i,.18,.18,'#fff1a6'); ground(0,i+5,.18,.18,'#fff1a6')}
  for(let z=-34;z<=34;z+=17){for(const x of [-13,13]){ground(x,z,14,13,'#75b950')}}
}
function makeText(text,color='#fff'){const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');x.font='900 54px sans-serif';x.textAlign='center';x.fillStyle=color;x.fillText(text,256,82);const tex=new THREE.CanvasTexture(c);return new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true}))}
function buildBases(){
  const sideZ=[-34,-17,0,17]; let ownerIndex=0;
  for(const side of [-1,1]){for(const z of sideZ){
    const base={id:ownerIndex++,owner:ownerIndex===1?'Tú':`Bot ${ownerIndex-1}`,x:side*18,z,slots:Array(10).fill(null),shield:new THREE.Mesh(),shieldUntil:0};
    const wallMat=new THREE.MeshStandardMaterial({color:base.owner==='Tú'?'#40c9d6':'#d96d7c'});
    [[side*18-.7,z-6.5],[side*18+.7,z-6.5],[side*18-.7,z+6.5],[side*18+.7,z+6.5]].forEach(p=>{const w=new THREE.Mesh(new THREE.BoxGeometry(1.4,2.4,1.4),wallMat);w.position.set(p[0],1.2,p[1]);w.castShadow=true;scene.add(w)});
    base.sign=new THREE.Group(); const sign=makeText(base.owner);sign.scale.set(7,1.75,1);sign.position.set(base.x,5.2,base.z);scene.add(sign);base.sign=sign;
    for(let i=0;i<10;i++){const row=Math.floor(i/5),col=i%5;const sx=base.x+(col-2)*1.9;const sz=base.z+(row-.5)*3.2;const ped=new THREE.Mesh(new THREE.CylinderGeometry(.65,.75,.45,16),new THREE.MeshStandardMaterial({color:'#e9edf4',roughness:.35}));ped.position.set(sx,.22,sz);ped.receiveShadow=true;scene.add(ped);slots.push({base,sx,sz,ped,occupied:null})}
    base.shield=new THREE.Mesh(new THREE.BoxGeometry(13,7,13),new THREE.MeshPhysicalMaterial({color:'#4feaff',transparent:true,opacity:.17,wireframe:true}));base.shield.position.set(base.x,3.5,base.z);base.shield.visible=false;scene.add(base.shield);
    bases.push(base);
  }}
  bases[0].owner='Tú';
  bots.push(...bases.slice(1).map((base,i)=>{const bot={base,next:0,phase:i*Math.PI/2,carrying:null};bot.avatar=makeCharacter(['#a6d8ff','#ff78b7','#9ce069','#c9a4ff'][i],base.owner);bot.avatar.position.set(base.x+(i%2?1:-1)*5,0,base.z+6);bot.avatar.rotation.y=Math.PI;scene.add(bot.avatar);return bot}));
}
const bases=[];
function buildPlayer(){player=makeCharacter('#ffdc36','TÚ',true);player.position.set(18,0,-42);scene.add(player);camera.position.copy(player.position).add(new THREE.Vector3(0,5,9));}
function makeCharacter(color,name,playerCharacter=false){const g=new THREE.Group();const skin=new THREE.MeshStandardMaterial({color});const pants=new THREE.MeshStandardMaterial({color:'#263447'});const body=new THREE.Mesh(new THREE.CapsuleGeometry(.55,1.05,5,8),skin);body.position.y=1.55;body.castShadow=true;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.48,16,8),new THREE.MeshStandardMaterial({color:'#ffcf8a'}));head.position.y=2.65;head.castShadow=true;g.add(head);[-.16,.16].forEach(x=>{const eye=new THREE.Mesh(new THREE.SphereGeometry(.09,10,8),new THREE.MeshStandardMaterial({color:'#fff'}));eye.position.set(x,2.68,.43);g.add(eye);const pupil=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),new THREE.MeshBasicMaterial({color:'#17131f'}));pupil.position.set(x,2.68,.51);g.add(pupil)});[-.38,.38].forEach((x,i)=>{const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.75,4,6),skin);arm.position.set(x,1.58,0);arm.rotation.z=x>0?-0.12:0.12;g.add(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.16,.72,4,6),pants);leg.position.set(x*.7,0.55,0);g.add(leg);if(i===0){g.userData.leftArm=arm;g.userData.leftLeg=leg}else{g.userData.rightArm=arm;g.userData.rightLeg=leg}});if(playerCharacter){const bat=new THREE.Mesh(new THREE.CylinderGeometry(.07,.11,.95,8),new THREE.MeshStandardMaterial({color:'#d98b45'}));bat.rotation.z=.35;bat.position.set(.72,1.7,.15);g.add(bat)}const cap=new THREE.Mesh(new THREE.BoxGeometry(.86,.12,.86),new THREE.MeshStandardMaterial({color:name==='TÚ'?'#f4f4f4':'#d95b82'}));cap.position.set(0,3.04,.05);g.add(cap);const label=makeFloatingLabel(name,playerCharacter?'#ffe500':'#fff');label.position.set(0,4,0);g.add(label);return g}
function makeBrainrot(def,pos){
  const g=new THREE.Group();const mat=new THREE.MeshStandardMaterial({color:def[4],roughness:.55,emissive:def[1]==='mythic'?def[4]:0,emissiveIntensity:.12});
  const body=new THREE.Mesh(new THREE.SphereGeometry(.55,16,10),mat);body.scale.set(1,.8,1.35);body.position.y=.85;body.castShadow=true;g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.43,12,8),mat);head.position.set(0,1.25,.6);head.castShadow=true;g.add(head);
  const eye=new THREE.MeshStandardMaterial({color:'#fff'});[-.15,.15].forEach(x=>{const e=new THREE.Mesh(new THREE.SphereGeometry(.1,8,8),eye);e.position.set(x,1.3,.98);g.add(e)});
  const glow=new THREE.Mesh(new THREE.TorusGeometry(.75,.025,5,20),new THREE.MeshBasicMaterial({color:palette[def[1]]}));glow.rotation.x=Math.PI/2;glow.position.y=.12;g.add(glow);
  [-.55,.55].forEach(x=>{const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.42,4,6),mat);leg.position.set(x,.38,.05);leg.rotation.z=x>0?-0.25:0.25;g.add(leg)});
  const hat=new THREE.Mesh(new THREE.CylinderGeometry(.18,.4,.12,12),new THREE.MeshStandardMaterial({color:palette[def[1]],emissive:palette[def[1]],emissiveIntensity:.25}));hat.position.set(0,1.72,.42);hat.rotation.x=.15;g.add(hat);
  const label=makeFloatingLabel(`${def[0]} · ${rarityNames[def[1]]}\n${format(def[2])} · +${format(def[3])}/s`,palette[def[1]]);label.position.set(0,2.35,0);g.add(label);
  g.position.copy(pos);scene.add(g);return {mesh:g,def,name:def[0],rarity:def[1],owner:null,target:null,speed:.35+Math.random()*.18};
}
function spawnBrainrot(initial=false){let def;
  if(Math.random()<.025)def=definition(brainrots[10+Math.floor(Math.random()*2)]);else {const r=Math.random();const pool=r<.45?brainrots.slice(0,2):r<.72?brainrots.slice(2,5):r<.92?brainrots.slice(5,8):brainrots.slice(8,10);def=pool[Math.floor(Math.random()*pool.length)]}
  const creature=makeBrainrot(def,new THREE.Vector3((Math.random()-.5)*3,0,-42));creatures.push(creature);if(!initial)showAlert(`APARECIÓ ${def[0]}`,palette[def[1]]);
  if(!initial)boxity.event('brainrot_spawned',{brainrot:def[0],rarity:def[1]});
}

function distance(a,b){return a.position.distanceTo(b)}
function income(){return bases[0].slots.reduce((sum,slot)=>{const def=slot && definition(slot);return sum+(def?def[3]:0)},0)}
function occupied(){return bases[0].slots.filter(Boolean).length}
function placeInBase(base,brainrot){const slot=basesSlots(base).find(s=>!s.occupied);if(!slot)return false;slot.occupied=brainrot.name;brainrot.owner=base.owner;base.slots[basesSlots(base).indexOf(slot)]=brainrot.name;brainrot.mesh.position.set(slot.sx,brainrot.mesh.position.y,slot.sz);brainrot.mesh.rotation.y=Math.random()*6.28;scene.remove(brainrot.mesh);scene.add(brainrot.mesh);return true}
function basesSlots(base){return slots.filter(s=>s.base===base)}

function nearestCreature(){return creatures.filter(c=>!c.owner).sort((a,b)=>distance(a.mesh,player)-distance(b.mesh,player))[0]}
function interact(){
  const creature=nearestCreature();
  if(creature && distance(creature.mesh,player)<4.5){
    const extra=creature.owner?creature.def[2]*0.35:0;const price=creature.owner?Math.ceil(creature.def[2]*1.35):creature.def[2];
    if(!creature.owner){if(state.money>=price){state.money-=price;sound('buy');scene.remove(creature.mesh);buyBrainrot(creature);showAlert(`¡COMPRADO! ${format(price)}`)}else showAlert('DINERO INSUFICIENTE','#ff7070')}
    return;
  }
  const nearSlot=slots.map(s=>({...s,d:distance(s.ped,player)})).sort((a,b)=>a.d-b.d)[0];
  if(nearSlot && nearSlot.d<3.2 && nearSlot.occupied && nearSlot.base.owner!== 'Tú'){if(Date.now()<nearSlot.base.shieldUntil){showAlert('BASE PROTEGIDA','#60efff');return} stealBrainrot(nearSlot)}
}
function buyBrainrot(creature){const mesh=makeBrainrot(creature.def,creature.mesh.position.clone());const brainrot={...creature,mesh};if(placeInBase(bases[0],brainrot)){showAlert(`+ ${brainrot.name} en tu base`);burst(player.position,palette[brainrot.rarity]);boxity.event('brainrot_bought',{brainrot:brainrot.name,price:brainrot.def[2]});}else showAlert('NO QUEDAN SLOTS','#ff7070');creatures.splice(creatures.indexOf(creature),1);save();}
function stealBrainrot(slot){if(!carrying){carrying={slot,name:slot.occupied};stealProgress=0;const def=definition(slot.occupied);const mesh=creatures.find(c=>c.name===slot.occupied)?.mesh||makePickup(slot.occupied,slot.base);carrying.mesh=mesh;showAlert(`SOSTÉN E · ${slot.occupied}`)}}
function makePickup(name){const b=brainrots.find(x=>x[0]===name);return makeBrainrot(b,new THREE.Vector3(0,0,0)).mesh}

function makeFloatingLabel(text,color){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(8,12,24,.82)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle=color;ctx.lineWidth=9;ctx.strokeRect(4,4,canvas.width-8,canvas.height-8);ctx.fillStyle='#fff';ctx.font='900 48px sans-serif';ctx.textAlign='center';const lines=text.split('\n');lines.forEach((line,i)=>ctx.fillText(line,512,70+i*58));const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false}));sprite.scale.set(lines.length>1?10:8,lines.length>1?2.1:1.4,1);return sprite}
function sound(type){if(muted)return;audioContext ||= new (window.AudioContext||window.webkitAudioContext)();const tones={buy:[440,.12,.08],steal:[180,.2,.14],shield:[720,.35,.06],income:[880,.08,.03],hit:[90,.16,.18]};const [start,duration,gain]=tones[type]||tones.buy;const oscillator=audioContext.createOscillator(),volume=audioContext.createGain();oscillator.type=type==='hit'?'sawtooth':'square';oscillator.frequency.setValueAtTime(start,audioContext.currentTime);if(type==='shield')oscillator.frequency.exponentialRampToValueAtTime(1200,audioContext.currentTime+duration);volume.gain.setValueAtTime(gain,audioContext.currentTime);volume.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);oscillator.connect(volume).connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+duration)}
function burst(pos,color){for(let i=0;i<14;i++){const p=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.12),new THREE.MeshBasicMaterial({color:i%2?color:'#fff'}));p.position.copy(pos);p.position.y+=1;scene.add(p);particles.push({sprite:p,velocity:new THREE.Vector3((Math.random()-.5)*5,Math.random()*4,(Math.random()-.5)*5),life:1})}}
function save(){state.owned=bases[0].slots.filter(Boolean);boxity.save()}
function resetGame(){localStorage.removeItem('brainrot-save');state={money:100,shieldUntil:0,cooldownUntil:0,owned:{}};location.reload()}
function toggleShield(){if(Date.now()<state.cooldownUntil)return showAlert('ESCUDO ENFRIANDO','#ff7070');state.shieldUntil=Date.now()+30000;state.cooldownUntil=Date.now()+65000;bases[0].shield.visible=true;showAlert('ESCUDO ACTIVADO · 30s','#58efff');sound('shield');boxity.event('shield_activated');save()}

function onMouse(e){if(document.pointerLockElement!==renderer.domElement)return;yaw-=e.movementX*.0025;pitch-=e.movementY*.0018;pitch=Math.max(-.65,Math.min(.55,pitch))}
function onResize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}

function updatePlayer(dt){if(!started)return;let forward=(keys.KeyW?1:0)-(keys.KeyS?1:0),right=(keys.KeyD?1:0)-(keys.KeyA?1:0);if(forward||right){const len=Math.hypot(forward,right);forward/=len;right/=len;const speed=carrying?4.2:7;const sin=Math.sin(yaw),cos=Math.cos(yaw);player.position.x+=(right*cos+forward*sin)*speed*dt;player.position.z+=(right*sin-forward*cos)*speed*dt;player.rotation.y=yaw;const walk=Math.sin(performance.now()*.012)*.18;player.userData.leftArm&&(player.userData.leftArm.rotation.x=walk,player.userData.rightArm.rotation.x=-walk)}
  player.position.x=Math.max(-48,Math.min(48,player.position.x));player.position.z=Math.max(-49,Math.min(49,player.position.z));
  const dist=9-Math.sin(pitch)*6;camera.position.set(player.position.x-Math.sin(yaw)*dist,4+Math.cos(pitch)*4,player.position.z-Math.cos(yaw)*dist);camera.lookAt(player.position.x,2,player.position.z);
  if(keys.KeyF && Date.now()>batCooldown){batCooldown=Date.now()+650;sound('hit');showAlert('¡GOLPE!','#ffb347')}
  if(keys.KeyE){if(carrying){stealProgress+=dt;if(stealProgress>.65){carrying.slot.occupied=null;const idx=basesSlots(carrying.slot.base).indexOf(carrying.slot);carrying.slot.base.slots[idx]=null;scene.remove(carrying.mesh);showAlert(`CARGANDO ${carrying.name}`)}}else if(!interact.lock){interact();interact.lock=true;setTimeout(()=>interact.lock=false,350)}}
  else {if(carrying&&stealProgress>0){const home=bases[0];if(player.position.distanceTo(new THREE.Vector3(home.x,0,home.z))<8){const brain=makeBrainrot(definition(carrying.name),player.position);brain.owner='Tú';if(placeInBase(home,brain)){scene.remove(brain.mesh);showAlert(`¡GUARDADO!`);burst(player.position,'#58efff');boxity.event('brainrot_stolen',{brainrot:carrying.name});save()} } else {carrying.slot.occupied=carrying.name;const idx=basesSlots(carrying.slot.base).indexOf(carrying.slot);carrying.slot.base.slots[idx]=carrying.name;if(carrying.mesh)carrying.mesh.position.copy(carrying.slot.ped.position)};carrying=null;stealProgress=0}}
}
function updateCreatures(dt){for(const c of [...creatures]){if(!c.owner){c.mesh.position.z+=c.speed*dt;if(c.mesh.position.z>42){scene.remove(c.mesh);creatures.splice(creatures.indexOf(c),1)}}else if(!c.mesh.parent&&c.owner){c.mesh.visible=false}}
  if(!creatures.length||Math.random()<dt*.22)spawnBrainrot();
}
function updateBots(dt){
  bots.forEach((bot,i)=>{const phase=performance.now()*.004+i;bot.avatar.userData.leftArm.rotation.x=Math.sin(phase)*.18;bot.avatar.userData.rightArm.rotation.x=-Math.sin(phase)*.18;if(Date.now()<bot.next)return;bot.next=Date.now()+3500+i*350;const source=[...creatures].filter(c=>!c.owner&&distance(c.mesh,player)>8).sort((a,b)=>a.def[2]-b.def[2])[0];if(!source)return;if(placeInBase(bot.base,source)){scene.remove(source.mesh);creatures.splice(creatures.indexOf(source),1);boxity.event('bot_bought',{bot:bot.base.owner,brainrot:source.name});floatText(`BOT + ${source.name}`,bot.base.shield.position,'#ff9ce8')} else if(Date.now()>=bases[0].shieldUntil){attemptBotSteal(bot)}})
}
function attemptBotSteal(bot){const candidates=slots.filter(s=>s.base===bases[0]&&s.occupied);if(!candidates.length)return;const slot=candidates[Math.floor(Math.random()*candidates.length)];slot.occupied=null;bases[0].slots[basesSlots(bases[0]).indexOf(slot)]=null;showAlert(`${bot.base.owner} robó un Brainrot`,'#ff7788');sound('steal')}
function updateShield(){const now=Date.now();if(now>=state.shieldUntil)bases[0].shield.visible=false;else {bases[0].shield.visible=true;bases[0].shield.rotation.y+=.01}bases[0].shieldUntil=state.shieldUntil;if(state.money>=100000&&!state.awarded)state.awarded=true}
function updateHud(){ $('money').textContent=format(state.money); $('income').textContent=format(income())+'/s';$('slots').textContent=`${occupied()}/10`;const left=Math.max(0,Math.ceil((state.shieldUntil-Date.now())/1000));const cooldown=Math.max(0,Math.ceil((state.cooldownUntil-Date.now())/1000));$('shield').textContent=left?`${left===30?'Escudo inicial':'Escudo'}: ${left}s`:cooldown?`Enfriando: ${cooldown}s`:'Escudo listo · 30s';const c=nearestCreature();let text='';if(c&&distance(c.mesh,player)<4.5)text=`${c.name} · ${format(c.def[2])}  — E para comprar`;else if(carrying)text=`Lleva ${carrying.name} a tu base`;else text='';$('interaction').textContent=text;$('interaction').style.opacity=text?1:0}
let lastIncomeSecond=0;
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);updatePlayer(dt);updateCreatures(dt);updateBots(dt);updateShield();state.money+=income()*dt;save();updateHud();if(income()>0&&Math.floor(performance.now()/1000)!==lastIncomeSecond){lastIncomeSecond=Math.floor(performance.now()/1000);sound('income')}for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.velocity)p.sprite.position.addScaledVector(p.velocity,dt);if(p.sprite){p.sprite.material.opacity=Math.max(0,p.life);if(p.life<=0){scene.remove(p.sprite);particles.splice(i,1)}}}renderer.render(scene,camera)}

init();
