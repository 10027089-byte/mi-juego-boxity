import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BRAINROTS, RARITIES } from './brainrots.js';

const Legion = window.Legion;
const SDK = Legion?.SDK || null;
const GAME_SLUG = 'roba-un-brainrot';
const MONEY_LIMIT = 1e12;
const saveKey = 'roba-un-brainrot-save-v2';
const state = loadState();
let scene, camera, renderer, clock, player, playerBat, selectedBrainrot, carrying;
let audio, shieldUntil = 0, shieldCooldown = 0, stealProgress = 0, jumpVelocity = 0, grounded = true;
let yaw = Math.PI / 2, pitch = -.28, lastIncomeTick = 0, botTick = 0, muted = false;
let hitCooldown = 0, stunnedUntil = 0;
const keys = {};
const bots = [];
const conveyorItems = [];
const conveyorStripes = [];
const bases = [];
const remotePlayers = new Map();
const playerParts = {};
const colliders = [];
const joystick = { x: 0, y: 0 };
const multiplayer = new BroadcastChannel('roba-un-brainrot-v2');
let boxityAvatarProfile = null;
let incomeBoostUntil = 0;
let boxityEnvironment = null;
let masterVolume = 1;

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
}

function initializeBoxity() {
  if (!SDK) {
    console.warn('Boxity SDK no disponible; el juego continuará sin integración de plataforma.');
    return;
  }
  if (window.__brainrotSdkInitialized) return;
  window.__brainrotSdkInitialized = true;
  Legion.SDK.init({ gameSlug: 'roba-un-brainrot' });
  boxityEnvironment = SDK.environment?.() || null;
  SDK.auth?.onUserChanged?.((user) => {
    const name = user?.username || user?.displayName || 'Jugador Boxity';
    localStorage.setItem('boxity-user-name', name);
    if (player) {
      updatePlayerLabel(name);
      if (bases[0]) {
        bases[0].owner = name;
        updateLabel(bases[0].sign, name);
      }
    }
    loadRealAvatar(SDK.avatar?.getEquipped?.());
  });
  SDK.onEnvironmentChanged?.((environment) => {
    boxityEnvironment = environment;
  });
  SDK.ui?.onReservedAreasChange?.(placeHud);
  SDK.settings?.listen?.('master_volume', (value) => applyMasterVolume(value));
  SDK.settings?.listen?.('music_volume', (value) => applyMusicVolume(value));
  SDK.settings?.listen?.('graphics_quality', (value) => setGraphicsQuality(value));
  SDK.settings?.listen?.('camera_sensitivity', (value) => cameraSensitivity = Number(value) || cameraSensitivity);
  SDK.avatar?.onAvatarChanged?.((equipped) => loadRealAvatar(equipped || SDK.avatar?.getEquipped?.()));
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
  SDK.game?.loadingStep?.('Boxity environment detected');
  SDK.game?.loadingStep?.('Preparando la arena 3D');
}

function placeHud(areas = []) {
  const reservedBottom = areas.reduce((bottom, area) => Math.max(bottom, area.top + area.height), 0);
  document.documentElement.style.setProperty('--boxity-ui-top', `${reservedBottom}px`);
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
  renderer?.setPixelRatio?.(Math.min(devicePixelRatio, quality === 'low' ? 1 : quality === 'high' || quality === 'ultra' ? 2 : 1.5));
}

