import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BRAINROTS, RARITIES } from './brainrots.js';

const SDK = window.Legion?.SDK || null;
const GAME_SLUG = 'roba-brainrot';
const MONEY_LIMIT = 1e12;
const saveKey = 'roba-brainrot-save-v2';
const state = loadState();
let scene, camera, renderer, clock, player, playerBat, selectedBrainrot, carrying;
let audio, shieldUntil = 0, shieldCooldown = 0, stealProgress = 0, jumpVelocity = 0, grounded = true;
let yaw = 0, pitch = -.18, lastIncomeTick = 0, botTick = 0, muted = false;
let hitCooldown = 0, stunnedUntil = 0;
const keys = {};
const bots = [];
const conveyorItems = [];
const bases = [];
const remotePlayers = new Map();
const playerParts = {};
const colliders = [];
const joystick = { x: 0, y: 0 };
const multiplayer = new BroadcastChannel('roba-brainrot-v2');
let boxityAvatarProfile = null;
let incomeBoostUntil = 0;
let boxityEnvironment = null;

function loadState() {
  try {
    return Object.assign({ money: 100, rebirth: 0, slots: [], upgrades: {}, speedUntil: 0, shieldBonus: 0, powerBonus: 0 }, JSON.parse(localStorage.getItem(saveKey) || '{}'));
  } catch {
    return { money: 100, rebirth: 0, slots: [], upgrades: {}, speedUntil: 0, shieldBonus: 0, powerBonus: 0 };
  }
}

function save() {
  localStorage.setItem(saveKey, JSON.stringify(state));
  SDK?.storage?.set?.(saveKey, state);
  SDK?.data?.save?.(state);
  SDK?.leaderboard?.submit?.('wealth', state.money);
  SDK?.stats?.increment?.('brainrot_investment', income());
  SDK?.leaderboards?.submit?.('wealth', state.money);
  SDK?.leaderboard?.submit?.('money', state.money);
}

function initializeBoxity() {
  if (!SDK || window.__brainrotSdkInitialized) return;
  window.__brainrotSdkInitialized = true;
  boxityEnvironment = SDK.getEnvironment?.() || SDK.portal?.getEnvironment?.() || SDK.environment?.get?.() || null;
  SDK.auth?.onUserChanged?.((user) => {
    localStorage.setItem('boxity-user-name', user?.username || user?.displayName || 'Jugador');
    loadRealAvatar();
  });
  SDK.avatar?.onAvatarChanged?.(loadRealAvatar);
  ['avatar', 'chat', 'emotes', 'settings', 'touch_controls', 'party', 'leaderboard'].forEach((feature) => SDK.game?.registerFeature?.(feature));
  SDK.party?.enable?.({ maxPartySize: 6 });
  SDK.player?.onEvent?.((event) => {
    if (event === 'play_emote') animateEmote();
  });
  SDK.avatar?.playEmote?.({ wheel: true });
  SDK.emotes?.enableWheel?.();
  SDK.party?.enableInvite?.();
  SDK.party?.enableInvites?.();
  SDK.chat?.enableBubbles?.({ enabled: true });
  SDK.matchmaking?.join?.({ gameSlug: GAME_SLUG });
  SDK.matchmaker?.join?.({ gameSlug: GAME_SLUG });
  SDK.portal?.onPointerLock?.((locked) => syncPointerLockWithPortal(locked));
  SDK.portal?.onMenu?.((open) => syncPortalMenu(open));
  SDK.player?.onReset?.(() => resetCharacter());
  SDK.game?.onResetCharacter?.(() => resetCharacter());
  SDK.settings?.listen?.('master_volume', (value) => applyMasterVolume(value));
  SDK.settings?.listen?.('music_volume', (value) => applyMusicVolume(value));
  SDK.settings?.listen?.('graphics_quality', (value) => setGraphicsQuality(value));
  SDK.settings?.listen?.('camera_sensitivity', (value) => cameraSensitivity = Number(value) || cameraSensitivity);
  const settings = {
    master_volume: () => {},
    music_volume: () => {},
    graphics_quality: (value) => renderer?.setPixelRatio(Math.min(devicePixelRatio, value === 'low' ? 1 : value === 'high' ? 2 : 1.5)),
    camera_sensitivity: (value) => { cameraSensitivity = Number(value) || 1; }
  };
  Object.entries(settings).forEach(([key, listener]) => SDK.settings?.listen?.(key, listener));
  SDK.game?.loadingStep?.('Boxity environment detected');
  SDK.game?.loadingStep?.('Arena y jugadores preparados');
  try {
    SDK.init({
      gameSlug: GAME_SLUG,
      gameName: 'Roba un Brainrot 3D',
      version: '2.0.0'
    });
  } catch (error) {
    console.info('Inicializacion Boxity pendiente:', error?.message || 'SDK no disponible');
  }
}

