import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BRAINROTS, RARITIES } from './brainrots.js';

let SDK = window.Legion?.SDK || null;
const GAME_SLUG = 'roba-un-brainrot';
const MONEY_LIMIT = 1e12;
const saveKey = 'roba-un-brainrot-save-v2';
const state = loadState();
let scene, camera, renderer, clock, player, playerBat, selectedBrainrot, carrying;
let audio, shieldUntil = 0, shieldCooldown = 0, stealProgress = 0, jumpVelocity = 0, grounded = true;
let yaw = Math.PI / 2, pitch = -.4, lastIncomeTick = 0, botTick = 0, muted = false;
let hitCooldown = 0, stunnedUntil = 0, carriedFromSlot = null;
const keys = {};
const bots = [];
const conveyorItems = [];
const conveyorStripes = [];
const bases = [];
const remotePlayers = new Map();
const avatarModelCache = new Map();
const playerParts = {};
const colliders = [];
const joystick = { x: 0, y: 0 };
let reservedAreas = [];
const multiplayer = typeof BroadcastChannel === 'function' ? new BroadcastChannel('roba-un-brainrot-v2') : null;
let boxityAvatarProfile = null;
let boxityOutfitKey = null;
let boxityFriends = [];
let incomeBoostUntil = 0;
let boxityEnvironment = null;
let masterVolume = 1;
let boxityInitialized = false;
let firstFrameRendered = false;
let loadingEndSent = false;
let gameplayStarted = false;
let pausedForAd = false;
let mutedBeforeAd = false;
let leaderboardTimer = 0;
let emoteCatalog = [];
let emoteCatalogRequested = false;
let emoteCatalogLoading = false;
const pendingEmotes = [];
let unsubscribePlayerEvents = null;

function loadState() {
  try {
    const defaults = { money: 100, moneyEarned: 100, steals: 0, rebirths: 0, rebirth: 0, slots: [], upgrades: {}, speedUntil: 0, shieldBonus: 0, powerBonus: 0 };
    const saved = Object.assign(defaults, JSON.parse(localStorage.getItem(saveKey) || '{}'));
    ['money', 'moneyEarned', 'steals', 'rebirths', 'rebirth'].forEach((key) => {
      const score = Number(saved[key]);
      saved[key] = Number.isFinite(score) && score >= 0 ? score : defaults[key];
    });
    return saved;
  } catch {
    return { money: 100, moneyEarned: 100, steals: 0, rebirths: 0, rebirth: 0, slots: [], upgrades: {}, speedUntil: 0, shieldBonus: 0, powerBonus: 0 };
  }
}

function save() {
  localStorage.setItem(saveKey, JSON.stringify(state));
  SDK?.storage?.set?.(saveKey, state);
  SDK?.data?.save?.(state);
}

function scheduleLeaderboardSync() {
  if (!SDK?.leaderboard?.submit || leaderboardTimer) return;
  leaderboardTimer = window.setTimeout(() => {
    leaderboardTimer = 0;
    submitLeaderboardScores();
  }, 15000);
}

function submitLeaderboardScores() {
  if (!SDK?.leaderboard?.submit) return;
  const scores = [
    ['money', state.moneyEarned],
    ['steals', state.steals],
    ['rebirths', state.rebirths]
  ];
  scores.forEach(([board, score]) => {
    if (!Number.isFinite(score) || score < 0) return;
    try {
      Promise.resolve(SDK.leaderboard.submit(board, score)).catch((error) => {
        console.warn(`No se pudo enviar la puntuación del tablero ${board}.`, error);
      });
    } catch (error) {
      console.warn(`No se pudo enviar la puntuación del tablero ${board}.`, error);
    }
  });
}

