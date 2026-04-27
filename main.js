import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const msg = document.getElementById('msg');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

const MODEL_FILE = 'luna.vrm';
const SKY_FILE = 'assets/fantasy_landscape_3.glb';
const WORLD_FILE = 'assets/stylised_sky_player_home_dioroma.glb';

const LUNA_SCALE = 1.0;
const LUNA_POSITION = new THREE.Vector3(0.30, 9.9, 0.15);
const LUNA_ROTATION_Y = 0;

const CAMERA_POSITION = new THREE.Vector3(0.45, 10.8, 9.0);
const CAMERA_TARGET = new THREE.Vector3(0.45, 10.8, 0.15);

const INIT_SILENCE_MS = 60000;
const INIT_COOLDOWN_MS = 120000;
const INIT_CHANCE = 0.4;

const IDLE_MIN_TIME = 13;
const IDLE_MAX_TIME = 20;
const YAWN_TIMEOUT = 50;
const FADE_DURATION = 0.45;
const BLINK_INTERVAL = 2.5;
const BLINK_DURATION = 0.17;

let currentVrm = null;
let currentRoot = null;
let mixer = null;
let currentAction = null;

let idleActions = [];
let specialActions = {};

let lastUserMessageAt = Date.now();
let lastInitiativeAt = 0;
let isUserTyping = false;
let typingTimer = null;

let isBusy = false;
let isLoading = false;
let lastInteractionTime = 0;
let nextIdleSwitchTime = 0;
let lastBlinkTime = 0;
let talkingFaceInterval = null;

const clock = new THREE.Clock();

function log(text) {
  console.log(text);
  if (msg) msg.textContent = text;
}

function addChatMessage(text, role) {
  if (!chatMessages) return;

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setExpression(name, value) {
  if (!currentVrm?.expressionManager || !name) return;
  currentVrm.expressionManager.setValue(name, value);
}

function clearExpressions() {
  setExpression('smile', 0);
  setExpression('sorrow', 0);
}

function applyEmotion(expression) {
  clearExpressions();

  if (expression === 'smile') setExpression('smile', 0.82);
  if (expression === 'sorrow') setExpression('sorrow', 0.82);
}

function stopTalkingFace() {
  if (talkingFaceInterval) {
    clearInterval(talkingFaceInterval);
    talkingFaceInterval = null;
  }

  if (!currentVrm?.expressionManager) return;

  for (const v of ['aa', 'ih', 'ou', 'ee', 'oh']) {
    currentVrm.expressionManager.setValue(v, 0);
  }
}

function startTalkingFace() {
  stopTalkingFace();

  if (!currentVrm?.expressionManager) return;

  const visemes = ['aa', 'ih', 'ou', 'ee', 'oh'];

  talkingFaceInterval = setInterval(() => {
    if (!currentVrm?.expressionManager) return;

    for (const v of visemes) {
      currentVrm.expressionManager.setValue(v, 0);
    }

    const pick = visemes[Math.floor(Math.random() * visemes.length)];
    currentVrm.expressionManager.setValue(pick, 0.2 + Math.random() * 0.65);
  }, 85);
}

async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return await loader.loadAsync(url);
}

async function loadVRMA(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);
  return gltf.userData.vrmAnimations?.[0];
}

async function loadSkySphere(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);

  const sky = gltf.scene;
  sky.position.set(0, 5, 0);
  sky.scale.setScalar(500);
  sky.renderOrder = -999;

  sky.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      obj.material.side = THREE.BackSide;
      obj.material.depthWrite = false;
      obj.material.depthTest = false;
      obj.material.fog = false;
    }
  });

  scene.add(sky);
  return sky;
}

async function loadWorld(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);

  const world = gltf.scene;

  const box = new THREE.Box3().setFromObject(world);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const targetHeight = 20.0;
  const scale = targetHeight / size.y;

  world.scale.setScalar(scale);

  world.position.set(
    -center.x * scale,
    -box.min.y * scale,
    -center.z * scale
  );

  world.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  scene.add(world);
  return world;
}

async function loadAction(file, key, loopMode = THREE.LoopOnce, repetitions = 1) {
  try {
    const data = await loadVRMA(file);

    if (!data) {
      console.warn(`VRMA not found in ${file}`);
      return null;
    }

    const clip = createVRMAnimationClip(data, currentVrm);
    const action = mixer.clipAction(clip);

    action.clampWhenFinished = true;
    action.setLoop(loopMode, repetitions);

    if (key) specialActions[key] = action;

    return action;
  } catch (err) {
    console.warn(`Failed to load ${file}:`, err);
    return null;
  }
}

// ===== scene =====

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

renderer.domElement.style.position = 'fixed';
renderer.domElement.style.left = '0';
renderer.domElement.style.top = '0';
renderer.domElement.style.zIndex = '1';

document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.copy(CAMERA_TARGET);

// fallback floor, выключен, потому что есть домик/world
const floorGeo = new THREE.PlaneGeometry(50, 50);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0xd6dbe6,
  side: THREE.DoubleSide,
  roughness: 0.98,
  metalness: 0.0
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
// scene.add(floor);

