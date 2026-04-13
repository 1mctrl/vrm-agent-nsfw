import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const msg = document.getElementById('msg');

const buttons = {
  switchAgent: document.getElementById('switchAgentBtn'),
  kiss: document.getElementById('kissBtn'),
  walk: document.getElementById('walkBtn'),
  rumba: document.getElementById('rumbaBtn'),
  spin: document.getElementById('spinBtn'),
  belly: document.getElementById('bellyBtn'),
  hiphop: document.getElementById('hiphopBtn'),
  jump: document.getElementById('jumpBtn'),
  laugh: document.getElementById('laughBtn'),
  funnyLaugh: document.getElementById('funnyLaughBtn'),
  excited: document.getElementById('excitedBtn'),
  cry: document.getElementById('cryBtn')
};

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const speechBubble = document.getElementById('speechBubble');

const BUTTON_LABELS = {
  switchAgentBtn: '🧍 Агент: base-body',
  kissBtn: '💋 Поцелуй',
  walkBtn: '🚶 Пройтись',
  rumbaBtn: '💃 Румба (5 раз)',
  spinBtn: '🌀 Крутиться',
  bellyBtn: '🪩 Belly',
  hiphopBtn: '🎵 Hiphop',
  jumpBtn: '🦘 Jump',
  laughBtn: '😄 Laugh',
  funnyLaughBtn: '🤣 Fun Laugh',
  excitedBtn: '✨ Excited',
  cryBtn: '😭 Cry'
};

const MODEL_FILES = [
  'base-body.vrm.glb',
  'base2-body.vrm.glb',
  'base3-body.vrm.glb',
  'base4-body.vrm.glb',
  'luna.vrm'
];

function getModelLabel(fileName) {
  return fileName.replace('.vrm.glb', '').replace('.vrm', '');
}

let currentModelIndex = 0;
let currentModelRoot = null;
let currentVrm = null;
let mixer = null;
let currentAction = null;

let idleActions = [];
let specialActions = {};
let animationQueue = [];
let activeQueueItem = null;

let isBusy = false;
let isSwitchingModel = false;
let lastInteractionTime = 0;

const IDLE_MIN_TIME = 13000;
const IDLE_MAX_TIME = 20000;
const YAWN_TIMEOUT = 10500;
const FADE_DURATION = 0.65;

let nextIdleSwitchTime = 0;

let lastBlinkTime = 0;
const BLINK_INTERVAL = 4.8;
const BLINK_DURATION = 0.13;

let bubbleHideTimer = null;
let talkingFaceInterval = null;

const clock = new THREE.Clock();

function log(text) {
  console.log(text);
  msg.textContent = text;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9edf5);

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
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.set(0, 1, 0);

const grid = new THREE.GridHelper(50, 50, 0xb0b7c6, 0xd3d8e4);
grid.position.y = 0.01;
grid.material.opacity = 0.9;
grid.material.transparent = true;
scene.add(grid);

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
scene.add(floor);

// базовый мягкий свет
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

// небо/отражения (очень важно для мягкости)
const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.65);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

// главный свет (солнце)
const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight.position.set(5, 10, 6);
scene.add(dirLight);

// заполняющий (убирает жёсткие тени)
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-6, 6, -4);
scene.add(fillLight);

async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  return await loader.loadAsync(url);
}

async function loadVRMA(url) {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  return gltf.userData.vrmAnimations?.[0];
}

function scheduleNextIdleSwitch() {
  nextIdleSwitchTime =
    clock.getElapsedTime() +
    (IDLE_MIN_TIME + Math.random() * (IDLE_MAX_TIME - IDLE_MIN_TIME)) / 1000;
}

function setExpression(name, value) {
  if (!currentVrm?.expressionManager || !name) return;
  currentVrm.expressionManager.setValue(name, value);
}

function clearAllSpecialExpressions() {
  if (!currentVrm?.expressionManager) return;
  setExpression('fun', 0.0);
  setExpression('sorrow', 0.0);
}

function getRandomIdle(exclude = null) {
  if (idleActions.length === 0) return null;
  if (idleActions.length === 1) return idleActions[0];

  const filtered = idleActions.filter(a => a !== exclude);
  if (filtered.length === 0) return idleActions[0];

  return filtered[Math.floor(Math.random() * filtered.length)];
}