function syncPointerLockWithPortal(locked) {
  if (!locked && document.pointerLockElement === renderer?.domElement) document.exitPointerLock?.();
}

function syncPortalMenu(open) {
  if (!open) return;
  document.exitPointerLock?.();
}

function applyMasterVolume(value) {
  if (audio) audio.masterGain?.gain?.setValueAtTime?.(Number(value) || 0, audio.currentTime);
}

function applyMusicVolume(value) {
  document.documentElement.style.setProperty('--boxity-music-volume', String(value ?? 1));
}

function setGraphicsQuality(value) {
  renderer?.setPixelRatio?.(Math.min(devicePixelRatio, value === 'low' ? 1 : value === 'high' ? 2 : 1.5));
}

function resetCharacter() {
  player?.position?.set(0, 0, 10);
  stunnedUntil = 0;
  carrying = null;
  notify('Personaje reiniciado por Boxity');
}

function showDeathScreen(cause = 'golpe de rival') {
  SDK?.player?.announceDeath?.(cause);
  SDK?.portal?.showDeathScreen?.({ title: 'El personaje fue eliminado', reason: cause, respawn: resetCharacter });
  notify(`Eliminado: ${cause}`);
  resetCharacter();
}

function boxitySdkAssetApi() {
  return SDK?.assets || SDK?.world || SDK?.catalog || SDK?.materials || null;
}

async function resolveBoxityAsset(path, fallbackUrl) {
  const api = boxitySdkAssetApi();
  if (!api) return fallbackUrl;
  try {
    const resolver = api.resolve || api.get || api.loadAsset;
    if (!resolver) return fallbackUrl;
    const result = await resolver.call(api, path);
    return typeof result === 'string' ? result : result?.url || result?.assetUrl || fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

function officialAvatarDescriptor(character = {}) {
  return {
    glbUrl: character.glbUrl || character.modelUrl || character.url || null,
    textureUrl: character.textureUrl || character.skinUrl || character.materialUrl || null
  };
}

async function loadOfficialAvatarModel(target, descriptor, name) {
  if (!descriptor?.glbUrl || !target) return false;
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().load(descriptor.glbUrl, resolve, undefined, reject);
  });
  if (descriptor.textureUrl) {
    const texture = await new Promise((resolve) => {
      new THREE.TextureLoader().load(descriptor.textureUrl, resolve, undefined, () => resolve(null));
    });
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      gltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.material.map = texture;
        child.material.needsUpdate = true;
      });
    }
  }
  const root = new THREE.Group();
  gltf.scene.scale.setScalar(1.5);
  root.add(gltf.scene);
  root.add(makeLabel(name));
  root.children.at(-1).position.y = 3.55;
  root.position.copy(target.position);
  root.rotation.copy(target.rotation);
  root.userData.boxityAvatar = true;
  scene.remove(target);
  scene.add(root);
  return root;
}

let cameraSensitivity = 1;
function init() {
  initializeBoxity();
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#83d8ff');
  scene.fog = new THREE.Fog('#83d8ff', 55, 120);
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .1, 250);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);
  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight('#fff', '#4b744d', 2.2));
  const sun = new THREE.DirectionalLight('#fff5d9', 2.8);
  sun.position.set(-20, 45, 15);
  sun.castShadow = true;
  scene.add(sun);

  buildWorld();
  applyBoxityWorldMaterials();
  buildPlayer();
  buildBots();
  buildConveyor();
  bindEvents();
  loadRealAvatar();
  setupMultiplayer();
  renderRebirth();
  SDK?.game?.loadingEnd?.();
  SDK?.game?.gameplayStart?.();
  animate();
}

function box(w, h, d, color, x = 0, z = 0, collision = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collision) colliders.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

function buildWorld() {
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(48, 51, 2, 12), new THREE.MeshStandardMaterial({ color: '#70bd52', roughness: .85 }));
  ground.position.y = -1;
  ground.userData.boxityMaterial = 'ground';
  ground.receiveShadow = true;
  scene.add(ground);
  const roadVertical = box(8, .4, 46, '#d7d2c3', 0, 0);
  const roadHorizontal = box(46, .3, 5, '#c8c1ae', 0, 0);
  roadVertical.userData.boxityMaterial = 'road';
  roadHorizontal.userData.boxityMaterial = 'road';
  box(.15, .08, 42, '#fff08b', 0, 0);
  for (let z = -20; z <= 20; z += 8) box(.08, .07, 3, '#fff08b', 0, z);

  const angles = [-150, -90, -30, 30, 90, 150];
  angles.forEach((angle, index) => buildBase(index, THREE.MathUtils.degToRad(angle)));

  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2;
    const radius = 43 + (i % 3);
    const tree = new THREE.Group();
    tree.userData.boxityMaterial = 'tree';
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35, .55, 2.8, 7), new THREE.MeshStandardMaterial({ color: '#79503a' }));
    trunk.position.y = 1.4;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 7), new THREE.MeshStandardMaterial({ color: i % 2 ? '#3ca953' : '#50b960' }));
    crown.position.y = 4;
    tree.add(trunk, crown);
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    scene.add(tree);
  }
}

