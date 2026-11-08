import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const $=(id)=>document.getElementById(id);
const RANK={common:['Gris','#9aa0aa'],rare:['Azul','#4e9cff'],epic:['Morado','#b95cff'],legendary:['Dorado','#ffc928'],mythic:['Mítico','#ff356b']};
const BRAINROTS=[
 ['Tralalero Tralala','common',120,10,'#55c95a'],['Brr Brr Patapim','common',180,15,'#8d704c'],['Frigo Camelo','common',250,20,'#cf9d66'],['Lirili Larila','rare',600,50,'#ffd36b'],['Chimpanzini Bananini','rare',1300,130,'#f3dc42'],['Bombardiro Crocodilo','rare',2000,180,'#51ad65'],['Cappucino Assassino','epic',4000,350,'#79543f'],['Tung Tung Sahur','epic',8000,650,'#bd6831'],['Ballerina Cappucina','epic',12000,1000,'#ef87bd'],['La Vaca Saturno Saturnita','legendary',25000,2200,'#df83b5'],['Trulimero Trulicina','legendary',50000,4000,'#68a6ff'],['Girafa Celeste','legendary',80000,7000,'#81d7dd'],['Los Tralaleritos','mythic',200000,18000,'#ef4b4b'],['Matteo Supremo','mythic',450000,42000,'#ffad33'],['Brainrot Cósmico','mythic',800000,90000,'#c54cff']
];
const SDK=window.Legion?.SDK||null;
const BOXITY_SLUG='roba-al-brainrot';
let gameplayActive=false;

function initializeBoxity(){
  if(!SDK||window.__boxityInitialized)return;
  window.__boxityInitialized=true;
  try{
    SDK.init({gameSlug:BOXITY_SLUG,gameName:'Roba al Brainrot',version:'2.0.0'});
    SDK.auth?.onUserChanged?.((user)=>{
      localStorage.setItem('boxity-user-name',user?.username||user?.displayName||'Jugador');
      document.querySelector('.brand')?.setAttribute('title',user?.username?`@${user.username}`:'');
      if(player)loadAvatar();
    });
    SDK.avatar?.onAvatarChanged?.(()=>loadAvatar());
    SDK.onEnvironmentChanged?.((environment)=>console.info('Boxity environment',environment));
    console.info('Boxity environment',SDK.environment?.());
  }catch(error){console.warn('Boxity SDK initialization failed',error)}
}

function reportGameplayStart(){
  if(gameplayActive)return;
  gameplayActive=true;
  SDK?.game?.gameplayStart?.();
}
function reportGameplayEnd(){
  if(!gameplayActive)return;
  gameplayActive=false;
  SDK?.game?.gameplayEnd?.();
}

initializeBoxity();
SDK?.player?.onRespawnRequest?.(()=>{if(player)player.position.set(18,0,-43)});
let money=100, rebirth=0, slots=[], players=new Map(), creatures=[], remote=new Map(), carrying=null;
let selectedBase=null, shieldUntil=0, shieldCooldown=0, jumpVelocity=0, grounded=true;
let yaw=0,pitch=-.18,started=true,muted=false,batCooldown=0, lastIncomeSecond=-1;
const keys={},colliders=[],particles=[];
let scene,camera,renderer,player,audioContext;
const clock=new THREE.Clock();
const bases=[];

class Multiplayer {
 constructor(){this.channel=new BroadcastChannel('brainrot-roba-v1');this.channel.onmessage=e=>this.receive(e.data)}
 async init(){try{SDK?.party?.onStateChange?.(d=>this.receive(d));}catch(e){console.warn(e)} }
 send(type,data={}){const p={type,id:localStorage.getItem('brainrot-client-id'),...data,t:Date.now()};this.channel.postMessage(p);SDK?.party?.send?.(p)}
 receive(p){if(!p||p.id===localStorage.getItem('brainrot-client-id'))return;remote.set(p.id,p);if(p.type==='state')updateRemotePlayer(p)}
}
const multiplayer=new Multiplayer();
if(!localStorage.getItem('brainrot-client-id'))localStorage.setItem('brainrot-client-id',crypto.randomUUID());