// lights
scene.add(new THREE.AmbientLight(0xffffff, 0.75));

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.65);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight.position.set(5, 10, 6);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-6, 6, -4);
scene.add(fillLight);

// ===== animation logic =====

function getRandomIdle(exclude = null) {
  if (idleActions.length === 0) return null;
  if (idleActions.length === 1) return idleActions[0];

  const filtered = idleActions.filter((a) => a !== exclude);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function playIdle(idleAction = null) {
  const nextIdle = idleAction || getRandomIdle(currentAction);
  if (!nextIdle) return;

  stopTalkingFace();
  clearExpressions();

  if (currentAction && currentAction !== nextIdle) {
    currentAction.fadeOut(FADE_DURATION);
    nextIdle.reset().fadeIn(FADE_DURATION).play();
  } else if (currentAction !== nextIdle) {
    nextIdle.reset().play();
  }

  currentAction = nextIdle;

  nextIdleSwitchTime =
    clock.getElapsedTime() +
    (IDLE_MIN_TIME + Math.random() * (IDLE_MAX_TIME - IDLE_MIN_TIME));
}

function playSpecialAction(actionKey, expression = 'smile') {
  const action = specialActions[actionKey];

  if (!action) {
    console.warn(`Unknown action: ${actionKey}`);
    playIdle();
    return;
  }

  isBusy = true;
  lastInteractionTime = clock.getElapsedTime();

  stopTalkingFace();
  clearExpressions();

  if (mixer) mixer.stopAllAction();

  action.reset();
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(1);
  action.play();

  currentAction = action;
  applyEmotion(expression);

  if (actionKey.startsWith('talk')) startTalkingFace();
}

function inferAnimation(reply) {
  const a = reply?.animation;
  if (a && specialActions[a]) return a;

  const text = String(reply?.text || '');

  if (text.length > 120 && specialActions.talk3) return 'talk3';
  if (text.length > 70 && specialActions.talk2) return 'talk2';
  if (specialActions.talk1 && Math.random() > 0.5) return 'talk1';

  return specialActions.talk ? 'talk' : 'none';
}

function inferExpression(reply) {
  if (reply?.expression === 'smile' || reply?.expression === 'sorrow') {
    return reply.expression;
  }

  return 'smile';
}

function handleAgentReply(reply) {
  const text = reply?.text || '...';
  const animation = inferAnimation(reply);
  const expression = inferExpression(reply);

  addChatMessage(text, 'agent');

  if (animation === 'none') return;
  playSpecialAction(animation, expression);
}

function updateBlinking() {
  if (!currentVrm?.expressionManager || isBusy || isLoading) return;

  const now = clock.getElapsedTime();

  if (now - lastBlinkTime > BLINK_INTERVAL + Math.random() * 2) {
    currentVrm.expressionManager.setValue('blink', 1.0);

    setTimeout(() => {
      if (currentVrm?.expressionManager) {
        currentVrm.expressionManager.setValue('blink', 0.0);
      }
    }, BLINK_DURATION * 1000);

    lastBlinkTime = now;
  }
}

function switchRandomIdle() {
  if (isBusy || isLoading) return;
  if (!currentAction) return;
  if (!idleActions.includes(currentAction)) return;
  if (clock.getElapsedTime() < nextIdleSwitchTime) return;

  const nextIdle = getRandomIdle(currentAction);

  if (!nextIdle || nextIdle === currentAction) {
    nextIdleSwitchTime =
      clock.getElapsedTime() +
      (IDLE_MIN_TIME + Math.random() * (IDLE_MAX_TIME - IDLE_MIN_TIME));
    return;
  }

  currentAction.fadeOut(FADE_DURATION);
  nextIdle.reset().fadeIn(FADE_DURATION).play();

  currentAction = nextIdle;

  nextIdleSwitchTime =
    clock.getElapsedTime() +
    (IDLE_MIN_TIME + Math.random() * (IDLE_MAX_TIME - IDLE_MIN_TIME));
}

function checkAutoYawn() {
  if (isBusy || isLoading) return;
  if (!specialActions.yawn) return;

  const now = clock.getElapsedTime();

  if (now - lastInteractionTime > YAWN_TIMEOUT) {
    playSpecialAction('yawn', 'sorrow');
    lastInteractionTime = now;
  }
}

// ===== API =====

async function getLLMReply(userText) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: userText })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || 'LLM request failed');
  }

  return data;
}

async function getInitiativeReply() {
  const res = await fetch('/api/initiative', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || 'Initiative request failed');
  }

  return data;
}

function canInitiate() {
  const now = Date.now();

  if (isUserTyping) return false;
  if (isBusy || isLoading) return false;

  if (now - lastUserMessageAt < INIT_SILENCE_MS) return false;
  if (now - lastInitiativeAt < INIT_COOLDOWN_MS) return false;

  return Math.random() <= INIT_CHANCE;
}

async function tryInitiative() {
  if (!canInitiate()) return;

  try {
    const reply = await getInitiativeReply();
    lastInitiativeAt = Date.now();
    handleAgentReply(reply);
  } catch (err) {
    console.warn('initiative error:', err);
  }
}