async function applyBoxityWorldMaterials() {
  const api = boxitySdkAssetApi();
  if (!api) return;
  const assets = ['ground', 'road', 'base', 'shield', 'conveyor', 'tree', 'pedestal', 'skybox'];
  await Promise.all(assets.map(async (asset) => {
    const url = await resolveBoxityAsset(`world/${asset}`, null);
    if (!url) return;
    if (asset === 'skybox') {
      new THREE.TextureLoader().load(url, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
        scene.environment = texture;
      }, undefined, () => {});
      return;
    }
    const texture = await new Promise((resolve) => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => resolve(null));
    });
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    scene.traverse((object) => {
      if (!object.isMesh) return;
      let owner = object;
      while (owner && owner.userData.boxityMaterial !== asset) owner = owner.parent;
      if (!owner) return;
      object.material.map = texture;
      object.material.needsUpdate = true;
    });
  }));
}

function buildBase(index, angle) {
  const radius = 34;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const platform = box(16, .7, 16, index === 0 ? '#4bd9df' : '#dfe5eb', x, z);
  platform.userData.boxityMaterial = 'base';
  platform.rotation.y = -angle;
  const base = { index, x, z, angle, owner: index === 0 ? currentUser() : `Jugador Bot ${index}`, slots: [], shieldUntil: index === 0 ? Date.now() + 45000 : 0, owned: false };
  const sign = makeLabel(base.owner);
  sign.position.set(x, 5.5, z);
  scene.add(sign);
  base.sign = sign;

  const shield = new THREE.Mesh(new THREE.BoxGeometry(16.5, 5, 16.5), new THREE.MeshPhysicalMaterial({ color: '#53e4ff', transparent: true, opacity: .12, wireframe: true }));
  shield.userData.boxityMaterial = 'shield';
  shield.position.set(x, 3, z);
  shield.visible = false;
  scene.add(shield);
  base.shield = shield;

  for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
    const row = Math.floor(slotIndex / 4);
    const col = slotIndex % 4;
    const localX = (col - 1.5) * 3.3;
    const localZ = row ? 3.2 : -3.2;
    const world = pedestalPosition(x, z, angle, localX, localZ);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.7, .8, .38, 16), new THREE.MeshStandardMaterial({ color: '#f4f8ff', emissive: '#52dfff', emissiveIntensity: .25 }));
    pedestal.userData.boxityMaterial = 'pedestal';
    pedestal.position.copy(world);
    scene.add(pedestal);
    base.slots.push({ pedestal, brainrot: null, position: world.clone() });
  }
  bases.push(base);
}

function pedestalPosition(cx, cz, angle, lx, lz) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return new THREE.Vector3(cx + lx * cos - lz * sin, .55, cz + lx * sin + lz * cos);
}

function makeLabel(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d');
  context.font = '800 38px Arial';
  context.textAlign = 'center';
  context.fillStyle = 'rgba(12,18,32,.85)';
  context.roundRect(75, 17, 362, 62, 16); context.fill();
  context.fillStyle = color; context.fillText(text, 256, 58);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(7, 1.31, 1);
  return sprite;
}