function init(){
 scene=new THREE.Scene();scene.background=new THREE.Color('#72bdf4');scene.fog=new THREE.Fog('#72bdf4',55,125);
 camera=new THREE.PerspectiveCamera(68,innerWidth/innerHeight,.1,250);
 renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;$('game').appendChild(renderer.domElement);
 $('catalog').innerHTML='<b>CATÁLOGO DE BRAINROTS</b>'+BRAINROTS.map(d=>`<div class="catalog-row"><span style="color:${RANK[d[1]][1]}">${d[0]} · ${RANK[d[1]][0]}</span><b>${moneyFormat(d[2])}<br>+${moneyFormat(d[3])}/s</b></div>`).join('');
 scene.add(new THREE.HemisphereLight('#eff9ff','#5c783b',2.4));const sun=new THREE.DirectionalLight('#fff4d8',3);sun.position.set(-35,55,-25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=sun.shadow.camera.bottom=-70;sun.shadow.camera.right=sun.shadow.camera.top=70;scene.add(sun);
 buildMap();buildBases();buildPlayer();loadAvatar();createClouds();spawnCreature(true);restore();multiplayer.init();bindEvents();animate();
 SDK?.game?.loadingStep?.('Mapa y escena 3D preparados');
 SDK?.game?.loadingEnd?.();
 reportGameplayStart();
}
function box(x,z,w,d,h,color,collision=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.72}));mesh.position.set(x,h/2,z);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);if(collision)colliders.push(new THREE.Box3().setFromObject(mesh));return mesh}
function buildMap(){
 box(0,0,110,.8,.25,'#5da94c',true);box(0,0,110,110,.1,'#75bd58',false);box(0,0,15,86,.35,'#d7d2c7',true);
 for(let i=-38;i<=38;i+=10){box(0,i,.14,.14,.02,'#fff4b2',false)}
 for(let z=-38;z<=38;z+=9){box(-55,z,2,2,3,'#46673d');box(55,z,2,2,3,'#46673d')}
 for(const z of [-43,-25,25,43])for(const x of [-42,42])tree(x,z);
 for(let z=-34;z<=34;z+=17){box(-22,z,10,12,.25,'#c5c3b9',false);box(22,z,10,12,.25,'#c5c3b9',false)}
 for(let i=-42;i<=42;i+=14)lamppost(i,-48);
 const portalGeo=new THREE.TorusGeometry(5.4,.45,12,40);for(const z of [-45,45]){const p=new THREE.Mesh(portalGeo,new THREE.MeshStandardMaterial({color:'#ff355f',emissive:'#ff355f',emissiveIntensity:2}));p.position.set(0,5.5,z);p.rotation.y=Math.PI/2;scene.add(p)}
}
function tree(x,z){const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.4,.55,2.8,7),new THREE.MeshStandardMaterial({color:'#79503a'}));trunk.position.set(x,1.4,z);scene.add(trunk);const crown=new THREE.Mesh(new THREE.ConeGeometry(2.4,5,7),new THREE.MeshStandardMaterial({color:'#3b9b50',roughness:.9}));crown.position.set(x,4,z);scene.add(crown)}
function lamppost(x,z){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,4,8),new THREE.MeshStandardMaterial({color:'#293441'}));pole.position.set(x,2,z);scene.add(pole);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.28,12,8),new THREE.MeshStandardMaterial({color:'#fff3a4',emissive:'#fff19a',emissiveIntensity:2}));bulb.position.set(x,4,z);scene.add(bulb)}
function createClouds(){for(let i=0;i<12;i++){const cloud=new THREE.Group();for(let j=0;j<3;j++){const m=new THREE.Mesh(new THREE.SphereGeometry(4+Math.random()*2,12,8),new THREE.MeshBasicMaterial({color:'#fff',transparent:true,opacity:.7}));m.position.x=j*4;cloud.add(m)}cloud.position.set((i%4)*35-50,28+(i%3)*5,(Math.floor(i/4))*32-40);scene.add(cloud)}}
function label(text,color='#fff'){const c=document.createElement('canvas');c.width=512;c.height=96;const x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.font='700 34px sans-serif';x.textAlign='center';x.fillStyle='rgba(12,18,32,.75)';x.roundRect(100,18,312,58,12);x.fill();x.fillStyle=color;x.fillText(text,256,57);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false}));s.scale.set(5.4,1,1);return s}
function buildBases(){for(let i=0;i<8;i++){const left=i<4,x=left?-22:22,z=(i%4)*17-25.5;const base={id:i,name:'Base Disponible',ownerId:null,slots:Array(10).fill(null),x,z,shieldUntil:0};bases.push(base);
 box(x,z,12,13,.55,i===0?'#43d0dc':'#d7dfe5',true);for(let side=-1;side<=1;side+=2){const glass=new THREE.Mesh(new THREE.BoxGeometry(.3,4.5,13),new THREE.MeshPhysicalMaterial({color:'#70ddff',transparent:true,opacity:.23,roughness:.15}));glass.position.set(x+side*6,2.5,z);scene.add(glass);}
 const sign=label('Base Disponible');sign.position.set(x,5.5,z-6.7);sign.name='base-sign';base.sign=sign;scene.add(sign);
 const button=new THREE.Mesh(new THREE.CylinderGeometry(1.2,.9,.25,24),new THREE.MeshStandardMaterial({color:'#38e07a',emissive:'#24a852',emissiveIntensity:.7}));button.position.set(x,1,z+5);base.button=button;scene.add(button);
 const shield=new THREE.Mesh(new THREE.BoxGeometry(13.2,5.5,13.2),new THREE.MeshPhysicalMaterial({color:'#55eaff',transparent:true,opacity:.13,wireframe:true,side:THREE.DoubleSide}));shield.position.set(x,3,z);shield.visible=false;base.shield=shield;scene.add(shield);
 for(let s=0;s<10;s++){const row=Math.floor(s/5),col=s%5;const px=x+(col-2)*2.05,pz=z+(row-.5)*3.8;const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(.65,.75,.38,20),new THREE.MeshStandardMaterial({color:'#f2f7ff',emissive:'#55cfff',emissiveIntensity:.18}));pedestal.position.set(px,.75,pz);pedestal.castShadow=true;scene.add(pedestal);base.slots[s]={occupied:null,pedestal,number:s+1,p:new THREE.Vector3(px,.95,pz)}}
}}
function makeCharacter(name,color='#8ccfff',fallback=false){const g=new THREE.Group(),skin=new THREE.MeshStandardMaterial({color});const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.55,1.05,6,10),skin);torso.position.y=1.55;torso.castShadow=true;g.add(torso);const head=new THREE.Mesh(new THREE.SphereGeometry(.48,16,10),new THREE.MeshStandardMaterial({color:'#ffc995'}));head.position.y=2.62;head.castShadow=true;g.add(head);
 [-.16,.16].forEach(x=>{const eye=new THREE.Mesh(new THREE.SphereGeometry(.09,10,8),new THREE.MeshBasicMaterial({color:'#fff'}));eye.position.set(x,2.65,.42);g.add(eye);const pupil=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),new THREE.MeshBasicMaterial({color:'#15141d'}));pupil.position.set(x,2.65,.49);g.add(pupil)});
 [-.38,.38].forEach((x,i)=>{const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.72,4,8),skin);arm.position.set(x,1.55,0);g.add(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.17,.72,4,8),new THREE.MeshStandardMaterial({color:'#27385b'}));leg.position.set(x*.72,.55,0);g.add(leg);g.userData[i?'rightArm':'leftArm']=arm;g.userData[i?'rightLeg':'leftLeg']=leg});
 const bat=new THREE.Mesh(new THREE.CylinderGeometry(.065,.115,1,8),new THREE.MeshStandardMaterial({color:'#dba760',metalness:.15}));bat.position.set(.68,1.42,0);bat.rotation.z=.35;g.add(bat);g.userData.name=name;const tag=label(name);tag.position.y=3.65;g.add(tag);g.position.set(18,0,-43);return g}