function updateAgentButtonLabel() {
  const name = getModelLabel(MODEL_FILES[currentModelIndex]);
  BUTTON_LABELS.switchAgentBtn = `🧍 Агент: ${name}`;

  if (!buttons.switchAgent.disabled) {
    buttons.switchAgent.textContent = BUTTON_LABELS.switchAgentBtn;
  }
}

function updateButtonStates() {
  const busyButtons = new Set();

  if (activeQueueItem?.btn) {
    busyButtons.add(activeQueueItem.btn);
  }

  for (const item of animationQueue) {
    if (item.btn) busyButtons.add(item.btn);
  }

  Object.values(buttons).forEach(btn => {
    if (btn === buttons.switchAgent) {
      btn.disabled = isSwitchingModel;
      btn.textContent = isSwitchingModel
        ? BUTTON_LABELS[btn.id] + '…'
        : BUTTON_LABELS[btn.id];
      return;
    }

    const disabled = isSwitchingModel || busyButtons.has(btn);
    btn.disabled = disabled;
    btn.textContent = disabled
      ? BUTTON_LABELS[btn.id] + '…'
      : BUTTON_LABELS[btn.id];
  });
}

function stopTalkingFace() {
  if (talkingFaceInterval) {
    clearInterval(talkingFaceInterval);
    talkingFaceInterval = null;
  }

  if (!currentVrm?.expressionManager) return;
  ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(k => {
    currentVrm.expressionManager.setValue(k, 0);
  });
}

function startFakeTalkingFace() {
  stopTalkingFace();

  if (!currentVrm?.expressionManager) return;

  const visemes = ['aa', 'ih', 'ou', 'ee', 'oh'];

  talkingFaceInterval = setInterval(() => {
    if (!currentVrm?.expressionManager) return;

    for (const k of visemes) {
      currentVrm.expressionManager.setValue(k, 0);
    }

    const viseme = visemes[Math.floor(Math.random() * visemes.length)];
    const value = 0.18 + Math.random() * 0.68;
    currentVrm.expressionManager.setValue(viseme, value);
  }, 85);
}

function showSpeechBubble(text, duration = 4500) {
  if (!speechBubble) return;

  speechBubble.textContent = text;
  speechBubble.style.opacity = '1';

  clearTimeout(bubbleHideTimer);
  bubbleHideTimer = setTimeout(() => {
    speechBubble.textContent = '';
    speechBubble.style.opacity = '0';
  }, duration);
}

const bubbleHeadWorldPos = new THREE.Vector3();
const bubbleHeadScreenPos = new THREE.Vector3();

function updateSpeechBubblePosition() {
  if (!speechBubble || !currentVrm) return;

  const head =
    currentVrm.humanoid?.getNormalizedBoneNode?.('head') ||
    currentVrm.humanoid?.getRawBoneNode?.('head');

  if (!head) return;

  head.getWorldPosition(bubbleHeadWorldPos);
  bubbleHeadWorldPos.y += 0.22;

  bubbleHeadScreenPos.copy(bubbleHeadWorldPos).project(camera);

  const x = (bubbleHeadScreenPos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-bubbleHeadScreenPos.y * 0.5 + 0.5) * window.innerHeight;

  speechBubble.style.left = `${x}px`;
  speechBubble.style.top = `${y}px`;

  const visible = bubbleHeadScreenPos.z < 1 && !!speechBubble.textContent.trim();
  speechBubble.style.opacity = visible ? '1' : '0';
}

function cleanupCurrentModel() {
  animationQueue = [];
  activeQueueItem = null;
  isBusy = false;
  stopTalkingFace();
  clearAllSpecialExpressions();

  if (mixer) {
    mixer.stopAllAction();
    if (currentModelRoot) {
      mixer.uncacheRoot(currentModelRoot);
    }
  }

  if (currentModelRoot) {
    scene.remove(currentModelRoot);

    currentModelRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => mat.dispose?.());
        } else {
          obj.material.dispose?.();
        }
      }
    });
  }

  currentModelRoot = null;
  currentVrm = null;
  mixer = null;
  currentAction = null;
  idleActions = [];
  specialActions = {};
}