function initializeBoxity() {
  SDK = window.Legion?.SDK || null;
  if (!SDK) {
    return;
  }
  if (boxityInitialized) {
    finishLoading();
    return;
  }
  boxityInitialized = true;
  if (!window.__brainrotSdkInitialized) {
    try {
      SDK.init({ gameSlug: GAME_SLUG });
      window.__brainrotSdkInitialized = true;
    } catch (error) {
      boxityInitialized = false;
      console.error('No se pudo inicializar el SDK de Boxity.', error);
      return;
    }
  }
  if (typeof window.Legion.SDK.leaderboard?.define === 'function') {
    window.Legion.SDK.leaderboard.define([
      { id: 'money', label: 'Dinero acumulado', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
      { id: 'steals', label: 'Brainrots robados', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
      { id: 'rebirths', label: 'Renacimientos', order: 'desc', mode: 'best', format: 'number', reset: 'none' }
    ]);
  }
  if (typeof window.Legion.SDK.game?.registerFeature === 'function') {
    window.Legion.SDK.game.registerFeature('emotes');
  }
  if (typeof window.Legion.SDK.ads?.declareScreens === 'function') {
    window.Legion.SDK.ads.declareScreens({ gameplay: {}, panel: {} });
  }
  SDK.ads?.onBreakStart?.(pauseForAdBreak);
  SDK.ads?.onBreakEnd?.(resumeFromAdBreak);
  boxityEnvironment = SDK.environment?.() || null;
  SDK.auth?.onUserChanged?.((user) => {
    const identity = user || SDK.auth?.getGuest?.();
    const name = identity?.displayName || identity?.username || 'Invitado';
    boxityFriends = [];
    localStorage.setItem('boxity-user-name', name);
    if (player) {
      updatePlayerLabel(name);
      if (bases[0]) {
        bases[0].owner = name;
        updateLabel(bases[0].sign, name);
      }
    }
    loadRealAvatar(SDK.avatar?.getEquipped?.() || identity?.avatar || {});
    if (user) loadBoxityFriends();
    scheduleLeaderboardSync();
  });
  SDK.onEnvironmentChanged?.((environment) => {
    boxityEnvironment = environment;
    loadEmoteCatalog();
  });
  SDK.ui?.onReservedAreasChange?.(placeHud);
  SDK.settings?.listen?.('master_volume', (value) => applyMasterVolume(value));
  SDK.settings?.listen?.('music_volume', (value) => applyMusicVolume(value));
  SDK.settings?.listen?.('graphics_quality', (value) => setGraphicsQuality(value));
  SDK.settings?.listen?.('camera_sensitivity', (value) => cameraSensitivity = Number(value) || cameraSensitivity);
  SDK.avatar?.onAvatarChanged?.((equipped) => loadRealAvatar(equipped || SDK.avatar?.getEquipped?.() || currentIdentity()?.avatar));
  SDK.avatar?.onProportionsChanged?.(() => loadRealAvatar(SDK.avatar?.getEquipped?.() || currentIdentity()?.avatar || {}));
  ['avatar', 'chat', 'settings', 'touch_controls', 'leaderboard'].forEach((feature) => SDK.game?.registerFeature?.(feature));
  unsubscribePlayerEvents = SDK.player?.onEvent?.((event, data) => {
    if (event === 'play_emote') playEmote(player, data);
    if (event === 'respawn_request') resetCharacter();
    if (event === 'pointer_lock_changed') syncPointerLockWithPortal(Boolean(data?.locked ?? data));
  });
  SDK.chat?.enableBubbles?.({ enabled: true });
  SDK.portal?.onPointerLock?.((locked) => syncPointerLockWithPortal(locked));
  SDK.portal?.onMenu?.((open) => syncPortalMenu(open));
  SDK.player?.onReset?.(() => resetCharacter());
  SDK.game?.onResetCharacter?.(() => resetCharacter());
  document.getElementById('boxityAdButton').hidden = !SDK.ads?.isAvailable?.();
  if (firstFrameRendered) finishLoading();
  SDK.ads?.screen?.('gameplay');
  loadEmoteCatalog();
}

function placeHud(areas = reservedAreas) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const reserved = { top: 0, right: 0, bottom: 0, left: 0 };
  reservedAreas = Array.isArray(areas) ? areas : [];
  reservedAreas.forEach((area) => {
    const left = Number.isFinite(area?.left) ? area.left : area?.x;
    const top = Number.isFinite(area?.top) ? area.top : area?.y;
    const areaWidth = Number.isFinite(area?.width) ? area.width : null;
    const areaHeight = Number.isFinite(area?.height) ? area.height : null;
    const right = Number.isFinite(area?.right) ? area.right : Number.isFinite(left) && areaWidth !== null ? left + areaWidth : null;
    const bottom = Number.isFinite(area?.bottom) ? area.bottom : Number.isFinite(top) && areaHeight !== null ? top + areaHeight : null;
    if (Number.isFinite(top) && Number.isFinite(bottom) && top < height / 2) {
      reserved.top = Math.max(reserved.top, bottom);
    }
    if (Number.isFinite(top) && Number.isFinite(bottom) && bottom >= height - 1 && top >= height / 2) {
      reserved.bottom = Math.max(reserved.bottom, height - top);
    }
    if (Number.isFinite(left) && Number.isFinite(right) && right - left < width / 2) {
      if (left <= 1) reserved.left = Math.max(reserved.left, right);
      if (right >= width - 1) reserved.right = Math.max(reserved.right, width - left);
    }
  });
  Object.entries(reserved).forEach(([edge, value]) => {
    document.documentElement.style.setProperty(`--boxity-ui-${edge}`, `${value}px`);
  });
}

function finishLoading() {
  if (!firstFrameRendered || !SDK) return;
  if (!loadingEndSent && SDK.game?.loadingEnd) {
    loadingEndSent = true;
    window.__brainrotLoadingEnded = true;
    try {
      SDK.game.loadingEnd();
    } catch (error) {
      console.error('No se pudo cerrar la pantalla de carga de Boxity.', error);
    }
  }
  if (!gameplayStarted) {
    gameplayStarted = true;
    try {
      SDK.game?.gameplayStart?.();
    } catch (error) {
      console.error('No se pudo informar el inicio de la partida a Boxity.', error);
    }
  }
}

function pauseForAdBreak() {
  if (pausedForAd) return;
  pausedForAd = true;
  mutedBeforeAd = muted;
  muted = true;
  if (audio && audio.state !== 'suspended') {
    audio.suspend().catch((error) => console.warn('No se pudo pausar el audio durante el anuncio.', error));
  }
}

function resumeFromAdBreak() {
  if (!pausedForAd) return;
  pausedForAd = false;
  muted = mutedBeforeAd;
  if (audio?.state === 'suspended') {
    audio.resume().catch((error) => console.warn('No se pudo reanudar el audio tras el anuncio.', error));
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
  const volume = Number(value);
  masterVolume = Number.isFinite(volume) ? THREE.MathUtils.clamp(volume / 100, 0, 1) : 1;
  if (audio?.masterGain) {
    audio.masterGain.gain.setTargetAtTime(masterVolume, audio.currentTime, .02);
  }
}

function applyMusicVolume(value) {
  document.documentElement.style.setProperty('--boxity-music-volume', String(value ?? 1));
}

function setGraphicsQuality(value) {
  const quality = String(value).toLowerCase();
  const maxPixelRatio = innerWidth < 800 || quality === 'low' ? 1 : quality === 'high' || quality === 'ultra' ? 2 : 1.5;
  renderer?.setPixelRatio?.(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
}

function resetCharacter(returnToBase = false) {
  if (carrying && player) {
    player.remove(carrying);
    if (carriedFromSlot && !carriedFromSlot.brainrot) {
      carriedFromSlot.brainrot = carrying.userData.definition;
      scene.remove(carrying);
    } else {
      carrying.position.copy(player.position);
      carrying.position.y = .2;
      scene.add(carrying);
      conveyorItems.push(carrying);
    }
  }
  carrying = null;
  carriedFromSlot = null;
  const homeBase = returnToBase ? bases[0] : null;
  const spawnX = homeBase ? homeBase.x - homeBase.side * 7.5 : -9;
  const spawnZ = homeBase ? homeBase.z : 0;
  player?.position?.set(spawnX, 0, spawnZ);
  if (player) player.rotation.y = Math.PI / 2;
  jumpVelocity = 0;
  grounded = true;
  stunnedUntil = 0;
  updateCamera(1);
  notify(returnToBase ? 'Caíste fuera del mapa y volviste a tu base' : 'Personaje reiniciado');
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, innerWidth < 800 ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !matchMedia('(pointer: coarse)').matches;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);
  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight('#fff', '#4b744d', 2.2));
  const sun = new THREE.DirectionalLight('#fff5d9', 2.8);
  sun.position.set(-20, 45, 15);
  sun.castShadow = true;
  scene.add(sun);

  buildWorld();
  buildPlayer();
  buildBots();
  buildConveyor();
  updateCamera(1);
  bindEvents();
  loadRealAvatar(SDK?.avatar?.getEquipped?.() || currentIdentity()?.avatar || {});
  setupMultiplayer();
  renderRebirth();
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ color: '#70bd52', roughness: .9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.03;
  floor.receiveShadow = true;
  scene.add(floor);
  const avenue = box(14, .3, 78, '#c8c1ae', 0, 0);
  avenue.userData.boxityMaterial = 'road';
  box(.18, .08, 70, '#fff08b', 0, 0);
  for (let z = -34; z <= 34; z += 8) box(.08, .07, 3, '#fff08b', 0, z);

  const baseRows = [-27, -9, 9, 27];
  baseRows.forEach((z, row) => {
    buildBase(row, -17, z);
    buildBase(row + baseRows.length, 17, z);
    box(3.5, .12, 4, '#d7d2c3', -8.75, z);
    box(3.5, .12, 4, '#d7d2c3', 8.75, z);
  });

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

function buildBase(index, x, z) {
  const side = Math.sign(x);
  const color = ['#4bd9df', '#ff7b78', '#ffd166', '#b48cff', '#66d982', '#ff9f43', '#6c9dff', '#f26cc2'][index];
  const platform = box(13, .7, 14, color, x, z);
  platform.userData.boxityMaterial = 'base';
  box(.5, 3, 13.5, '#28354b', x + side * 6.25, z);
  box(13, 2.2, .4, '#34445c', x, z - 6.8);
  box(13, 2.2, .4, '#34445c', x, z + 6.8);
  const base = { index, x, z, angle: side === -1 ? 0 : Math.PI, side, owner: index === 0 ? currentUser() : `Jugador Bot ${index}`, slots: [], shieldUntil: index === 0 ? Date.now() + 45000 : 0, owned: false };
  const sign = makeLabel(base.owner);
  sign.position.set(x, 4.8, z);
  scene.add(sign);
  base.sign = sign;

  const shield = new THREE.Mesh(new THREE.BoxGeometry(13.5, 5, 14.5), new THREE.MeshPhysicalMaterial({ color: '#53e4ff', transparent: true, opacity: .12, wireframe: true }));
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

function makeBrainrotLabel(definition) {
  const rarity = RARITIES[definition.rarity];
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(12,18,32,.94)';
  context.roundRect(8, 8, 496, 176, 20);
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = rarity.color;
  context.stroke();
  context.textAlign = 'center';
  context.font = '800 34px Arial';
  context.fillStyle = '#ffffff';
  context.fillText(definition.name, 256, 52, 460);
  context.font = '800 29px Arial';
  context.fillStyle = rarity.color;
  context.fillText(rarity.name, 256, 94);
  context.font = '700 24px Arial';
  context.fillStyle = '#ffe347';
  context.fillText(`COMPRA ${money(definition.price)}`, 256, 132);
  context.fillStyle = '#8df3c4';
  context.fillText(`+${money(definition.income)}/s`, 256, 166);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(8.5, 3.2, 1);
  return sprite;
}

function makeCharacter(name, color = '#ffd147', bot = false) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.5, 1, 5, 8), material);
  torso.position.y = 1.55; torso.castShadow = true; torso.userData.boxitySkin = true; group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.48, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffc994' }));
  head.userData.boxitySkin = true;
  head.position.y = 2.55; head.castShadow = true; group.add(head);
  [-.16, .16].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
    eye.position.set(x, 2.58, .42); group.add(eye);
  });
  playerParts.leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .7, 4, 6), material);
  playerParts.rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .7, 4, 6), material);
  playerParts.leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .68, 4, 6), new THREE.MeshStandardMaterial({ color: '#27385c' }));
  playerParts.rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .68, 4, 6), new THREE.MeshStandardMaterial({ color: '#27385c' }));
  [playerParts.leftArm, playerParts.rightArm, playerParts.leftLeg, playerParts.rightLeg].forEach((part) => { part.userData.boxitySkin = true; });
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
  player.position.set(-9, 0, 0);
  player.rotation.y = Math.PI / 2;
  scene.add(player);
}