function buildPlayer(){player=makeCharacter(currentUserName(),'#ffdc42');scene.add(player);selectedBase=bases[0];selectedBase.ownerId=localStorage.getItem('brainrot-client-id');selectedBase.name=currentUserName();}
function currentUserName(){return window.Legion?.SDK?.auth?.getUser?.()?.username||SDK?.auth?.currentUser?.username||localStorage.getItem('boxity-user-name')||'Jugador'}
async function loadAvatar(){try{const character=await SDK?.avatar?.getCharacter?.();if(!character?.glbUrl)return;const gltf=await new Promise((resolve,reject)=>new GLTFLoader().load(character.glbUrl,resolve,undefined,reject));const avatar=new THREE.Group();gltf.scene.scale.setScalar(1.45);avatar.add(gltf.scene);avatar.position.copy(player.position);avatar.rotation.copy(player.rotation);scene.remove(player);avatar.add(label(currentUserName()));avatar.children.at(-1).position.y=3.65;player=avatar;scene.add(player);}catch(e){console.info('Avatar fallback active',e)}}
function makeBrainrot(data,z=-43){const [name,rank,price,income,color]=data,g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color,roughness:.45,emissive:RANK[rank][1],emissiveIntensity:rank==='mythic'?.3:.08});const body=new THREE.Mesh(new THREE.SphereGeometry(.65,16,10),mat);body.scale.set(1.15,.85,1);body.position.y=.8;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.48,14,10),mat);head.position.set(0,1.45,.2);g.add(head);
 [-.18,.18].forEach(x=>{const eye=new THREE.Mesh(new THREE.SphereGeometry(.1,10,8),new THREE.MeshBasicMaterial({color:'#fff'}));eye.position.set(x,1.5,.62);g.add(eye);const pupil=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),new THREE.MeshBasicMaterial({color:'#111'}));pupil.position.set(x,1.5,.71);g.add(pupil)});
 for(const x of [-.55,.55]){const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.45,4,6),mat);leg.position.set(x,.25,.05);g.add(leg)}const aura=new THREE.Mesh(new THREE.TorusGeometry(.85,.025,6,32),new THREE.MeshBasicMaterial({color:RANK[rank][1]}));aura.rotation.x=Math.PI/2;aura.position.y=.12;g.add(aura);const tag=label(`${name} · ${RANK[rank][0]} · ${moneyFormat(price)} · +${moneyFormat(income)}/s`,RANK[rank][1]);tag.position.y=2.6;g.add(tag);g.position.set((Math.random()-.5)*2.4,0,z);g.userData={data,name,rank,price,income,color};scene.add(g);return g}