async function handleSendMessage() {
  lastUserMessageAt = Date.now();

  const text = chatInput?.value?.trim();
  if (!text) return;

  chatInput.value = '';
  addChatMessage(text, 'user');

  try {
    const reply = await getLLMReply(text);
    handleAgentReply(reply);
  } catch (err) {
    console.error(err);
    addChatMessage(`Ошибка: ${err.message}`, 'agent');
  }
}

// ===== loading =====

async function loadModelAndAnimations() {
  isLoading = true;
  log('Загрузка агента...');

  try {
    await loadSkySphere(SKY_FILE);
    await loadWorld(WORLD_FILE);

    const vrmGltf = await loadVRM(MODEL_FILE);
      currentVrm = vrmGltf.userData.vrm;

      if (currentVrm.springBoneManager) {
  currentVrm.springBoneManager.reset();
  currentVrm.springBoneManager.enabled = false;
}

    if (!currentVrm) {
      throw new Error('VRM runtime не найден');
    }

    VRMUtils.removeUnnecessaryVertices(vrmGltf.scene);
    VRMUtils.removeUnnecessaryJoints(vrmGltf.scene);

    currentRoot = currentVrm.scene;
    scene.add(currentRoot);

    currentRoot.position.copy(LUNA_POSITION);
    currentRoot.scale.setScalar(LUNA_SCALE);
    currentRoot.rotation.y = LUNA_ROTATION_Y;

    camera.position.copy(CAMERA_POSITION);
    controls.target.copy(CAMERA_TARGET);
    controls.update();

    mixer = new THREE.AnimationMixer(currentRoot);

    mixer.addEventListener('finished', (event) => {
      if (!currentAction) return;
      if (event.action !== currentAction) return;

      stopTalkingFace();
      clearExpressions();
      isBusy = false;
      playIdle();
    });

    idleActions = [];

    const idleFiles = [
      'assets/animations/idle.vrma',
      'assets/animations/happy-idle.vrma',
      'assets/animations/happy-idle2.vrma'
    ];

    for (const file of idleFiles) {
      const action = await loadAction(file, null, THREE.LoopRepeat, Infinity);
      if (action) idleActions.push(action);
    }

    await loadAction('assets/animations/yawn.vrma', 'yawn', THREE.LoopOnce, 1);
    await loadAction('assets/animations/waving.vrma', 'wave', THREE.LoopOnce, 1);

    await loadAction('assets/animations/talking.vrma', 'talk', THREE.LoopOnce, 1);
    await loadAction('assets/animations/talking1.vrma', 'talk1', THREE.LoopOnce, 1);
    await loadAction('assets/animations/talking2.vrma', 'talk2', THREE.LoopOnce, 1);
    await loadAction('assets/animations/talking3.vrma', 'talk3', THREE.LoopOnce, 1);

    await loadAction('assets/animations/air-kiss2.vrma', 'kiss', THREE.LoopOnce, 1);
    await loadAction('assets/animations/laugh.vrma', 'laugh', THREE.LoopOnce, 1);
    await loadAction('assets/animations/funniest-laugh.vrma', 'funnyLaugh', THREE.LoopOnce, 1);
    await loadAction('assets/animations/crying.vrma', 'cry', THREE.LoopOnce, 1);
    await loadAction('assets/animations/excided.vrma', 'excited', THREE.LoopOnce, 1);

    await loadAction('assets/animations/belly-dance.vrma', 'belly', THREE.LoopOnce, 1);
    await loadAction('assets/animations/hiphop-step-dance.vrma', 'hiphop', THREE.LoopOnce, 1);
    await loadAction('assets/animations/cross-jump.vrma', 'jump', THREE.LoopOnce, 1);
    await loadAction('assets/animations/spin.vrma', 'spin', THREE.LoopOnce, 1);
    await loadAction('assets/animations/walk-around.vrma', 'walk', THREE.LoopOnce, 1);
    await loadAction('assets/animations/rumba-dance.vrma', 'rumba', THREE.LoopRepeat, 5);

    playIdle(idleActions[0] || null);

    lastInteractionTime = clock.getElapsedTime();
    lastBlinkTime = clock.getElapsedTime();

    log('Готово! Агент загружен.');
  } catch (err) {
    console.error(err);
    log(`Ошибка загрузки: ${err.message}`);
  } finally {
    isLoading = false;
  }
}

// ===== events =====

if (sendBtn) {
  sendBtn.addEventListener('click', handleSendMessage);
}

if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  });

  chatInput.addEventListener('input', () => {
    isUserTyping = true;
    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      isUserTyping = false;
    }, 1500);
  });
}

controls.addEventListener('change', () => {
  lastInteractionTime = clock.getElapsedTime();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== render loop =====

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  if (mixer) mixer.update(delta);

  if (currentVrm) {
    currentVrm.update(delta);
    updateBlinking();
  }

  switchRandomIdle();
  checkAutoYawn();

  controls.update();
  renderer.render(scene, camera);
}

loadModelAndAnimations();
animate();

setInterval(() => {
  tryInitiative();
}, 10000);