function buildBots() {
  for (let i = 1; i < bases.length; i++) {
    const bot = makeCharacter(`Bot ${i}`, '#65aaff', true);
    bot.position.set(bases[i].x, 0, bases[i].z);
    scene.add(bot);
    bots.push({ mesh: bot, base: bases[i], target: null, nextAction: 0 + i * 650, carrying: null });
  }
}

function updateLabel(sprite, text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.font = '800 38px Arial';
  context.textAlign = 'center';
  context.fillStyle = 'rgba(12,18,32,.85)';
  context.roundRect(75, 17, 362, 62, 16);
  context.fill();
  context.fillStyle = color;
  context.fillText(text, 256, 58, 340);
  sprite.material.map?.dispose();
  sprite.material.map = new THREE.CanvasTexture(canvas);
  sprite.material.needsUpdate = true;
}

function updatePlayerLabel(name) {
  const tag = player?.userData.parts?.tag;
  if (tag) updateLabel(tag, name);
}

async function loadRealAvatar(equipped = SDK?.avatar?.getEquipped?.() || {}) {
  if (!player || !equipped || typeof equipped !== 'object') return;
  boxityAvatarProfile = equipped;
  boxityOutfitKey = SDK?.avatar?.getOutfitKey?.() || null;
  const dressing = player.userData.boxityDressing;
  if (dressing?.update && player.userData.outfitKey !== boxityOutfitKey) {
    try {
      await dressing.update(boxityOutfitKey);
      player.userData.outfitKey = boxityOutfitKey;
      announceAvatarProfile();
      return;
    } catch (error) {
      console.warn('No se pudo actualizar el outfit oficial de Boxity.', error);
    }
  }
  await loadOfficialAvatarModel(player, equipped, currentUser(), boxityOutfitKey);
  announceAvatarProfile();
}