function createAction(clip, loopMode, repetitions = 1) {
  const action = mixer.clipAction(clip);
  action.clampWhenFinished = true;
  action.setLoop(loopMode, repetitions);
  return action;
}

async function buildAnimationSet() {
  const idleFiles = [
    'idle.vrma',
    'happy-idle.vrma',
    'happy-idle2.vrma',
    'sad-idle.vrma'
  ];

  idleActions = [];

  for (const file of idleFiles) {
    const data = await loadVRMA(file);
    if (!data) {
      console.warn(`Не удалось загрузить idle анимацию: ${file}`);
      continue;
    }

    const clip = createVRMAnimationClip(data, currentVrm);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    idleActions.push(action);
  }

  if (idleActions.length === 0) {
    throw new Error('Не удалось загрузить ни одной idle-анимации');
  }

  const specialMap = [
    ['kiss', 'air-kiss2.vrma', THREE.LoopOnce, 1],
    ['walk', 'walk-around.vrma', THREE.LoopOnce, 1],
    ['rumba', 'rumba-dance.vrma', THREE.LoopRepeat, 5],
    ['spin', 'spin.vrma', THREE.LoopOnce, 1],
    ['yawn', 'yawn.vrma', THREE.LoopOnce, 1],
    ['belly', 'belly-dance.vrma', THREE.LoopOnce, 1],
    ['hiphop', 'hiphop-step-dance.vrma', THREE.LoopOnce, 1],
    ['jump', 'cross-jump.vrma', THREE.LoopOnce, 1],
    ['laugh', 'laugh.vrma', THREE.LoopOnce, 1],
    ['funnyLaugh', 'funniest-laugh.vrma', THREE.LoopOnce, 1],
    ['excited', 'excided.vrma', THREE.LoopOnce, 1],
    ['cry', 'crying.vrma', THREE.LoopOnce, 1],
    ['talk', 'talking.vrma', THREE.LoopOnce, 1],
    ['talk1', 'talking1.vrma', THREE.LoopOnce, 1],
    ['talk2', 'talking2.vrma', THREE.LoopOnce, 1],
    ['talk3', 'talking3.vrma', THREE.LoopOnce, 1]
  ];

  specialActions = {};

  for (const [key, file, loopMode, reps] of specialMap) {
    const data = await loadVRMA(file);
    if (!data) {
      console.warn(`Не удалось загрузить спец-анимацию: ${file}`);
      continue;
    }

    const clip = createVRMAnimationClip(data, currentVrm);
    specialActions[key] = createAction(clip, loopMode, reps);
  }
}

function fitCameraToModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  root.position.set(-center.x, -box.min.y, -center.z);
  root.rotation.y = Math.PI;

  const height = Math.max(size.y, 1);
  camera.position.set(0, height * 0.9, height * 2.2);
  controls.target.set(0, height * 0.5, 0);
  controls.update();
}

function playIdle(idleAction = null) {
  const nextIdle = idleAction || getRandomIdle(currentAction);
  if (!nextIdle) return;

  if (currentAction && currentAction !== nextIdle) {
    currentAction.fadeOut(FADE_DURATION);
    nextIdle.reset().fadeIn(FADE_DURATION).play();
  } else if (currentAction !== nextIdle) {
    nextIdle.reset().play();
  }

  currentAction = nextIdle;
  scheduleNextIdleSwitch();
}

function queueAnimation(actionKey, btn, expression = null) {
  if (isSwitchingModel) return;

  const action = specialActions[actionKey];
  if (!action) return;

  lastInteractionTime = clock.getElapsedTime();

  animationQueue.push({
    key: actionKey,
    action,
    btn,
    expression
  });

  updateButtonStates();

  if (!isBusy) {
    processQueue();
  }
}

function interruptWithTalking(actionKey, expression = 'fun', text = '') {
  if (isSwitchingModel) return;

  const action = specialActions[actionKey];
  if (!action) return;

  lastInteractionTime = clock.getElapsedTime();

  animationQueue = [];
  activeQueueItem = null;
  isBusy = false;

  clearAllSpecialExpressions();
  stopTalkingFace();

  if (mixer) {
    mixer.stopAllAction();
  }

  action.reset();
  action.enabled = true;
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(1);
  action.play();

  currentAction = action;
  isBusy = true;
  activeQueueItem = {
    key: actionKey,
    action,
    btn: null,
    expression
  };

  if (expression) {
    setExpression(expression, 0.82);
  }

  if (text) {
    showSpeechBubble(text, Math.max(2600, text.length * 70));
  }

  startFakeTalkingFace();
  updateButtonStates();
}