function makeCharacter(name, color = '#ffd147', bot = false) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.5, 1, 5, 8), material);
  torso.position.y = 1.55; torso.castShadow = true; group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.48, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffc994' }));
  head.position.y = 2.55; head.castShadow = true; group.add(head);
  [-.16, .16].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
    eye.position.set(x, 2.58, .42); group.add(eye);
  });
  playerParts.leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .7, 4, 6), material);
  playerParts.rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .7, 4, 6), material);
  playerParts.leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .68, 4, 6), new THREE.MeshStandardMaterial({ color: '#27385c' }));
  playerParts.rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .68, 4, 6), new THREE.MeshStandardMaterial({ color: '#27385c' }));
  playerParts.leftArm.position.set(-.65, 1.55, 0); playerParts.rightArm.position.set(.65, 1.55, 0);
  playerParts.leftLeg.position.set(-.24, .55, 0); playerParts.rightLeg.position.set(.24, .55, 0);
  group.add(playerParts.leftArm, playerParts.rightArm, playerParts.leftLeg, playerParts.rightLeg);
  playerBat = new THREE.Mesh(new THREE.CylinderGeometry(.09, .14, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#d8a15d', metalness: .2 }));
  playerBat.position.set(.75, 1.45, .3); playerBat.rotation.x = -.5; group.add(playerBat);
  const tag = makeLabel(name);
  tag.position.y = 3.55; group.add(tag);
  group.userData.parts = { leftArm: playerParts.leftArm, rightArm: playerParts.rightArm, leftLeg: playerParts.leftLeg, rightLeg: playerParts.rightLeg, tag };
  group.userData.bot = bot;
  return group;
}

function buildPlayer() {
  player = makeCharacter(currentUser(), '#ffd147');
  player.position.set(18, 0, 0);
  scene.add(player);
}

function buildBots() {
  const colors = ['#65aaff', '#ff6d8d', '#9ce060', '#c090ff', '#55d4c2'];
  for (let i = 1; i < 6; i++) {
    const bot = makeCharacter(`Bot ${i}`, colors[i - 1], true);
    bot.position.set(bases[i].x + (i % 2 ? -3 : 3), 0, bases[i].z);
    scene.add(bot);
    bots.push({ mesh: bot, base: bases[i], target: null, nextAction: 0 + i * 650, carrying: null });
  }
}

async function loadRealAvatar() {
  try {
    const character = await SDK?.avatar?.getCharacter?.();
    if (!character || !player) return;
    boxityAvatarProfile = officialAvatarDescriptor(character);
    const officialPlayer = await loadOfficialAvatarModel(player, boxityAvatarProfile, currentUser());
    if (officialPlayer) player = officialPlayer;
    announceAvatarProfile();
  } catch (error) {
    console.info('Avatar oficial de Boxity no disponible en este momento.', error?.message || error);
  }
}

function buildConveyor() {
  const belt = new THREE.Mesh(new THREE.BoxGeometry(7, .35, 42), new THREE.MeshStandardMaterial({ color: '#e94459', roughness: .45 }));
  belt.userData.boxityMaterial = 'conveyor';
  belt.position.y = .18; scene.add(belt);
  for (let z = -19; z <= 19; z += 4) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.1, .05, .16), new THREE.MeshBasicMaterial({ color: '#ff9aa6' }));
    stripe.position.set(0, .42, z); scene.add(stripe);
  }
  spawnConveyorItem(true);
  setInterval(() => { if (conveyorItems.length < 5 && !document.hidden) spawnConveyorItem(); }, 2800);
}

function makeBrainrot(definition) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: definition.color,
    roughness: .42,
    emissive: RARITIES[definition.rarity].color,
    emissiveIntensity: definition.rarity === 'mythical' ? .42 : .12
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.62, .65, 5, 10), material);
  body.position.y = .9; body.castShadow = true; group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.75, .65, .75), material);
  head.position.set(0, 1.65, 0); head.castShadow = true; group.add(head);
  [-.18, .18].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
    eye.position.set(x, 1.68, .38); group.add(eye);
  });
  [-.38, .38].forEach((x) => {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.28, .28, .48), material);
    foot.position.set(x, .2, 0); group.add(foot);
  });
  const tag = makeLabel(`${definition.name} · ${RARITIES[definition.rarity].name} · ${money(definition.price)} · +${money(definition.income)}/s`, RARITIES[definition.rarity].color);
  tag.position.y = 2.55; group.add(tag);
  group.userData.definition = definition;
  scene.add(group);
  return group;
}

function spawnConveyorItem(initial = false) {
  const index = weightedBrainrotIndex(initial ? 1 : 0);
  const item = makeBrainrot(BRAINROTS[index]);
  item.position.set((Math.random() - .5) * 4.2, .5, initial ? -18 : -21);
  conveyorItems.push(item);
}

function weightedBrainrotIndex(boost) {
  const roll = Math.random();
  if (roll < .04 + boost * .01) return 9;
  if (roll < .15) return 7 + Math.floor(Math.random() * 2);
  if (roll < .38) return 5 + Math.floor(Math.random() * 2);
  if (roll < .68) return 2 + Math.floor(Math.random() * 3);
  return Math.floor(Math.random() * 2);
}

function setupMultiplayer() {
  multiplayer.onmessage = (event) => {
    if (event.data.client === clientId()) return;
    if (event.data.type === 'state') updateRemote(event.data);
    if (event.data.type === 'avatar') updateRemoteAvatar(event.data);
  };
  const room = SDK?.party?.getLaunch?.()?.roomKey || 'brainrot-public-room';
  SDK?.game?.updateRoom?.(room);
  SDK?.matchmaking?.reportRoom?.(room);
  SDK?.matchmaker?.reportRoom?.(room);
  SDK?.party?.joinRoom?.(room);
  SDK?.game?.setPartyRoom?.(room);
  multiplayer.postMessage({ type: 'state', client: clientId(), name: currentUser(), x: player.position.x, y: player.position.y, z: player.position.z });
}