async function loadOfficialAvatarModel(target, equipped, name, outfitKey, remoteClient = null, forceStandard = false) {
  if (!target || !equipped || typeof equipped !== 'object') return false;
  const characterApi = SDK?.character;
  const avatarApi = SDK?.avatar;
  const version = (target.userData.avatarLoadVersion || 0) + 1;
  target.userData.avatarLoadVersion = version;
  const characterId = equipped.characterId || (target === player ? avatarApi?.getCharacterId?.() : null);
  let character = null;
  if (!forceStandard && characterId) {
    try {
      character = target === player && avatarApi?.getCharacter
        ? await avatarApi.getCharacter()
        : typeof avatarApi?.getCharacterFor === 'function'
          ? await window.Legion.SDK.avatar.getCharacterFor(equipped)
          : null;
    } catch (error) {
      console.warn('No se pudo resolver el personaje personalizado de Boxity.', error);
    }
  }
  if (version !== target.userData.avatarLoadVersion) return false;
  const customModelUrl = typeof character === 'string' ? character : character?.glbUrl || character?.url;
  const staticUrl = boxityEnvironment?.staticUrl || SDK?.environment?.()?.staticUrl;
  const modelUrl = customModelUrl || (staticUrl ? `${staticUrl.replace(/\/$/, '')}/avatars/player.glb` : null);
  if (!modelUrl) return false;

  let gltf;
  try {
    gltf = await loadAvatarModel(modelUrl);
  } catch (error) {
    if (customModelUrl && !forceStandard) {
      return loadOfficialAvatarModel(target, equipped, name, outfitKey, remoteClient, true);
    }
    console.warn('No se pudo cargar el modelo oficial del avatar Boxity.', error);
    return false;
  }
  if (version !== target.userData.avatarLoadVersion) return false;

  const identity = currentIdentity();
  const proportions = equipped.proportions || avatarApi?.getProportions?.();
  let dressing = null;
  try {
    if (!customModelUrl && outfitKey && typeof characterApi?.canDress === 'function' &&
      typeof characterApi.dress === 'function' && window.Legion.SDK.character.canDress(outfitKey)) {
      dressing = await window.Legion.SDK.character.dress({
        root: gltf.scene,
        GLTFLoader,
        THREE,
        outfitKey,
        playerId: remoteClient || identity?._id || identity?.userId || identity?.id || identity?.username,
        proportions
      });
    }
  } catch (error) {
    console.warn('No se pudo equipar el outfit oficial de Boxity; se usarán los recursos de avatar disponibles.', error);
  }
  if (version !== target.userData.avatarLoadVersion) {
    dressing?.dispose?.();
    return false;
  }
  if (!dressing) {
    await applyAvatarTextureAndAccessories(gltf.scene, equipped, version, target, character, Boolean(customModelUrl), staticUrl);
    if (!customModelUrl) applyAvatarProportions(gltf.scene, proportions);
  }

  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? Math.min(1, 3 / size.y) : 1;
  const avatarRoot = new THREE.Group();
  avatarRoot.name = 'boxity-player-avatar';
  avatarRoot.scale.setScalar(scale);
  gltf.scene.position.y -= bounds.min.y;
  avatarRoot.add(gltf.scene);
  const tag = makeLabel(name, '#9fffd2');
  tag.position.y = size.y + .75;
  avatarRoot.add(tag);
  avatarRoot.userData.parts = { tag };
  avatarRoot.userData.boxityAvatar = true;
  avatarRoot.userData.boxityDressing = dressing;
  avatarRoot.userData.outfitKey = outfitKey;
  avatarRoot.userData.avatarCharacter = character;
  avatarRoot.userData.animations = gltf.animations;
  avatarRoot.userData.avatarLoadVersion = version;
  avatarRoot.userData.avatarScene = gltf.scene;
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const walkClip = gltf.animations.find((clip) => /walk|run/i.test(clip.name));
    avatarRoot.userData.mixer = mixer;
    avatarRoot.userData.walkAction = walkClip ? mixer.clipAction(walkClip) : null;
  }

  const previousPosition = target.position.clone();
  const previousRotation = target.rotation.clone();
  avatarRoot.position.copy(previousPosition);
  avatarRoot.rotation.copy(previousRotation);
  if (target === player) {
    if (carrying) {
      target.remove(carrying);
      avatarRoot.add(carrying);
    }
    playerBat = new THREE.Mesh(new THREE.CylinderGeometry(.09, .14, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#d8a15d', metalness: .2 }));
    playerBat.position.set(.75, size.y * .48, .3);
    playerBat.rotation.x = -.5;
    avatarRoot.add(playerBat);
    player = avatarRoot;
  } else if (remoteClient) {
    remotePlayers.set(remoteClient, avatarRoot);
  }
  scene.remove(target);
  scene.add(avatarRoot);
  target.userData.boxityDressing?.dispose?.();
  target.traverse((child) => {
    if (child === target) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose?.();
  });
  return true;
}

async function loadAvatarModel(url) {
  let load = avatarModelCache.get(url);
  if (!load) {
    load = new GLTFLoader().loadAsync(url);
    avatarModelCache.set(url, load);
    load.catch(() => {
      if (avatarModelCache.get(url) === load) avatarModelCache.delete(url);
    });
  }
  const source = await load;
  return { ...source, scene: cloneSkeleton(source.scene) };
}

async function applyAvatarTextureAndAccessories(root, equipped, version, target, character, customCharacter, staticUrl) {
  const skinUrl = customCharacter || typeof window.Legion?.SDK?.avatar?.getSkinTextureUrlFor !== 'function'
    ? null
    : window.Legion.SDK.avatar.getSkinTextureUrlFor(equipped);
  if (skinUrl) {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(skinUrl);
      if (version !== target.userData.avatarLoadVersion) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      root.traverse((child) => {
        if (!child.isMesh) return;
        const applyTexture = (material) => {
          const skinned = material.clone();
          skinned.map = texture;
          skinned.color.set('#ffffff');
          skinned.needsUpdate = true;
          return skinned;
        };
        child.material = Array.isArray(child.material) ? child.material.map(applyTexture) : applyTexture(child.material);
      });
    } catch (error) {
      console.warn('No se pudo cargar la textura oficial del avatar Boxity.', error);
    }
  }

  const avatarApi = SDK?.avatar;
  const slots = typeof window.Legion?.SDK?.avatar?.getAccessorySlots === 'function'
    ? [...window.Legion.SDK.avatar.getAccessorySlots()]
    : [];
  const fields = new Set(slots.map((slot) => slot.field));
  const hatId = (target === player ? avatarApi?.getHatId?.() : null) ?? equipped.hatId;
  const backId = (target === player ? avatarApi?.getBackId?.() : null) ?? equipped.backId;
  [
    { field: 'hatId', id: hatId, bone: 'Neck1', origin: [0, .8, 0] },
    { field: 'hairId', id: equipped.hairId, bone: 'Neck1', origin: [0, .8, 0] },
    { field: 'maskId', id: equipped.maskId, bone: 'Neck1', origin: [0, .8, 0] },
    { field: 'backId', id: backId, bone: 'Spine2', origin: [0, 4.2, 0] }
  ].forEach((slot) => {
    if (slot.id && !fields.has(slot.field)) slots.push(slot);
  });
  let restInverses = captureRestInverses(root);
  if (customCharacter && staticUrl) {
    try {
      const standard = await loadAvatarModel(`${staticUrl.replace(/\/$/, '')}/avatars/player.glb`);
      restInverses = captureRestInverses(standard.scene);
    } catch (error) {
      console.warn('No se pudo cargar el rig estándar para ajustar accesorios del personaje personalizado.', error);
    }
  }
  for (const slot of slots) {
    const itemId = slot.id ?? (slot.field === 'hatId' ? hatId : slot.field === 'backId' ? backId : equipped?.[slot.field]);
    if (itemId === undefined || itemId === null || itemId === '' || itemId === '-1' || itemId === 'undefined') continue;
    try {
      let urls = avatarApi?.getAccessoryUrls?.(slot.field, itemId);
      if (!urls?.mesh && staticUrl) {
        const part = slot.field.replace(/Id$/, '');
        const folder = ['hat', 'hair', 'mask'].includes(part) ? 'hats' : part;
        const baseUrl = `${staticUrl.replace(/\/$/, '')}/avatars`;
        urls = {
          mesh: `${baseUrl}/items/${folder}/${itemId}.obj`,
          texture: `${baseUrl}/textures/${folder}/${itemId}.png`
        };
      }
      if (!urls?.mesh) continue;
      const accessory = await loadAvatarAccessory(urls.mesh);
      if (version !== target.userData.avatarLoadVersion) return;
      if (urls.texture) {
        const texture = await new THREE.TextureLoader().loadAsync(urls.texture);
        if (version !== target.userData.avatarLoadVersion) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        accessory.traverse((child) => {
          if (!child.isMesh) return;
          child.material = child.material.clone();
          child.material.map = texture;
          child.material.needsUpdate = true;
        });
      }
      const origin = customCharacter && /^(hatId|hairId|maskId)$/.test(slot.field)
        ? [0, 5.6, 0]
        : slot.origin;
      attachAccessoryToBone(root, accessory, slot.bone, origin, false, customCharacter ? character : null, slot, restInverses);
      if (slot.mirrorBone) attachAccessoryToBone(root, accessory.clone(true), slot.mirrorBone, origin, true, customCharacter ? character : null, slot, restInverses);
    } catch (error) {
      console.warn(`No se pudo cargar el accesorio Boxity ${slot.field}.`, error);
    }
  }
}