function processQueue() {
  if (isBusy || isSwitchingModel) return;
  if (animationQueue.length === 0) return;

  isBusy = true;
  activeQueueItem = animationQueue.shift();

  const { action, expression } = activeQueueItem;
  const prevAction = currentAction;

  clearAllSpecialExpressions();

  if (prevAction && prevAction !== action) {
    prevAction.fadeOut(FADE_DURATION);
  }

  action.reset();
  action.enabled = true;
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(1);

  if (prevAction && prevAction !== action) {
    action.syncWith(prevAction);
    action.fadeIn(FADE_DURATION);
  }

  action.play();
  currentAction = action;

  if (expression) {
    setExpression(expression, 0.82);
  }

  updateButtonStates();
}

async function loadAgent(modelIndex) {
  isSwitchingModel = true;
  updateButtonStates();

  try {
    const modelFile = MODEL_FILES[modelIndex];
    log(`Загрузка агента: ${modelFile}`);

    cleanupCurrentModel();

    const vrmGltf = await loadVRM(modelFile);
    currentVrm = vrmGltf.userData.vrm;

    if (!currentVrm) {
      throw new Error(`VRM runtime не найден в ${modelFile}`);
    }

    VRMUtils.removeUnnecessaryVertices(vrmGltf.scene);
    VRMUtils.removeUnnecessaryJoints(vrmGltf.scene);

    currentModelRoot = currentVrm.scene;
    scene.add(currentModelRoot);

    fitCameraToModel(currentModelRoot);

    mixer = new THREE.AnimationMixer(currentModelRoot);

    mixer.addEventListener('finished', (event) => {
      if (!activeQueueItem) return;
      if (event.action !== activeQueueItem.action) return;

      const finishedItem = activeQueueItem;

      if (finishedItem.expression) {
        setExpression(finishedItem.expression, 0.0);
      }

      finishedItem.action.fadeOut(FADE_DURATION);

      if (
        finishedItem.key === 'talk' ||
        finishedItem.key === 'talk1' ||
        finishedItem.key === 'talk2' ||
        finishedItem.key === 'talk3'
      ) {
        stopTalkingFace();
      }

      activeQueueItem = null;
      isBusy = false;
      updateButtonStates();

      if (animationQueue.length > 0) {
        processQueue();
        return;
      }

      clearAllSpecialExpressions();
      playIdle();
    });

    await buildAnimationSet();

    currentAction = idleActions[0];
    currentAction.reset().play();

    scheduleNextIdleSwitch();
    lastInteractionTime = clock.getElapsedTime();
    lastBlinkTime = clock.getElapsedTime();

    currentModelIndex = modelIndex;
    updateAgentButtonLabel();
    log(`Готово! Активен агент: ${MODEL_FILES[currentModelIndex]}`);
  } catch (err) {
    console.error(err);
    log('Ошибка: ' + err.message);
  } finally {
    isSwitchingModel = false;
    updateAgentButtonLabel();
    updateButtonStates();
  }
}

function updateBlinking() {
  if (!currentVrm?.expressionManager || isBusy || isSwitchingModel) return;

  const now = clock.getElapsedTime();

  if (now - lastBlinkTime > BLINK_INTERVAL + Math.random() * 2) {
    const expr = currentVrm.expressionManager;
    expr.setValue('blink', 1.0);

    setTimeout(() => {
      if (currentVrm?.expressionManager) {
        currentVrm.expressionManager.setValue('blink', 0.0);
      }
    }, BLINK_DURATION * 1000);

    lastBlinkTime = now;
  }
}

function switchRandomIdle() {
  if (isBusy || isSwitchingModel || animationQueue.length > 0) return;
  if (!currentAction) return;
  if (clock.getElapsedTime() < nextIdleSwitchTime) return;
  if (!idleActions.includes(currentAction)) return;

  const nextIdle = getRandomIdle(currentAction);

  if (!nextIdle || nextIdle === currentAction) {
    scheduleNextIdleSwitch();
    return;
  }

  currentAction.fadeOut(FADE_DURATION);
  nextIdle.reset().fadeIn(FADE_DURATION).play();
  currentAction = nextIdle;

  scheduleNextIdleSwitch();
}