function resetCharacter() {
  player?.position?.set(-9, 0, 0);
  if (player) player.rotation.y = Math.PI / 2;
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
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
  buildPlayer();
  buildBots();
  buildConveyor();
  updateCamera(1);
  bindEvents();
  loadRealAvatar(SDK?.avatar?.getEquipped?.());
  setupMultiplayer();
  refreshGemBalance();
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

async function loadRealAvatar(equipped = SDK?.avatar?.getEquipped?.()) {
  if (!player || !equipped || typeof equipped !== 'object') return;
  boxityAvatarProfile = equipped;
  await applyAvatarAppearance(player, equipped, currentUser());
  announceAvatarProfile();
}

async function applyAvatarAppearance(target, equipped, name) {
  if (!target || !equipped || typeof equipped !== 'object') return;
  const version = (target.userData.avatarLoadVersion || 0) + 1;
  target.userData.avatarLoadVersion = version;
  target.userData.boxityAvatar = true;
  if (target.userData.parts?.tag) updateLabel(target.userData.parts.tag, name, '#9fffd2');

  const skinUrl = SDK?.avatar?.getSkinTextureUrlFor?.(equipped);
  if (skinUrl) {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(skinUrl);
      if (version !== target.userData.avatarLoadVersion) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      target.traverse((child) => {
        if (!child.isMesh || !child.userData.boxitySkin) return;
        child.material = child.material.clone();
        child.material.map = texture;
        child.material.color.set('#ffffff');
        child.material.needsUpdate = true;
      });
    } catch (error) {
      console.warn('No se pudo cargar la textura oficial del avatar Boxity.', error);
    }
  }

  await loadAvatarAccessories(target, equipped, version);
}

async function loadAvatarAccessories(target, equipped, version) {
  const avatarApi = SDK?.avatar;
  const slots = avatarApi?.getAccessorySlots?.() || [];
  const oldAccessories = target.userData.boxityAccessories;
  if (oldAccessories) {
    target.remove(oldAccessories);
    oldAccessories.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material?.dispose?.();
    });
  }
  const accessoryRoot = new THREE.Group();
  accessoryRoot.name = 'boxityAccessories';
  target.add(accessoryRoot);
  target.userData.boxityAccessories = accessoryRoot;

  for (const slot of slots) {
    const itemId = equipped?.[slot.field];
    if (!itemId || itemId === '-1') continue;
    const urls = avatarApi.getAccessoryUrls?.(slot.field, itemId);
    if (!urls?.mesh) continue;
    try {
      const gltf = await new GLTFLoader().loadAsync(urls.mesh);
      if (version !== target.userData.avatarLoadVersion) return;
      if (urls.texture) {
        const texture = await new THREE.TextureLoader().loadAsync(urls.texture);
        if (version !== target.userData.avatarLoadVersion) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          child.material = child.material.clone();
          child.material.map = texture;
          child.material.needsUpdate = true;
        });
      }
      const position = accessoryPosition(slot.field);
      const anchor = new THREE.Group();
      anchor.name = slot.bone || slot.field;
      anchor.position.copy(position);
      accessoryRoot.add(anchor);
      anchor.add(gltf.scene);
      if (slot.mirrorBone) {
        const mirror = anchor.clone(true);
        mirror.name = slot.mirrorBone;
        mirror.scale.x = -1;
        accessoryRoot.add(mirror);
      }
    } catch (error) {
      console.warn(`No se pudo cargar el accesorio Boxity ${slot.field}.`, error);
    }
  }
}

function accessoryPosition(field) {
  const positions = {
    hatId: [0, 3.05, 0], hairId: [0, 2.85, 0], maskId: [0, 2.55, .4],
    neckId: [0, 2.1, 0], chestId: [0, 1.65, 0], backId: [0, 1.65, -.55],
    waistId: [0, 1.05, 0], handId: [.75, 1.55, 0], shoesId: [0, .1, 0]
  };
  const [x, y, z] = positions[field] || [0, 1.55, 0];
  return new THREE.Vector3(x, y, z);
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
  multiplayer.onmessage = (event) => {
    if (event.data.client === clientId()) return;
    if (event.data.type === 'state') updateRemote(event.data);
    if (event.data.type === 'avatar') updateRemoteAvatar(event.data);
  };
  const room = 'brainrot-public-room';
  SDK?.game?.updateRoom?.(room);
  multiplayer.postMessage({ type: 'state', client: clientId(), name: currentUser(), x: player.position.x, y: player.position.y, z: player.position.z });
}

function clientId() {
  if (!sessionStorage.getItem('brainrot-client-id')) sessionStorage.setItem('brainrot-client-id', crypto.randomUUID());
  return sessionStorage.getItem('brainrot-client-id');
}