async function loadAvatarAccessory(url) {
  if (/\.obj(?:$|[?#])/i.test(url)) return new OBJLoader().loadAsync(url);
  return (await new GLTFLoader().loadAsync(url)).scene;
}

function captureRestInverses(root) {
  root.updateMatrixWorld(true);
  const modelInverse = root.matrixWorld.clone().invert();
  const restInverses = new Map();
  root.traverse((object) => {
    if (!object.isBone) return;
    restInverses.set(object.name, modelInverse.clone().multiply(object.matrixWorld).invert());
  });
  return restInverses;
}

function applyAvatarProportions(root, proportions = {}) {
  const value = (key) => Number.isFinite(proportions?.[key]) ? proportions[key] : 1;
  const height = value('height');
  const shoulderWidth = value('shoulderWidth');
  const armLength = value('armLength');
  const legOffsetX = value('legOffsetX');
  const torsoScaleX = value('torsoScaleX');
  const neckHeight = value('neckHeight');
  const headScale = value('headScale');
  root.scale.y *= height;

  const torso = root.getObjectByName('Spine1');
  if (torso) torso.scale.x *= torsoScaleX;
  const neck = root.getObjectByName('Neck1');
  if (neck) neck.position.y *= neckHeight;
  const head = root.getObjectByName('Head1') || root.getObjectByName('Head');
  if (head) head.scale.multiplyScalar(headScale);
  const shoulderOffset = .4 * (shoulderWidth - 1 + torsoScaleX - 1);
  [['ArmL_Offset', 1], ['ArmR_Offset', -1]].forEach(([name, side]) => {
    const bone = root.getObjectByName(name);
    if (bone) bone.position.x += side * shoulderOffset;
  });
  [['ArmL1', 1], ['ArmR1', -1]].forEach(([name]) => {
    const bone = root.getObjectByName(name);
    if (bone) bone.scale.y *= armLength;
  });
  [['LegL1', 1], ['LegR1', -1]].forEach(([name, side]) => {
    const bone = root.getObjectByName(name);
    if (bone) bone.position.x += side * .48 * (legOffsetX - 1);
  });
}

function attachAccessoryToBone(root, accessory, boneName, origin = [0, 0, 0], mirror = false, character = null, slot = null, restInverses = new Map()) {
  const bone = root.getObjectByName(boneName);
  if (!bone) return;
  const attachment = new THREE.Group();
  attachment.name = `boxity-${boneName}`;
  const localOrigin = Array.isArray(origin) ? origin : [0, 0, 0];
  let characterMatrix = null;
  if (character) {
    try {
      const matrix = typeof window.Legion?.SDK?.avatar?.characterAccessoryMatrix === 'function'
        ? window.Legion.SDK.avatar.characterAccessoryMatrix(character, boneName)
        : null;
      characterMatrix = matrix?.isMatrix4 ? matrix.clone()
        : (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) && matrix.length === 16 ? new THREE.Matrix4().fromArray(matrix)
          : null;
    } catch (error) {
      console.warn(`No se pudo ajustar el accesorio Boxity al hueso ${boneName}.`, error);
    }
  }
  const matrix = restInverses.get(boneName)?.clone() || new THREE.Matrix4();
  if (character) {
    const anchor = character.rig?.anchors?.[boneName];
    const anchorValues = Array.isArray(anchor) || ArrayBuffer.isView(anchor) ? anchor : [anchor?.x, anchor?.y, anchor?.z];
    const anchorScale = anchorValues.length >= 3 && anchorValues.slice(0, 3).every(Number.isFinite)
      ? new THREE.Matrix4().makeScale(anchorValues[0], anchorValues[1], anchorValues[2])
      : new THREE.Matrix4();
    const extremity = /^(Arm[LR]2_leaf|Leg[LR]2_leaf)$/.test(boneName);
    if (extremity) {
      matrix.copy(anchorScale).multiply(restInverses.get(boneName) || new THREE.Matrix4());
    } else {
      matrix.copy(characterMatrix || anchorScale);
    }
  } else {
    matrix.multiply(new THREE.Matrix4().makeTranslation(...localOrigin));
  }
  if (character) matrix.multiply(new THREE.Matrix4().makeTranslation(...localOrigin));
  if (mirror) matrix.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  attachment.matrix.copy(matrix);
  attachment.matrixAutoUpdate = false;
  if (slot?.inheritScale === false) {
    root.add(attachment);
    root.userData.boxityLooseAccessories ||= [];
    root.userData.boxityLooseAccessories.push({ attachment, bone, local: matrix.clone() });
  } else {
    bone.add(attachment);
  }
  attachment.add(accessory);
}

function updateAvatarAccessories(target) {
  const root = target?.userData.avatarScene;
  const accessories = root?.userData.boxityLooseAccessories;
  if (!accessories?.length) return;
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  accessories.forEach(({ attachment, bone, local }) => {
    const position = bone.getWorldPosition(new THREE.Vector3());
    const rotation = bone.getWorldQuaternion(new THREE.Quaternion());
    const boneTransform = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1));
    attachment.matrix.copy(rootInverse).multiply(boneTransform).multiply(local);
  });
}

function buildConveyor() {
  const belt = new THREE.Mesh(new THREE.BoxGeometry(6, .35, 70), new THREE.MeshStandardMaterial({ color: '#e94459', roughness: .45 }));
  belt.userData.boxityMaterial = 'conveyor';
  belt.position.y = .18; scene.add(belt);
  for (let z = -33; z <= 33; z += 4) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.1, .05, .16), new THREE.MeshBasicMaterial({ color: '#ff9aa6' }));
    stripe.position.set(0, .42, z); scene.add(stripe); conveyorStripes.push(stripe);
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
    emissiveIntensity: ['mythical', 'secret'].includes(definition.rarity) ? .42 : .12
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
  const tag = makeBrainrotLabel(definition);
  tag.position.y = 2.55; group.add(tag);
  group.userData.definition = definition;
  scene.add(group);
  return group;
}

function spawnConveyorItem(initial = false) {
  const index = weightedBrainrotIndex(initial ? 1 : 0);
  const item = makeBrainrot(BRAINROTS[index]);
  item.position.set((Math.random() - .5) * 3.5, .5, -33);
  conveyorItems.push(item);
}

function weightedBrainrotIndex(boost) {
  const roll = Math.random();
  const rarity = roll < .005 + boost * .002 ? 'secret'
    : roll < .045 + boost * .01 ? 'mythical'
      : roll < .15 ? 'legendary'
        : roll < .38 ? 'epic'
          : roll < .68 ? 'rare' : 'common';
  const choices = BRAINROTS.filter((brainrot) => brainrot.rarity === rarity);
  return BRAINROTS.indexOf(choices[Math.floor(Math.random() * choices.length)]);
}