function clientId() {
  if (!sessionStorage.getItem('brainrot-client-id')) sessionStorage.setItem('brainrot-client-id', crypto.randomUUID());
  return sessionStorage.getItem('brainrot-client-id');
}

function announceAvatarProfile() {
  multiplayer.postMessage({
    type: 'avatar',
    client: clientId(),
    name: currentUser(),
    avatar: boxityAvatarProfile
  });
}

function updateRemote(data) {
  let mesh = remotePlayers.get(data.client);
  if (!mesh) {
    mesh = makeCharacter(data.name || 'Jugador', '#68cfff', false);
    scene.add(mesh);
    remotePlayers.set(data.client, mesh);
  }
  mesh.position.set(data.x, data.y, data.z);
  mesh.rotation.y = data.rotation || 0;
}

async function updateRemoteAvatar(data) {
  if (!data.avatar?.glbUrl || remotePlayers.get(data.client)?.userData.boxityAvatar) return;
  let mesh = remotePlayers.get(data.client);
  if (!mesh) {
    mesh = makeCharacter(data.name || 'Jugador Boxity', '#68cfff', false);
    scene.add(mesh);
    remotePlayers.set(data.client, mesh);
  }
  const avatar = await loadOfficialAvatarModel(mesh, data.avatar, data.name || 'Jugador Boxity');
  if (!avatar) return;
  remotePlayers.set(data.client, avatar);
}

function currentUser() {
  const user = SDK?.auth?.getUser?.();
  return user?.username || user?.displayName || user?.user?.username || localStorage.getItem('boxity-user-name') || 'Jugador Boxity';
}

async function buyVipWithGems() {
  const result = await (SDK?.economy?.purchase?.({ currency: 'gems', amount: 25, item: 'vip-pass' }) ||
    SDK?.commerce?.purchaseWithGems?.({ amount: 25, item: 'vip-pass' }) ||
    Promise.resolve({ approved: false }));
  if (!result?.approved) return notify('Compra VIP no aprobada por Boxity');
  state.shieldBonus = Math.max(state.shieldBonus, 10);
  state.vip = true;
  save();
  notify('Pase VIP activado con Gems');
}

async function activateIncomeAd() {
  document.documentElement.classList.add('boxity-ad-paused');
  const rewarded = await (SDK?.ads?.showRewarded?.({ placement: 'double-income-2m' }) ||
    SDK?.monetization?.showRewardedAd?.({ placement: 'double-income-2m' }) ||
    Promise.resolve({ verified: false }));
  document.documentElement.classList.remove('boxity-ad-paused');
  if (!rewarded?.verified) return notify('Anuncio no verificado por Boxity');
  incomeBoostUntil = Date.now() + 120000;
  notify('Ingresos x2 por 2 minutos');
  save();
}

function bindEvents() {
  document.getElementById('shopButton').onclick = () => togglePanel('shop');
  document.getElementById('rebirthButton').onclick = () => togglePanel('rebirth');
  document.getElementById('leaderboardButton').onclick = showLeaderboard;
  document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => togglePanel(button.dataset.close, false));
  document.querySelectorAll('[data-shop]').forEach((button) => button.onclick = () => buyUpgrade(button.dataset.shop));
  document.querySelectorAll('[data-rebirth]').forEach((button) => button.onclick = () => rebirth(+button.dataset.rebirth));
  document.getElementById('laserShieldButton').onclick = toggleShield;
  document.getElementById('boxityGemsButton').onclick = buyVipWithGems;
  document.getElementById('boxityAdButton').onclick = activateIncomeAd;
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyE') interact();
    if (event.code === 'KeyR') togglePanel('rebirth');
    if (event.code === 'Escape') {
      document.exitPointerLock?.();
      SDK?.portal?.openMenu?.();
      SDK?.portal?.showMenu?.();
      SDK?.portal?.reportEscape?.();
    }

  });
  document.addEventListener('pointerlockchange', () => {
    SDK?.portal?.setPointerLock?.(Boolean(document.pointerLockElement));
  });
  document.addEventListener('keyup', (event) => keys[event.code] = false);
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= event.movementX * .0024 * cameraSensitivity;
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * .0018 * cameraSensitivity, -.55, .25);
  });
  renderer.domElement.addEventListener('click', (event) => {
    if (!event.target.closest?.('button')) renderer.domElement.requestPointerLock();
  });
  document.addEventListener('mousedown', (event) => { if (event.button === 0) hit(); });
  bindTouch();
  addEventListener('resize', resize);
}