function spawnCreature(initial=false){if(!initial&&creatures.length>3)return;if(!initial&&Math.random()<.88)return spawnCreature();let pool;const r=Math.random();if(r<.06)pool=BRAINROTS.slice(12);else if(r<.18)pool=BRAINROTS.slice(9,12);else if(r<.38)pool=BRAINROTS.slice(6,9);else if(r<.64)pool=BRAINROTS.slice(3,6);else pool=BRAINROTS.slice(0,3);const creature=makeBrainrot(pool[Math.floor(Math.random()*pool.length)],-43);creatures.push(creature);multiplayer.send('spawn',{brainrot:creature.userData.name,position:[creature.position.x,-43]});if(!initial&&creature.userData.rank==='mythic')globalAlert('¡APARICIÓN MÍTICA! '+creature.userData.name)}
function canMove(position,radius=.75){if(position.x<-53||position.x>53||position.z<-53||position.z>53)return false;const sphere=new THREE.Sphere(position,radius);return !colliders.some(b=>b.intersectsSphere(sphere))}
function bindEvents(){window.addEventListener('resize',resize);document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==renderer.domElement)return;yaw-=e.movementX*.0024;pitch=Math.max(-.62,Math.min(.32,pitch-e.movementY*.0018))});renderer.domElement.addEventListener('click',()=>renderer.domElement.requestPointerLock());document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Escape')SDK?.portal?.reportEscape?.();if(e.code==='Space'){e.preventDefault();if(grounded){jumpVelocity=7.5;grounded=false;sound('jump')}}if(e.code==='KeyE')interact();if(e.code==='KeyR')openRebirth();if(e.code==='Tab'){$('catalog').classList.toggle('hidden');e.preventDefault()}if(e.code==='KeyF'){hit()}});document.addEventListener('keyup',e=>keys[e.code]=false);$('shieldBtn').onclick=toggleShield;$('rebirthBtn').onclick=openRebirth;$('catalogBtn').onclick=()=>$('catalog').classList.toggle('hidden');$('closeRebirth').onclick=()=>$('rebirth').classList.add('hidden');$('soundBtn').onclick=()=>{muted=!muted;$('soundBtn').textContent=muted?'Sonido OFF':'Sonido ON'};document.querySelectorAll('[data-rebirth]').forEach(b=>b.onclick=()=>doRebirth(+b.dataset.rebirth));}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
function updateMovement(dt){let forward=(keys.KeyW?1:0)-(keys.KeyS?1:0),right=(keys.KeyD?1:0)-(keys.KeyA?1:0);const length=Math.hypot(forward,right)||1;forward/=length;right/=length;if(forward||right){const sin=Math.sin(yaw),cos=Math.cos(yaw),speed=(carrying?5.4:7.2)*(1+rebirth*.1);const dx=(right*cos+forward*sin)*speed*dt,dz=(right*sin-forward*cos)*speed*dt;const nx=player.position.clone().setX(player.position.x+dx);if(canMove(nx))player.position.x=nx.x;const nz=player.position.clone().setZ(player.position.z+dz);if(canMove(nz))player.position.z=nz.z;const angle=Math.atan2(dx,dz);let diff=((angle-player.rotation.y+Math.PI)%(Math.PI*2))-Math.PI;player.rotation.y+=diff*(1-Math.pow(.001,dt));animateWalk(performance.now()/120)}
 jumpVelocity-=20*dt;player.position.y=Math.max(0,player.position.y+jumpVelocity*dt);if(player.position.y<=0){player.position.y=0;jumpVelocity=0;grounded=true}
 const distance=8.5-carriedPitch(),cameraDesired=new THREE.Vector3(player.position.x-Math.sin(yaw)*distance,Math.max(3,player.position.y+4),player.position.z-Math.cos(yaw)*distance);const ray=new THREE.Vector3().subVectors(cameraDesired,player.position);if(ray.length()>distance*1.1)ray.setLength(distance*1.1);const target=player.position.clone().add(ray);target.y=Math.max(2.4,target.y);camera.position.lerp(target,.13);camera.lookAt(player.position.x,player.position.y+2.1,player.position.z);
 multiplayer.send('state',{position:[player.position.x,player.position.y,player.position.z],rotation:player.rotation.y,animation:forward||right?'walk':'idle'});
}
function carriedPitch(){return carrying?-.8:0}
function animateWalk(t){const swing=Math.sin(t)*.28;if(player.userData.leftArm){player.userData.leftArm.rotation.x=swing;player.userData.rightArm.rotation.x=-swing;player.userData.leftLeg.rotation.x=-swing;player.userData.rightLeg.rotation.x=swing}}
function hit(){if(Date.now()<batCooldown)return;batCooldown=Date.now()+650;sound('hit');burst(player.position,'#ffbd4a');multiplayer.send('hit',{position:[player.position.x,player.position.y,player.position.z]})}
function interact(){const c=creatures.map(v=>({v,d:v.position.distanceTo(player.position)})).sort((a,b)=>a.d-b.d)[0];if(c&&c.d<5){buy(c.v);return}const mine=baseAtPlayer();if(mine){return}}
function baseAtPlayer(){return bases.find(b=>Math.abs(player.position.x-b.x)<7&&Math.abs(player.position.z-b.z)<7)}
function buy(creature){const data=creature.userData,owner=remote.get(creature.userData.ownerId);if(owner&&Date.now()<owner.claimUntil)return globalAlert(`${owner.name} tiene este Brainrot · E+50% para interceptar`);if(money<data.price){globalAlert('Dinero insuficiente');return}money-=data.price;creature.userData.ownerId=localStorage.getItem('brainrot-client-id');placeInBase(selectedBase,creature);sound('buy');burst(player.position,RANK[data.rank][1]);multiplayer.send('buy',{brainrot:data.name,base:selectedBase.id})}
function placeInBase(base,creature){const slot=base.slots.find(s=>!s.occupied);if(!slot)return false;slot.occupied=creature.userData.name;creature.position.copy(slot.p).add(new THREE.Vector3(0,.15,0));base.slots.forEach(s=>{if(s.occupied){} });creatures.splice(creatures.indexOf(creature),1);save();return true}
function toggleShield(){if(Date.now()<shieldCooldown)return globalAlert('Escudo en enfriamiento');const duration=rebirth>=2?40000:30000;shieldUntil=Date.now()+duration;shieldCooldown=Date.now()+65000;sound('shield');multiplayer.send('shield',{base:selectedBase?.id,until:shieldUntil});save()}
function steal(){globalAlert('Mantén E sobre un pedestal rival para cargar el Brainrot');}
function openRebirth(){$('rebirth').classList.toggle('hidden');updateRebirthPanel()}
function updateRebirthPanel(){document.querySelectorAll('[data-rebirth]').forEach(b=>{const level=+b.dataset.rebirth,unlocked=rebirth+1===level;b.classList.toggle('disabled',!unlocked||rebirth>=level);b.querySelector('.status').textContent=rebirth>=level?'COMPLETADO':unlocked?'DISPONIBLE':'BLOQUEADO'})}
function doRebirth(level){if(level!==rebirth+1||level>3)return;const owned=slots.length,legendary=slots.some(n=>{const d=BRAINROTS.find(x=>x[0]===n);return d&&['legendary','mythic'].includes(d[1])});const req=[money>=50000&&owned>=5,money>=500000&&owned>=8,money>=5000000&&owned>=10&&legendary][level-1];if(!req)return globalAlert('Requisitos incompletos');rebirth=level;money=[250,1000,5000][level-1];slots=[];sound('rebirth');globalAlert(`RENACIMIENTO ${level} COMPLETADO`);openRebirth();save()}
function moneyFormat(n){return '$'+Math.floor(n).toLocaleString('es-ES')}
function income(){return slots.reduce((sum,name)=>{const def=BRAINROTS.find(x=>x[0]===name);return sum+(def?.[3]||0)},0)*[1,1.5,2.5,4][rebirth]}
function restore(){try{const raw=localStorage.getItem('brainrot-save');const s=raw?JSON.parse(raw):{};money=s.money??100;rebirth=s.rebirth??0;slots=s.slots||[];if(!raw||(!shieldUntil&&Date.now()>=shieldUntil))shieldUntil=Date.now()+30000;}catch(e){console.warn(e);shieldUntil=Date.now()+30000}}
function save(){const s={money,rebirth,slots};localStorage.setItem('brainrot-save',JSON.stringify(s));SDK?.storage?.set?.('brainrot-save',s);SDK?.data?.save?.(s)}
function updateRemotePlayer(p){let mesh=players.get(p.id);if(!mesh){mesh=makeCharacter(p.name||'Jugador');mesh.userData.remote=true;scene.add(mesh);players.set(p.id,mesh)}mesh.position.set(...p.position||[0,0,0]);mesh.rotation.y=p.rotation||0}
function sound(type){if(muted)return;audioContext||=new (window.AudioContext||window.webkitAudioContext)();const table={buy:[520,.12,.08],hit:[110,.14,.12],shield:[740,.28,.07],coin:[880,.07,.035],jump:[330,.08,.04],rebirth:[1100,.55,.09]};const [freq,duration,gain]=table[type]||table.coin;const o=audioContext.createOscillator(),v=audioContext.createGain();o.type=type==='hit'?'sawtooth':'sine';o.frequency.setValueAtTime(freq,audioContext.currentTime);v.gain.setValueAtTime(gain,audioContext.currentTime);v.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(v).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration)}
function burst(pos,color){for(let i=0;i<18;i++){const p=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial({color}));p.position.copy(pos).add(new THREE.Vector3(0,1.5,0));scene.add(p);particles.push({mesh:p,life:1,velocity:new THREE.Vector3((Math.random()-.5)*6,Math.random()*5,(Math.random()-.5)*6)})}}
function globalAlert(text){const el=$('alert');el.textContent=text;el.classList.add('show');clearTimeout(globalAlert.t);globalAlert.t=setTimeout(()=>el.classList.remove('show'),2600)}
function updateHUD(){const now=Date.now(),shield=Math.max(0,Math.ceil((shieldUntil-now)/1000));$('money').textContent=moneyFormat(money);$('income').textContent=moneyFormat(income())+'/s · x'+[1,1.5,2.5,4][rebirth];$('slots').textContent=slots.length+'/10';$('rebirthLevel').textContent=rebirth+'/3';$('shieldText').textContent=shield?`Escudo: ${shield}s`:Math.max(0,Math.ceil((shieldCooldown-now)/1000))?`Enfriando ${Math.ceil((shieldCooldown-now)/1000)}s`:'Escudo listo';bases[0].shield.visible=shield>0;if(shield>0){bases[0].shield.rotation.y+=.02;bases[0].button.material.color.set('#55eaff')}}
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);updateMovement(dt);updateHUD();for(const c of creatures){c.position.z+=dt*.28;c.rotation.y=Math.sin(performance.now()*0.004)*.08;c.children.forEach(x=>{if(x.geometry?.type==='CapsuleGeometry')x.rotation.z=Math.sin(performance.now*.006)*.12});if(c.position.z>43){scene.remove(c);creatures.splice(creatures.indexOf(c),1)}}if(Math.random()<dt*.7)spawnCreature();const sec=Math.floor(performance.now()/1000);if(sec!==lastIncomeSecond){money+=income();lastIncomeSecond=sec;if(income())sound('coin')}particles.forEach((p,i)=>{p.life-=dt;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.scale.setScalar(Math.max(.05,p.life));if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1)}});renderer.render(scene,camera)}
init();
window.addEventListener('pagehide',reportGameplayEnd);