function setupMultiplayer() {
  if (!multiplayer) return;
  multiplayer.onmessage = (event) => {
    if (event.data.client === clientId()) return;
    if (event.data.type === 'state') updateRemote(event.data);
    if (event.data.type === 'avatar') updateRemoteAvatar(event.data);
    if (event.data.type === 'emote') playEmote(remotePlayers.get(event.data.client), event.data.id, false);
  };
  multiplayer.postMessage({ type: 'state', client: clientId(), name: currentUser(), x: player.position.x, y: player.position.y, z: player.position.z });
}

function clientId() {
  if (!sessionStorage.getItem('brainrot-client-id')) {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('brainrot-client-id', id);
  }
  return sessionStorage.getItem('brainrot-client-id');
}

function announceAvatarProfile() {
  if (!boxityAvatarProfile || !multiplayer) return;
  multiplayer.postMessage({
    type: 'avatar',
    client: clientId(),
    name: currentUser(),
    avatar: boxityAvatarProfile,
    outfitKey: boxityOutfitKey || player.userData.outfitKey,
    playerId: currentIdentity()?._id || currentIdentity()?.userId || currentIdentity()?.id || currentIdentity()?.username,
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    rotation: player.rotation.y
  });
}

function updateRemote(data) {
  let mesh = remotePlayers.get(data.client);
  if (!mesh) {
    mesh = makeCharacter(data.name || 'Jugador', '#68cfff', false);
    scene.add(mesh);
    remotePlayers.set(data.client, mesh);
  }
  if (Number.isFinite(data.x) && Number.isFinite(data.z)) mesh.position.set(data.x, data.y || 0, data.z);
  mesh.rotation.y = data.rotation || 0;
}

async function updateRemoteAvatar(data) {
  let mesh = remotePlayers.get(data.client);
  if (!mesh) {
    mesh = makeCharacter(data.name || 'Jugador Boxity', '#68cfff', false);
    scene.add(mesh);
    remotePlayers.set(data.client, mesh);
  }
  if (Number.isFinite(data.x) && Number.isFinite(data.z)) mesh.position.set(data.x, data.y || 0, data.z);
  if (Number.isFinite(data.rotation)) mesh.rotation.y = data.rotation;
  await loadOfficialAvatarModel(mesh, data.avatar, data.name || 'Jugador Boxity', data.outfitKey, data.playerId || data.client);
}

function currentIdentity() {
  return SDK?.auth?.getUser?.() || SDK?.auth?.getGuest?.() || null;
}

function currentUser() {
  const identity = currentIdentity();
  return identity?.displayName || identity?.username || localStorage.getItem('boxity-user-name') || 'Invitado';
}

async function inviteBoxityFriend() {
  if (!SDK?.social?.inviteFriend) {
    notify('Las invitaciones de Boxity no están disponibles');
    return;
  }
  try {
    if (!boxityFriends.length) await loadBoxityFriends();
    if (!boxityFriends.length) {
      notify('No hay amigos disponibles para invitar');
      return;
    }
    const choices = boxityFriends.map((friend, index) => `${index + 1}. ${friend.displayName || friend.username || friend.id}`).join('\n');
    const selection = Number(prompt(`Elige un amigo para invitar:\n${choices}`));
    const friend = boxityFriends[selection - 1];
    const userId = friend?.userId || friend?.id;
    if (!userId) {
      notify('Selecciona un amigo válido');
      return;
    }
    const invitation = await SDK.social.inviteFriend(userId);
    if (invitation?.success ?? invitation) notify('Invitación enviada por Boxity');
    else notify(invitation?.error || 'No se pudo enviar la invitación');
  } catch (error) {
    console.error('Falló la invitación de Boxity.', error);
    notify('No se pudo enviar la invitación');
  }
}

async function loadBoxityFriends() {
  if (!SDK?.social?.getFriends) return;
  try {
    const result = await SDK.social.getFriends();
    const friends = Array.isArray(result) ? result : result?.friends;
    boxityFriends = Array.isArray(friends) ? friends : [];
  } catch (error) {
    console.warn('No se pudieron cargar los amigos de Boxity.', error);
    boxityFriends = [];
  }
}

async function activateIncomeAd() {
  const button = document.getElementById('boxityAdButton');
  if (!SDK?.ads?.isAvailable?.()) {
    button.hidden = true;
    return;
  }
  button.disabled = true;
  document.documentElement.classList.add('boxity-ad-paused');
  try {
    const reward = await SDK.ads.showRewarded('double-income-2m');
    if (reward?.status !== 'completed') {
      notify('El anuncio no se completó');
      return;
    }
    incomeBoostUntil = Date.now() + 120000;
    notify('Ingresos x2 por 2 minutos');
    save();
  } catch (error) {
    console.error('Falló el anuncio recompensado de Boxity.', error);
    notify('No se pudo completar el anuncio');
  } finally {
    document.documentElement.classList.remove('boxity-ad-paused');
    button.disabled = false;
  }
}

function bindEvents() {
  document.getElementById('shopButton').onclick = () => togglePanel('shop');
  document.getElementById('rebirthButton').onclick = () => togglePanel('rebirth');
  document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => togglePanel(button.dataset.close, false));
  document.querySelectorAll('[data-shop]').forEach((button) => button.onclick = () => buyUpgrade(button.dataset.shop));
  document.querySelectorAll('[data-rebirth]').forEach((button) => button.onclick = () => rebirth(+button.dataset.rebirth));
  document.getElementById('laserShieldButton').onclick = toggleShield;
  document.getElementById('boxityInviteButton').onclick = inviteBoxityFriend;
  document.getElementById('boxityAdButton').onclick = activateIncomeAd;
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyE') interact();
    if (event.code === 'KeyR') togglePanel('rebirth');
    if (event.code === 'Escape') {
      document.exitPointerLock?.();
      SDK?.portal?.showMenu?.({ lockCursorOnResume: true });
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
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button === 0) hit();
  });
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
  placeHud();
}

function updateCamera(alpha = .14) {
  if (!player || !camera) return;
  const distance = 13.5;
  const horizontalDistance = distance * Math.cos(pitch);
  const targetPosition = new THREE.Vector3(
    player.position.x - Math.sin(yaw) * horizontalDistance,
    player.position.y + 3.5 + distance * Math.sin(-pitch),
    player.position.z + Math.cos(yaw) * horizontalDistance
  );
  const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const lookTarget = player.position.clone().addScaledVector(forward, 7).add(new THREE.Vector3(0, 1.5, 0));
  camera.position.lerp(targetPosition, alpha);
  camera.lookAt(lookTarget);
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
  if (length) player.rotation.y = Math.atan2(dx, dz);
  if (length) {
    stopEmote(player);
    animateWalk(performance.now() / 120);
  }
  else stopWalk();

  jumpVelocity -= 20 * dt;
  player.position.y += jumpVelocity * dt;
  if (player.position.y < -2) {
    resetCharacter(true);
    return;
  }
  if (player.position.y <= 0) { player.position.y = 0; jumpVelocity = 0; grounded = true; }

  updateCamera(Math.min(1, dt * 10));
  multiplayer?.postMessage({ type: 'state', client: clientId(), name: currentUser(), x: player.position.x, y: player.position.y, z: player.position.z, rotation: player.rotation.y });
}