function bindTouch() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const action = button.dataset.action;
      if (action === 'jump') jump();
      else if (action === 'hit') hit();
      else interact();
    });
  });
  const joystickElement = document.getElementById('joystick');
  const knob = document.getElementById('joystickKnob');
  const moveStick = (event) => {
    const rect = joystickElement.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(x, y) || 1;
    const scale = Math.min(1, 48 / length);
    joystick.x = x / 48; joystick.y = y / 48;
    knob.style.transform = `translate(${x * scale}px,${y * scale}px)`;
  };
  joystickElement.addEventListener('pointerdown', (event) => { joystickElement.setPointerCapture(event.pointerId); moveStick(event); });
  joystickElement.addEventListener('pointermove', (event) => { if (joystickElement.hasPointerCapture(event.pointerId)) moveStick(event); });
  const resetStick = () => { joystick.x = 0; joystick.y = 0; knob.style.transform = ''; };
  joystickElement.addEventListener('pointerup', resetStick);
  joystickElement.addEventListener('pointercancel', resetStick);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function jump() {
  if (grounded) { jumpVelocity = 7.5; grounded = false; sound('jump'); }
}

function updateMovement(dt) {
  if (Date.now() < stunnedUntil) return;
  let forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joystick.y;
  let right = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joystick.x;
  if (keys.Space && grounded) jump();
  const length = Math.hypot(forward, right);
  if (length) { forward /= length; right /= length; }
  const carryingPenalty = carrying ? .7 : 1;
  const speed = (7 + (state.upgrades.speed ? 1 : 0)) * carryingPenalty;
  const dx = (right * Math.cos(yaw) + forward * Math.sin(yaw)) * speed * dt;
  const dz = (right * Math.sin(yaw) - forward * Math.cos(yaw)) * speed * dt;
  const next = player.position.clone().add(new THREE.Vector3(dx, 0, dz));
  if (next.length() < 47) player.position.copy(next);
  if (length) animateWalk(performance.now() / 120);

  jumpVelocity -= 20 * dt;
  player.position.y += jumpVelocity * dt;
  if (player.position.y <= 0) { player.position.y = 0; jumpVelocity = 0; grounded = true; }

  const distance = 9.5;
  camera.position.lerp(new THREE.Vector3(player.position.x - Math.sin(yaw) * distance, player.position.y + 5, player.position.z - Math.cos(yaw) * distance), .14);
  camera.lookAt(player.position.x, player.position.y + 2, player.position.z);
  multiplayer.postMessage({ type: 'state', client: clientId(), name: currentUser(), x: player.position.x, y: player.position.y, z: player.position.z, rotation: player.rotation.y });
}

function animateWalk(time) {
  if (!player.userData.parts) return;
  const swing = Math.sin(time) * .32;
  const parts = player.userData.parts;
  parts.leftArm.rotation.x = swing;
  parts.rightArm.rotation.x = -swing;
  parts.leftLeg.rotation.x = -swing;
  parts.rightLeg.rotation.x = swing;
}

function animateEmote() {
  if (!player.userData.parts) return;
  player.userData.parts.leftArm.rotation.z = 2.5;
  setTimeout(() => { player.userData.parts.leftArm.rotation.z = 0; }, 900);
}

function interact() {
  selectedBrainrot = nearest(conveyorItems, 4.5);
  if (selectedBrainrot) { buyBrainrot(selectedBrainrot); return; }

  const rival = nearestPedestal();
  if (rival && carrying) { transferToOwnBase(rival.mesh); return; }
  if (rival && !rival.base.shieldUntil && Date.now() > rival.base.shieldUntil) stealPedestal(rival);
}

function nearest(items, distance) {
  let result = null, best = distance;
  items.forEach((item) => {
    const current = item.position.distanceTo(player.position);
    if (current < best) { result = item; best = current; }
  });
  if (result) document.getElementById('context').textContent = '[E] Comprar';
  return result;
}

function nearestPedestal() {
  let result = null, best = 3;
  bases.slice(1).forEach((base) => {
    base.slots.forEach((slot) => {
      if (!slot.brainrot) return;
      const distance = slot.position.distanceTo(player.position);
      if (distance < best) { result = { base, slot }; best = distance; }
    });
  });
  if (result) document.getElementById('context').textContent = '[Mantener E] Robar';
  return result;
}

function buyBrainrot(item) {
  const definition = item.userData.definition;
  if (state.money < definition.price) { notify('Dinero insuficiente'); return; }
  const slot = bases[0].slots.find((candidate) => !candidate.brainrot);
  if (!slot) { notify('Todos los pedestales estan ocupados'); return; }
  state.money -= definition.price;
  slot.brainrot = definition;
  state.slots.push(definition.id);
  item.position.copy(slot.position).add(new THREE.Vector3(0, .15, 0));
  conveyorItems.splice(conveyorItems.indexOf(item), 1);
  sound('buy');
  notify(`${definition.name} comprado`);
  save();
}