function checkAutoYawn() {
  if (isBusy || isSwitchingModel || animationQueue.length > 0) return;

  const now = clock.getElapsedTime();
  if (now - lastInteractionTime <= YAWN_TIMEOUT / 1000) return;
  if (!specialActions.yawn) return;

  queueAnimation('yawn', null, 'sorrow');
  lastInteractionTime = now;
}

function addChatMessage(text, role) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function fakeAgentReply(userText) {
  const clean = userText.trim().toLowerCase();

  if (clean.includes('груст') || clean.includes('печал')) {
    return {
      text: 'Я рядом. Можешь рассказать, что случилось.',
      animation: 'talk1',
      expression: 'sorrow'
    };
  }

  if (clean.includes('смешно') || clean.includes('лол')) {
    return {
      text: 'Хах. Это правда было забавно.',
      animation: Math.random() > 0.5 ? 'talk2' : 'talk3',
      expression: 'fun'
    };
  }

  if (clean.includes('привет')) {
    return {
      text: 'Привет. Я тебя слушаю.',
      animation: 'talk',
      expression: 'fun'
    };
  }

  const talkPool = ['talk', 'talk1', 'talk2', 'talk3'];
  const animation = talkPool[Math.floor(Math.random() * talkPool.length)];

  return {
    text: 'Я услышала: ' + userText,
    animation,
    expression: 'fun'
  };
}

function handleAgentReply(reply) {
  addChatMessage(reply.text, 'agent');

  if (
    reply.animation === 'talk' ||
    reply.animation === 'talk1' ||
    reply.animation === 'talk2' ||
    reply.animation === 'talk3'
  ) {
    interruptWithTalking(reply.animation, reply.expression, reply.text);
    return;
  }

  showSpeechBubble(reply.text, Math.max(2600, reply.text.length * 70));
}

function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  addChatMessage(text, 'user');

  const reply = fakeAgentReply(text);

  setTimeout(() => {
    handleAgentReply(reply);
  }, 280);
}

buttons.switchAgent.addEventListener('click', async () => {
  const nextIndex = (currentModelIndex + 1) % MODEL_FILES.length;
  await loadAgent(nextIndex);
});

buttons.kiss.addEventListener('click', () => {
  queueAnimation('kiss', buttons.kiss, 'fun');
});

buttons.walk.addEventListener('click', () => {
  queueAnimation('walk', buttons.walk, 'fun');
});

buttons.rumba.addEventListener('click', () => {
  queueAnimation('rumba', buttons.rumba, 'fun');
});

buttons.spin.addEventListener('click', () => {
  queueAnimation('spin', buttons.spin, 'fun');
});

buttons.belly.addEventListener('click', () => {
  queueAnimation('belly', buttons.belly, 'fun');
});

buttons.hiphop.addEventListener('click', () => {
  queueAnimation('hiphop', buttons.hiphop, 'fun');
});

buttons.jump.addEventListener('click', () => {
  queueAnimation('jump', buttons.jump, 'fun');
});

buttons.laugh.addEventListener('click', () => {
  queueAnimation('laugh', buttons.laugh, 'fun');
});

buttons.funnyLaugh.addEventListener('click', () => {
  queueAnimation('funnyLaugh', buttons.funnyLaugh, 'fun');
});

buttons.excited.addEventListener('click', () => {
  queueAnimation('excited', buttons.excited, 'fun');
});

buttons.cry.addEventListener('click', () => {
  queueAnimation('cry', buttons.cry, 'sorrow');
});

sendBtn.addEventListener('click', handleSendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleSendMessage();
  }
});

controls.addEventListener('change', () => {
  lastInteractionTime = clock.getElapsedTime();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  if (mixer) {
    mixer.update(delta);
  }

  if (currentVrm) {
    currentVrm.update(delta);
    updateBlinking();
  }

  switchRandomIdle();
  checkAutoYawn();
  updateSpeechBubblePosition();

  controls.update();
  renderer.render(scene, camera);
}

async function main() {
  updateAgentButtonLabel();
  updateButtonStates();
  await loadAgent(0);
}

main();
animate();