function animateWalk(time) {
  const action = player.userData.walkAction;
  if (action) {
    if (!action.isRunning() || action.getEffectiveWeight() < .01) action.reset().fadeIn(.15).play();
    return;
  }
  const parts = player.userData.parts;
  if (!parts?.leftArm) return;
  const swing = Math.sin(time) * .32;
  parts.leftArm.rotation.x = swing;
  parts.rightArm.rotation.x = -swing;
  parts.leftLeg.rotation.x = -swing;
  parts.rightLeg.rotation.x = swing;
}

function stopWalk() {
  const action = player?.userData.walkAction;
  if (action?.isRunning()) action.fadeOut(.15);
}

async function loadEmoteCatalog() {
  if (emoteCatalogRequested) return;
  const apiUrl = boxityEnvironment?.apiUrl || SDK?.environment?.()?.apiUrl;
  if (!apiUrl) return;
  emoteCatalogRequested = true;
  emoteCatalogLoading = true;
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/avatar/emotes`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    emoteCatalog = Array.isArray(result) ? result : Array.isArray(result?.emotes) ? result.emotes : [];
    emoteCatalogLoading = false;
    pendingEmotes.splice(0).forEach(({ target, data, replicate }) => playEmote(target, data, replicate));
  } catch (error) {
    emoteCatalogLoading = false;
    pendingEmotes.length = 0;
    console.warn('No se pudo cargar el catálogo de emotes de Boxity.', error);
  }
}

function playEmote(target, eventData, replicate = true) {
  const id = typeof eventData === 'string' ? eventData : eventData?.emoteId || eventData?.id;
  if (!target || typeof id !== 'string') return;
  const emote = emoteCatalog.find((entry) => entry?.id === id);
  if (!emote) {
    if (emoteCatalogLoading) pendingEmotes.push({ target, data: eventData, replicate });
    return;
  }
  stopEmote(target);
  if (replicate) multiplayer?.postMessage({ type: 'emote', client: clientId(), id });
  target.userData.walkAction?.fadeOut(.1);

  const emoteName = typeof emote.name === 'string' ? emote.name.toLowerCase() : '';
  const namedClip = target.userData.animations?.find((clip) => typeof clip.name === 'string' && clip.name.toLowerCase() === emoteName);
  if (namedClip && target.userData.mixer) {
    const action = target.userData.mixer.clipAction(namedClip);
    const loop = Boolean(emote.clip?.loop);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(.1).play();
    target.userData.emoteAction = action;
    if (!loop) {
      window.setTimeout(() => {
        if (target.userData.emoteAction === action) {
          action.fadeOut(.1);
          target.userData.emoteAction = null;
        }
      }, namedClip.duration * 1000);
    }
    return;
  }
  if (emote.clip?.tracks) {
    const tracks = Object.entries(emote.clip.tracks).map(([boneName, keys]) => {
      const bone = target.getObjectByName(boneName);
      const validKeys = Array.isArray(keys) && keys.every((key) => Array.isArray(key) && key.length >= 4 && key.slice(0, 4).every(Number.isFinite));
      return bone && validKeys && keys.length
        ? { bone, keys, bind: bone.quaternion.clone() }
        : null;
    }).filter(Boolean);
    if (tracks.length) {
      const len = Number.isFinite(emote.clip.len) && emote.clip.len > 0
        ? emote.clip.len
        : Math.max(...tracks.flatMap(({ keys }) => keys.map(([time]) => time)));
      target.userData.activeEmote = { tracks, elapsed: 0, len, loop: Boolean(emote.clip.loop) };
      return;
    }
  }
  if (/wave|hello|greet/i.test(emoteName) && target.userData.parts?.leftArm) {
    target.userData.emoteWave = { arm: target.userData.parts.leftArm, elapsed: 0 };
  }
}

function stopEmote(target) {
  if (!target) return;
  target.userData.emoteAction?.fadeOut(.1);
  target.userData.emoteAction = null;
  target.userData.activeEmote?.tracks.forEach(({ bone, bind }) => bone.quaternion.copy(bind));
  target.userData.activeEmote = null;
  if (target.userData.emoteWave) target.userData.emoteWave.arm.rotation.z = 0;
  target.userData.emoteWave = null;
}

function updateEmotes(dt) {
  const targets = [player, ...remotePlayers.values()].filter(Boolean);
  for (const target of targets) {
    const active = target.userData.activeEmote;
    if (active) {
      active.elapsed += dt;
      const time = active.loop && active.len > 0 ? active.elapsed % active.len : Math.min(active.elapsed, active.len);
      const blend = Math.min(1, active.elapsed / .1);
      active.tracks.forEach(({ bone, keys, bind }) => {
        let before = keys[0], after = keys[keys.length - 1];
        for (let index = 1; index < keys.length; index++) {
          if (time <= keys[index][0]) {
            before = keys[index - 1];
            after = keys[index];
            break;
          }
        }
        const span = after[0] - before[0];
        const progress = span > 0 ? THREE.MathUtils.clamp((time - before[0]) / span, 0, 1) : 0;
        const smooth = progress * progress * (3 - 2 * progress);
        const delta = new THREE.Euler(
          THREE.MathUtils.degToRad(THREE.MathUtils.lerp(before[1], after[1], smooth)),
          THREE.MathUtils.degToRad(THREE.MathUtils.lerp(before[2], after[2], smooth)),
          THREE.MathUtils.degToRad(THREE.MathUtils.lerp(before[3], after[3], smooth)),
          'XYZ'
        );
        const targetRotation = bind.clone().multiply(new THREE.Quaternion().setFromEuler(delta));
        bone.quaternion.copy(bind).slerp(targetRotation, blend);
      });
      if (!active.loop && active.elapsed >= active.len) stopEmote(target);
    }
    if (target.userData.emoteWave) {
      const wave = target.userData.emoteWave;
      wave.elapsed += dt;
      wave.arm.rotation.z = 2.5 + Math.sin(wave.elapsed * 16) * .18;
      if (wave.elapsed >= .9) stopEmote(target);
    }
  }
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
  carriedFromSlot = target.slot;
  carrying = makeBrainrot(stolen || BRAINROTS.find((item) => item.id === state.slots[0]) || BRAINROTS[0]);
  carrying.position.set(0, 2.3, .7);
  player.add(carrying);
  state.steals = (state.steals || 0) + 1;
  stealProgress = 0;
  document.querySelector('.shield-status')?.classList.add('danger');
  multiplayer?.postMessage({ type: 'theft', client: clientId(), x: player.position.x, z: player.position.z });
  scheduleLeaderboardSync();
  notify('¡Alarma! Llevaste un Brainrot');
  sound('alarm');
  save();
}

function transferToOwnBase() {
  const slot = bases[0].slots.find((candidate) => !candidate.brainrot);
  if (!slot || !carrying) return;
  const definition = carrying.userData.definition;
  slot.brainrot = definition;
  state.slots.push(definition.id);
  player.remove(carrying);
  carrying = null;
  carriedFromSlot = null;
  notify('Robo entregado en tu base');
  sound('buy');
  save();
}

function dropCarriedBrainrot() {
  if (!carrying || !player) return;
  player.remove(carrying);
  carrying.position.copy(player.position).add(new THREE.Vector3(0, .2, .8));
  scene.add(carrying);
  conveyorItems.push(carrying);
  carrying = null;
  carriedFromSlot = null;
}

function hit() {
  if (Date.now() < hitCooldown || Date.now() < stunnedUntil) return;
  hitCooldown = Date.now() + 700;
  sound('hit');
  const range = 3.5;
  bots.forEach((bot) => {
    if (bot.mesh.position.distanceTo(player.position) < range && bot.carrying) {
      const slot = bot.base.slots.find((candidate) => !candidate.brainrot);
      if (slot) {
        slot.brainrot = bot.carrying.userData.definition;
        scene.remove(bot.carrying);
      }
      bot.carrying = null;
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
  state.rebirths = (state.rebirths || 0) + 1;
  state.money = [250, 1000, 5000][level - 1];
  state.slots = [];
  bases[0].slots.forEach((slot) => slot.brainrot = null);
  renderRebirth();
  notify(`Rebirth x${[1.5, 2, 3][level - 1]} completado`);
  sound('rebirth');
  scheduleLeaderboardSync();
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
  if (nextVisible) {
    document.querySelectorAll('.panel:not(.hidden)').forEach((openPanel) => {
      if (openPanel !== panel) openPanel.classList.add('hidden');
    });
  }
  panel.classList.toggle('hidden', !nextVisible);
  if (nextVisible) {
    SDK?.game?.reportUI?.(id === 'rebirth' ? 'Rebirth' : id === 'shop' ? 'Shop' : id);
    setAdScreen('panel');
  } else if (!document.querySelector('.panel:not(.hidden)')) {
    setAdScreen('gameplay');
  }
}

function setAdScreen(screen) {
  SDK?.ads?.screen?.(screen);
}

function updateBots(dt) {
  if (Date.now() < botTick) return;
  botTick = Date.now() + 3500;
  bots.forEach((bot) => {
    if (bot.mesh.position.distanceTo(player.position) < 3 && Date.now() >= (bot.nextStunAt || 0)) {
      bot.nextStunAt = Date.now() + 2000;
      stunnedUntil = Date.now() + 900;
      dropCarriedBrainrot();
      notify('Te aturdieron · Brainrot soltado');
      sound('hit');
    }
    const available = conveyorItems.find((item) => item.position.distanceTo(bot.mesh.position) < 14);
    if (!available || bot.carrying) return;
    bot.carrying = available;
    conveyorItems.splice(conveyorItems.indexOf(available), 1);
    const slot = bot.base.slots.find((candidate) => !candidate.brainrot);
    if (!slot) {
      bot.carrying = null;
      return;
    }
    available.position.copy(slot.position);
    slot.brainrot = available.userData.definition;
    scene.remove(available);
    bot.carrying = null;
    sound('buy');
  });
  updateBotPositions(dt);
}

function updateBotPositions() {
  bots.forEach((bot, index) => {
    const phase = performance.now() * .0007 + index;
    bot.mesh.position.x = bot.base.x + Math.sin(phase) * 1.4;
    bot.mesh.position.z = bot.base.z + Math.cos(phase) * 1.4;
    bot.mesh.rotation.y = -bot.base.side * Math.PI / 2;
  });
}

function updateConveyor(dt) {
  conveyorStripes.forEach((stripe) => {
    stripe.position.z += dt * 3;
    if (stripe.position.z > 35) stripe.position.z -= 70;
  });
  conveyorItems.forEach((item) => item.position.z += dt * 2.5);
  conveyorItems.forEach((item) => {
    item.rotation.y += dt * .7;
    item.position.y = .5 + Math.sin(performance.now() * .004 + item.position.x) * .08;
  });
  for (let i = conveyorItems.length - 1; i >= 0; i--) {
    if (conveyorItems[i].position.z > 35) {
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
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    audio.masterGain = audio.createGain();
    audio.masterGain.gain.value = masterVolume;
    audio.masterGain.connect(audio.destination);
  }
  const settings = { buy: [520, .12], hit: [110, .15], shield: [760, .25], alarm: [190, .5], coin: [880, .08], jump: [330, .08], rebirth: [1100, .55] };
  const [frequency, duration] = settings[type] || settings.coin;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = type === 'hit' ? 'square' : 'sine';
  gain.gain.setValueAtTime(.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.masterGain);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function animate() {
  const dt = Math.min(clock.getDelta(), .05);
  if (!pausedForAd) {
    updateMovement(dt);
    player?.userData.mixer?.update(dt);
    remotePlayers.forEach((remote) => remote.userData.mixer?.update(dt));
    updateAvatarAccessories(player);
    remotePlayers.forEach(updateAvatarAccessories);
    updateEmotes(dt);
    updateConveyor(dt);
    updateBots(dt);
    updateHUD();
    const second = Math.floor(performance.now() / 1000);
    if (second !== lastIncomeTick) {
      const earned = Math.min(MONEY_LIMIT - state.money, income());
      state.money = Math.min(MONEY_LIMIT, state.money + earned);
      state.moneyEarned = Math.min(MONEY_LIMIT, (state.moneyEarned || 0) + earned);
      lastIncomeTick = second;
      if (earned > 0) {
        sound('coin');
        scheduleLeaderboardSync();
        save();
      }
    }
  }
  renderer.render(scene, camera);
  if (!firstFrameRendered) {
    firstFrameRendered = true;
    finishLoading();
  }
  requestAnimationFrame(animate);
}

function bootGame() {
  try {
    init();
  } catch (error) {
    console.error('No se pudo iniciar Roba un Brainrot.', error);
    const notification = document.getElementById('notification');
    notification.textContent = 'No se pudo iniciar el juego. Recarga la página para volver a intentarlo.';
    notification.classList.add('show');
    firstFrameRendered = true;
    finishLoading();
  }
}

window.addEventListener('boxity-sdk-ready', initializeBoxity);
bootGame();
window.addEventListener('pagehide', () => {
  if (leaderboardTimer) {
    clearTimeout(leaderboardTimer);
    leaderboardTimer = 0;
  }
  submitLeaderboardScores();
  unsubscribePlayerEvents?.();
  multiplayer?.close();
  SDK?.ads?.hideScreen?.();
  SDK?.game?.gameplayEnd?.();
});