function stealPedestal(target) {
  if (carrying) return;
  const stolen = target.slot.brainrot;
  target.slot.brainrot = null;
  carrying = makeBrainrot(stolen || BRAINROTS.find((item) => item.id === state.slots[0]) || BRAINROTS[0]);
  carrying.position.set(0, 2.3, .7);
  player.add(carrying);
  stealProgress = 0;
  document.querySelector('.shield-status')?.classList.add('danger');
  multiplayer.postMessage({ type: 'theft', client: clientId(), x: player.position.x, z: player.position.z });
  notify('¡Alarma! Llevaste un Brainrot');
  sound('alarm');
}

function transferToOwnBase() {
  const slot = bases[0].slots.find((candidate) => !candidate.brainrot);
  if (!slot || !carrying) return;
  const definition = carrying.userData.definition;
  slot.brainrot = definition;
  state.slots.push(definition.id);
  player.remove(carrying);
  carrying = null;
  notify('Robo entregado en tu base');
  sound('buy');
  save();
}

function hit() {
  if (Date.now() < hitCooldown || Date.now() < stunnedUntil) return;
  hitCooldown = Date.now() + 700;
  sound('hit');
  const range = 3.5;
  bots.forEach((bot) => {
    if (bot.mesh.position.distanceTo(player.position) < range && bot.carrying) {
      bot.carrying.position.copy(bot.base.slots.find((slot) => !slot.brainrot)?.position || bot.base.x);
      bot.carrying = null;
      bot.mesh.position.add(new THREE.Vector3((Math.random() - .5) * 2, 3, (Math.random() - .5) * 2));
      notify('Ladrón golpeado · Brainrot devuelto');
    }
  });
  if (playerBat) {
    playerBat.rotation.x = -1.6;
    setTimeout(() => { playerBat.rotation.x = -.5; }, 160);
  }
}

function toggleShield() {
  const duration = 45000 + state.shieldBonus * 1000;
  if (Date.now() < shieldCooldown) return notify('Escudo en enfriamiento');
  shieldUntil = Date.now() + duration;
  shieldCooldown = Date.now() + 60000;
  bases[0].shield.visible = true;
  sound('shield');
  notify('Base protegida');
}
document.addEventListener('keydown', (event) => { if (event.code === 'KeyX') toggleShield(); });

function buyUpgrade(type) {
  const upgrades = {
    speed: { price: 2500, key: 'speed' },
    power: { price: 8000, key: 'power' },
    shield: { price: 12000, key: 'shield' },
    trap: { price: 4000, key: 'trap' }
  };
  const upgrade = upgrades[type];
  if (!upgrade || state.money < upgrade.price) return notify('Dinero insuficiente');
  state.money -= upgrade.price;
  if (type === 'power') state.powerBonus++;
  else if (type === 'shield') state.shieldBonus += 10;
  else state.upgrades[type] = true;
  notify(`${type === 'speed' ? 'Velocidad' : type === 'power' ? 'Fuerza' : type === 'shield' ? 'Escudo' : 'Trampa'} mejorada`);
  save();
}

function rebirth(level) {
  const requirements = [
    state.money >= 50000 && state.slots.length >= 5,
    state.money >= 500000 && state.slots.length >= 8,
    state.money >= 5000000 && state.slots.length >= 10
  ];
  if (level !== state.rebirth + 1 || !requirements[level - 1]) return notify('Requisitos de Rebirth incompletos');
  state.rebirth = level;
  state.money = [250, 1000, 5000][level - 1];
  state.slots = [];
  bases[0].slots.forEach((slot) => slot.brainrot = null);
  renderRebirth();
  notify(`Rebirth x${[1.5, 2, 3][level - 1]} completado`);
  sound('rebirth');
  save();
}

function renderRebirth() {
  const container = document.getElementById('rebirthLevels');
  container.innerHTML = '';
  const levels = [
    ['$50,000 · 5 Brainrots', 'x1.5 · +Escudo 10s'],
    ['$500,000 · 8 Brainrots', 'x2 · +Escudo 20s'],
    ['$5,000,000 · 10 Brainrots', 'x3 · Poder maestro']
  ];
  levels.forEach((level, index) => {
    const card = document.createElement('article');
    card.className = `rebirth-card${state.rebirth >= index + 1 ? ' disabled' : ''}`;
    card.innerHTML = `<h3>Rebirth ${index + 1}</h3><p>${level[0]}</p><p>${level[1]}</p><button data-rebirth="${index + 1}">RENACER</button>`;
    card.querySelector('button').onclick = () => rebirth(index + 1);
    container.appendChild(card);
  });
}