function announceAvatarProfile() {
  if (!boxityAvatarProfile) return;
  multiplayer.postMessage({
    type: 'avatar',
    client: clientId(),
    name: currentUser(),
    avatar: boxityAvatarProfile,
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
  mesh.position.set(data.x, data.y, data.z);
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
  await applyAvatarAppearance(mesh, data.avatar, data.name || 'Jugador Boxity');
}

function currentUser() {
  const user = SDK?.auth?.getUser?.();
  return user?.username || user?.displayName || localStorage.getItem('boxity-user-name') || 'Jugador Boxity';
}

async function refreshGemBalance() {
  const balanceElement = document.getElementById('gemBalance');
  if (!balanceElement || !SDK?.bux?.getBalance) return;
  try {
    const balance = await SDK.bux.getBalance();
    balanceElement.textContent = String(balance?.gems ?? balance?.balance ?? balance ?? '—');
  } catch (error) {
    balanceElement.textContent = '—';
    console.warn('No se pudo consultar el saldo de Gems de Boxity.', error);
  }
}

async function buyVipWithGems() {
  if (!SDK?.bux?.requestPurchase) return notify('La tienda de Gems de Boxity no está disponible');
  const button = document.getElementById('boxityGemsButton');
  button.disabled = true;
  try {
    const result = await SDK.bux.requestPurchase('vip-pass');
    if (!result?.success) {
      notify(result?.error || 'Compra no aprobada por Boxity');
      return;
    }
    state.shieldBonus = Math.max(state.shieldBonus, 10);
    state.vip = true;
    save();
    await refreshGemBalance();
    notify('Pase VIP activado con Gems');
  } catch (error) {
    console.error('Falló la compra de Gems en Boxity.', error);
    notify('No se pudo completar la compra de Gems');
  } finally {
    button.disabled = false;
  }
}

async function inviteBoxityFriend() {
  if (!SDK?.social?.getFriends || !SDK?.social?.inviteFriend) {
    notify('Las invitaciones de Boxity no están disponibles');
    return;
  }
  try {
    const result = await SDK.social.getFriends();
    const friends = Array.isArray(result) ? result : result?.friends;
    if (!Array.isArray(friends) || friends.length === 0) {
      notify('No hay amigos disponibles para invitar');
      return;
    }
    const choices = friends.map((friend, index) => `${index + 1}. ${friend.displayName || friend.username || friend.id}`).join('\n');
    const selection = Number(prompt(`Elige un amigo para invitar:\n${choices}`));
    const friend = friends[selection - 1];
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
  document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => togglePanel(button.dataset.close, false));
  document.querySelectorAll('[data-shop]').forEach((button) => button.onclick = () => buyUpgrade(button.dataset.shop));
  document.querySelectorAll('[data-rebirth]').forEach((button) => button.onclick = () => rebirth(+button.dataset.rebirth));
  document.getElementById('laserShieldButton').onclick = toggleShield;
  document.getElementById('boxityGemsButton').onclick = buyVipWithGems;
  document.getElementById('boxityInviteButton').onclick = inviteBoxityFriend;
  document.getElementById('boxityAdButton').onclick = activateIncomeAd;
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'KeyE') interact();
    if (event.code === 'KeyR') togglePanel('rebirth');
    if (event.code === 'Escape') {
      document.exitPointerLock?.();
      SDK?.portal?.showMenu?.(true);
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

function updateCamera(alpha = .14) {
  if (!player || !camera) return;
  const distance = 12;
  const horizontalDistance = distance * Math.cos(pitch);
  const targetPosition = new THREE.Vector3(
    player.position.x - Math.sin(yaw) * horizontalDistance,
    player.position.y + 4 + distance * Math.sin(-pitch),
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
  if (length) animateWalk(performance.now() / 120);

  jumpVelocity -= 20 * dt;
  player.position.y += jumpVelocity * dt;
  if (player.position.y <= 0) { player.position.y = 0; jumpVelocity = 0; grounded = true; }

  updateCamera(Math.min(1, dt * 10));
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

function updateBots(dt) {
  if (Date.now() < botTick) return;
  botTick = Date.now() + 3500;
  bots.forEach((bot) => {
    const available = conveyorItems.find((item) => item.position.distanceTo(bot.mesh.position) < 14);
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