function togglePanel(id, visible = undefined) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const nextVisible = visible === undefined ? panel.classList.contains('hidden') : visible;
  panel.classList.toggle('hidden', !nextVisible);
  if (nextVisible) SDK?.game?.reportUI?.(id === 'rebirth' ? 'Rebirth' : id === 'shop' ? 'Shop' : id);
  if (nextVisible) SDK?.stats?.increment?.('ui_opened', 1, { screen: id });
}

function showLeaderboard() {
  togglePanel('leaderboard');
  const scores = [{ name: currentUser(), money: state.money }, ...bots.map((bot, i) => ({ name: bot.base.owner, money: 100 + i * 12000 }))];
  scores.sort((a, b) => b.money - a.money);
  document.getElementById('leaderboardList').innerHTML = scores.map((entry) => `<li>${entry.name} — ${money(entry.money)}</li>`).join('');
}

function updateBots(dt) {
  if (Date.now() < botTick) return;
  botTick = Date.now() + 3500;
  bots.forEach((bot) => {
    const available = conveyorItems.find((item) => item.position.distanceTo(bot.mesh.position) < 28);
    if (!available || bot.carrying) return;
    bot.carrying = available;
    conveyorItems.splice(conveyorItems.indexOf(available), 1);
    available.position.copy(bot.base.slots.find((slot) => !slot.brainrot)?.position || bot.mesh.position);
    bot.base.slots.find((slot) => !slot.brainrot) && (bot.base.slots.find((slot) => !slot.brainrot).brainrot = available.userData.definition);
    sound('buy');
  });
  updateBotPositions(dt);
}

function updateBotPositions() {
  bots.forEach((bot, index) => {
    const angle = performance.now() * .00018 + index * 1.05;
    bot.mesh.position.x += (Math.cos(angle) * 31 - bot.mesh.position.x) * .008;
    bot.mesh.position.z += (Math.sin(angle) * 31 - bot.mesh.position.z) * .008;
    bot.mesh.rotation.y += .03;
  });
}

function updateConveyor(dt) {
  conveyorItems.forEach((item) => item.position.z += dt * 2.5);
  conveyorItems.forEach((item) => {
    item.rotation.y += dt * .7;
    item.position.y = .5 + Math.sin(performance.now() * .004 + item.position.x) * .08;
  });
  for (let i = conveyorItems.length - 1; i >= 0; i--) {
    if (conveyorItems[i].position.z > 21) {
      scene.remove(conveyorItems[i]);
      conveyorItems.splice(i, 1);
    }
  }
}

function income() {
  const multiplier = [1, 1.5, 2, 3][state.rebirth] || 1;
  const boost = Date.now() < incomeBoostUntil ? 2 : 1;
  return state.slots.reduce((total, id) => total + (BRAINROTS.find((brainrot) => brainrot.id === id)?.income || 0), 0) * multiplier * boost;
}

function updateHUD() {
  const shield = Math.max(0, Math.ceil((shieldUntil - Date.now()) / 1000));
  document.getElementById('money').textContent = money(state.money);
  document.getElementById('income').textContent = `+${money(income())}/s`;
  document.getElementById('slots').textContent = `${bases[0]?.slots.filter((slot) => slot.brainrot).length || 0}/8`;
  document.getElementById('shieldStatus').textContent = shield ? `ESCUDO ${shield}s` : Date.now() < shieldCooldown ? `RECARGA ${Math.ceil((shieldCooldown - Date.now()) / 1000)}s` : 'ESCUDO LISTO · X';
  if (shield) {
    bases[0].shield.visible = true;
  } else {
    bases[0].shield.visible = false;
  }
}

function money(value) {
  return '$' + Math.floor(value).toLocaleString('es-ES');
}

function notify(text) {
  const notification = document.getElementById('notification');
  notification.textContent = text;
  notification.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => notification.classList.remove('show'), 2200);
}

function sound(type) {
  if (muted) return;
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  const settings = { buy: [520, .12], hit: [110, .15], shield: [760, .25], alarm: [190, .5], coin: [880, .08], jump: [330, .08], rebirth: [1100, .55] };
  const [frequency, duration] = settings[type] || settings.coin;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = type === 'hit' ? 'square' : 'sine';
  gain.gain.setValueAtTime(.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  updateMovement(dt);
  updateConveyor(dt);
  updateBots(dt);
  updateHUD();
  const second = Math.floor(performance.now() / 1000);
  if (second !== lastIncomeTick) {
    state.money = Math.min(MONEY_LIMIT, state.money + income());
    lastIncomeTick = second;
    if (income()) { sound('coin'); save(); }
  }
  renderer.render(scene, camera);
}

init();
window.addEventListener('pagehide', () => SDK?.game?.gameplayEnd?.());
