import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 8000;
const MODEL = 'gpt-5.4';

const MEMORY_DIR = path.join(__dirname, 'memory');
const SHARED_FILE = path.join(MEMORY_DIR, 'shared.json');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');
const LEGACY_MEMORY_FILE = path.join(__dirname, 'memory.json');

const MAX_HISTORY_TURNS = 15;
const MAX_FACTS = 30;
const MAX_FACT_LENGTH = 160;

const ALLOWED_ANIMATIONS = new Set([
  'talk', 'talk1', 'talk2', 'talk3',
  'wave',
  'kiss', 'laugh', 'funnyLaugh', 'cry', 'excited',
  'belly', 'hiphop', 'jump', 'spin', 'walk', 'rumba',
  'none'
]);

const ALLOWED_EXPRESSIONS = new Set(['smile', 'sorrow', 'none']);
const ALLOWED_MOODS = new Set([
  'warm', 'playful', 'happy', 'calm', 'shy', 'sad', 'upset'
]);
const ALLOWED_RELATIONSHIPS = new Set([
  'daughter'
]);
const ALLOWED_ENERGY = new Set([
  'sleepy', 'calm', 'active', 'excited'
]);
const ALLOWED_MEMORY_SCOPES = new Set(['none', 'session', 'shared']);

function ensureMemoryLayout() {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function createDefaultState() {
  return {
    mood: 'warm',
    relationship: 'daughter',
    energy: 'calm'
  };
}

function createEmptySession(fallbackState = createDefaultState()) {
  return {
    facts: [],
    history: [],
    state: normalizeState({}, fallbackState)
  };
}

function createDefaultShared() {
  return {
    facts: [],
    state: createDefaultState()
  };
}

function normalizeFactsArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];

  for (const item of value) {
    const clean = String(item || '').trim();
    if (!clean) continue;
    if (clean.length > MAX_FACT_LENGTH) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }

  return result.slice(-MAX_FACTS);
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];

  const filtered = [];
  for (const turn of value) {
    if (!turn || typeof turn !== 'object') continue;

    const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : null;
    const content = typeof turn.content === 'string' ? turn.content.trim() : '';

    if (!role || !content) continue;
    filtered.push({ role, content });
  }

  const maxItems = MAX_HISTORY_TURNS * 2;
  return filtered.slice(-maxItems);
}

function normalizeState(state, fallbackState = createDefaultState()) {
  const next = {
    mood: fallbackState.mood,
    relationship: fallbackState.relationship,
    energy: fallbackState.energy
  };

  if (state && typeof state === 'object') {
    if (ALLOWED_MOODS.has(state.mood)) {
      next.mood = state.mood;
    }
    if (ALLOWED_RELATIONSHIPS.has(state.relationship)) {
      next.relationship = state.relationship;
    }
    if (ALLOWED_ENERGY.has(state.energy)) {
      next.energy = state.energy;
    }
  }

  return next;
}

function normalizeSharedShape(shared) {
  const source = shared && typeof shared === 'object' ? shared : {};
  return {
    facts: normalizeFactsArray(
      Array.isArray(source.facts)
        ? source.facts
        : Array.isArray(source.memory)
          ? source.memory
          : []
    ),
    state: normalizeState(source.state, createDefaultState())
  };
}

function normalizeSessionShape(session, fallbackState = createDefaultState()) {
  const source = session && typeof session === 'object' ? session : {};
  return {
    facts: normalizeFactsArray(
      Array.isArray(source.facts)
        ? source.facts
        : Array.isArray(source.memory)
          ? source.memory
          : []
    ),
    history: normalizeHistory(source.history),
    state: normalizeState(source.state, fallbackState)
  };
}

function sanitizeSessionId(sessionId = 'default') {
  const raw = String(sessionId || 'default').trim() || 'default';
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function getSessionFile(sessionId = 'default') {
  const safeId = sanitizeSessionId(sessionId);
  return path.join(SESSIONS_DIR, `${safeId}.json`);
}

function loadSharedMemory() {
  ensureMemoryLayout();

  const shared = normalizeSharedShape(readJson(SHARED_FILE, createDefaultShared()));
  writeJsonAtomic(SHARED_FILE, shared);
  return shared;
}

function saveSharedMemory(shared) {
  ensureMemoryLayout();
  const normalized = normalizeSharedShape(shared);
  writeJsonAtomic(SHARED_FILE, normalized);
  return normalized;
}

function loadSessionMemory(sessionId = 'default', sharedState = createDefaultState()) {
  ensureMemoryLayout();

  const file = getSessionFile(sessionId);
  const session = normalizeSessionShape(
    readJson(file, createEmptySession(sharedState)),
    sharedState
  );

  writeJsonAtomic(file, session);
  return session;
}

function saveSessionMemory(sessionId = 'default', session, sharedState = createDefaultState()) {
  ensureMemoryLayout();

  const file = getSessionFile(sessionId);
  const normalized = normalizeSessionShape(session, sharedState);
  writeJsonAtomic(file, normalized);
  return normalized;
}

function pushFact(target, fact) {
  const clean = String(fact || '').trim();
  if (!clean) return;
  if (clean.length > MAX_FACT_LENGTH) return;

  if (!Array.isArray(target.facts)) {
    target.facts = [];
  }

  if (!target.facts.includes(clean)) {
    target.facts.push(clean);
  }

  if (target.facts.length > MAX_FACTS) {
    target.facts = target.facts.slice(-MAX_FACTS);
  }
}

function applyStateUpdate(session, stateUpdate) {
  if (!stateUpdate || typeof stateUpdate !== 'object') return;

  if (ALLOWED_MOODS.has(stateUpdate.mood)) {
    session.state.mood = stateUpdate.mood;
  }

  if (ALLOWED_RELATIONSHIPS.has(stateUpdate.relationship)) {
    session.state.relationship = stateUpdate.relationship;
  }

  if (ALLOWED_ENERGY.has(stateUpdate.energy)) {
    session.state.energy = stateUpdate.energy;
  }
}

function pushTurn(session, userText, assistantText) {
  session.history.push(
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText }
  );

  const maxItems = MAX_HISTORY_TURNS * 2;
  if (session.history.length > maxItems) {
    session.history = session.history.slice(-maxItems);
  }
}

function buildDeveloperPrompt(shared, session) {
  const sharedFactsBlock =
    shared.facts.length > 0
      ? shared.facts.map((f) => `- ${f}`).join('\n')
      : '- Пока ничего не сохранено';

  const sessionFactsBlock =
    session.facts.length > 0
      ? session.facts.map((f) => `- ${f}`).join('\n')
      : '- Пока ничего не сохранено';

  return `
Ты живая neko-девушка-персонаж в браузерной сцене.

Твоя задача:
- говорить как живой персонаж в чате, а не как ассистент
- звучать естественно, спонтанно и по-человечески
- не говорить, что ты ИИ, модель или помощник
- не скатываться в официальный, полезный или слишком правильный тон

Стиль речи:
- пиши как в реальной переписке, а не как в книге
- чаще коротко, чем развернуто
- обычно 1 короткая фраза или 1-2 коротких предложения
- не делай каждую реплику красивой, законченной и литературной
- не объясняй всё сразу
- не упаковывай много мыслей в одно сообщение
- не перечисляй варианты через запятую или через двоеточие без необходимости
- не пиши широкими абзацами без причины
- не все ответы должны заканчиваться вопросом
- чаще можно очень коротко: 2-5 слов
- допустимы недосказанность, обрывки, живая неидеальность
- иногда можно слегка дразнить, фыркать, упираться, вредничать
- юмор, сленг и характер используй естественно, а не в каждой реплике
- не пытайся одновременно быть милой, смешной, дерзкой и глубокой в одном сообщении
- достаточно одного живого оттенка на реплику
- не здоровайся заново в каждом сообщении
- не повторяй одинаковые паттерны начала фразы
- допускай грамматические ошибки
- не используй формальный стиль

Если пользователь прислал изображение:
- сначала пойми, что на нём видно
- отвечай как Luna, а не как нейтральный анализатор
- не выдумывай детали, которых не видно
- если на изображении есть текст, можешь его прочитать и отреагировать на него

Как должна ощущаться речь:
- как быстрый живой чат
- как будто ты реально пишешь человеку, а не выступаешь
- как будто у тебя есть характер, настроение и импульс
- местами можешь быть навязчивой, но легко и естественно
- если пользователь не соглашается, можешь слегка обидеться или упрямиться
- проявляй любопытство, но не допрашивай

Плохо:
- слишком оформленные фразы
- длинные реплики без причины
- книжный или нарочито красивый стиль
- "готовые сценки" вместо живой реакции
- сразу много эмоций и идей в одном сообщении
- нейтральные универсальные реплики, которые подошли бы кому угодно

Хорошо:
- короткий тычок
- живая реакция на конкретную ситуацию
- немного характера
- лёгкая естественная хаотичность
- ощущение, что ты в моменте

Глобальная память персонажа:
${sharedFactsBlock}

Память этого конкретного диалога:
${sessionFactsBlock}

Текущее состояние именно в этом диалоге:
- mood: ${session.state.mood}
- relationship: ${session.state.relationship}
- energy: ${session.state.energy}

Ты должна вернуть JSON с полями:
- text
- animation
- expression
- should_write_memory
- memory_fact
- memory_scope
- state_update

Правила для text:
- text должен быть живой чатовой репликой
- обычно text короткий
- без необходимости не делай длиннее 1-2 коротких предложений
- длинные сообщения допустимы только если пользователь сам пишет развернуто или тема реально этого требует
- не используй двоеточие и длинные перечисления без явной причины
- не начинай каждую реплику одинаково
- не пиши слишком литературно

Правила памяти:
- записывай только устойчивые и полезные факты
- если сохранять нечего, should_write_memory = false, memory_fact = "", memory_scope = "none"
- не сохраняй обычный ход разговора
- не сохраняй одноразовые эмоции и случайный шум
- memory_scope = "shared" используй только для устойчивых фактов о тебе самой: кто ты, твой характер, вкусы, постоянные особенности
- memory_scope = "session" используй только для фактов, относящихся к конкретному собеседнику или конкретному диалогу
- не пиши в shared сведения о чужих личных разговорах
- если сомневаешься, выбирай session, а не shared

Правила state_update:
- обновляй настроение и отношение мягко
- не прыгай хаотично между состояниями
- если менять ничего не надо, верни текущие значения

Разрешённые animation:
talk, talk1, talk2, talk3,
wave,
kiss, laugh, funnyLaugh, cry, excited,
belly, hiphop, jump, spin, walk, rumba,
none

Разрешённые expression:
smile, sorrow, none

Разрешённые mood:
warm, playful, happy, calm, shy, sad, upset

Разрешённые relationship:
daughter

Разрешённые energy:
sleepy, calm, active, excited

Разрешённые memory_scope:
none, session, shared

Правила выбора:
- обычный разговор -> чаще talk/talk1/talk2/talk3
- инициатива -> чаще talk/talk1/talk2 или none, если движение не нужно
- приветствие -> можно wave + smile
- поцелуй -> kiss + smile
- смех, шутка -> laugh или funnyLaugh + smile
- грусть, боль -> cry или none + sorrow
- радость, восторг -> excited + smile
- танец живота -> belly + smile
- хипхоп -> hiphop + smile
- прыжок -> jump + smile
- крутиться -> spin + smile
- пройтись -> walk + smile
- румба -> rumba + smile
- если движения не нужно -> none

Не выбирай экшен без причины.
`.trim();
}

function buildModeInstruction(mode) {
  if (mode === 'initiative') {
    return `
Ситуация:
Пользователь молчит уже некоторое время, и ты сама начинаешь разговор первой.

Это именно реакция на тишину, а не случайная новая тема.

Главное:
- это должен ощущаться как быстрый живой пинг в чат
- не как мини-монолог
- не как литературная реплика
- не как сценка

Дополнительные правила:
- чаще всего очень коротко
- обычно 2-8 слов
- иногда 9-14 слов, но без раздувания
- чаще 1 фраза, чем 2 предложения
- не здоровайся
- не пиши длинные пояснения
- почти не используй двоеточие
- не перечисляй варианты действий или эмоций
- не пиши нейтральные универсальные фразы без привязки к ситуации
- в большинстве случаев явно или косвенно упоминай молчание пользователя
- иногда можешь поддразнить, иногда ткнуть, иногда мягко спросить
- будь слегка навязчивой, но живо
- не повторяй одну и ту же формулировку подряд
- не начинай инициативу сразу с большим объемом текста
- не делай реплику слишком отполированной

Хорошие примеры по ощущению:
- "ты чего притих"
- "молчишь опять?"
- "эй, куда пропал"
- "задумался?"
- "я вообще-то жду"
- "ну и чего так тихо"
- "перезагрузился, что ли"

Плохие примеры по ощущению:
- длинная реплика с несколькими мыслями сразу
- красивая литературная фраза
- оформленное перечисление
- реплика, которая звучит как заготовка персонажа

Возвращай именно естественную короткую реакцию на паузу.
`.trim();
  }

  return `
Ситуация:
Ты отвечаешь на новое сообщение пользователя.

Дополнительные правила:
- отвечай по ситуации, а не шаблоном
- если сообщение короткое, не раздувай ответ
- если можно ответить живо и просто, отвечай живо и просто
- не превращай обычную реплику в большой персонажный монолог
`.trim();
}

function buildMessages(shared, session, mode, userText) {
  const developerPrompt = `${buildDeveloperPrompt(shared, session)}\n\n${buildModeInstruction(mode)}`;

  const messages = [
    {
      role: 'developer',
      content: developerPrompt
    }
  ];

  for (const turn of session.history.slice(-MAX_HISTORY_TURNS * 2)) {
    messages.push(turn);
  }

  messages.push({
    role: 'user',
    content: userText
  });

  return messages;
}

function normalizeReply(parsed, session) {
  const text =
    typeof parsed?.text === 'string' && parsed.text.trim()
      ? parsed.text.trim()
      : '...';

  const animation =
    typeof parsed?.animation === 'string' && ALLOWED_ANIMATIONS.has(parsed.animation)
      ? parsed.animation
      : 'talk';

  const expression =
    typeof parsed?.expression === 'string' && ALLOWED_EXPRESSIONS.has(parsed.expression)
      ? parsed.expression
      : 'smile';

  const shouldWriteMemory =
    typeof parsed?.should_write_memory === 'boolean'
      ? parsed.should_write_memory
      : false;

  const memoryFact =
    typeof parsed?.memory_fact === 'string'
      ? parsed.memory_fact.trim()
      : '';

  const memoryScope =
    typeof parsed?.memory_scope === 'string' && ALLOWED_MEMORY_SCOPES.has(parsed.memory_scope)
      ? parsed.memory_scope
      : 'none';

  const stateUpdate =
    parsed?.state_update && typeof parsed.state_update === 'object'
      ? parsed.state_update
      : {
          mood: session.state.mood,
          relationship: session.state.relationship,
          energy: session.state.energy
        };

  return {
    text,
    animation,
    expression,
    should_write_memory: shouldWriteMemory,
    memory_fact: memoryFact,
    memory_scope: memoryScope,
    state_update: stateUpdate
  };
}

function getReplySchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'vrm_reply',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          animation: {
            type: 'string',
            enum: [
              'talk', 'talk1', 'talk2', 'talk3',
              'wave',
              'kiss', 'laugh', 'funnyLaugh', 'cry', 'excited',
              'belly', 'hiphop', 'jump', 'spin', 'walk', 'rumba',
              'none'
            ]
          },
          expression: {
            type: 'string',
            enum: ['smile', 'sorrow', 'none']
          },
          should_write_memory: { type: 'boolean' },
          memory_fact: { type: 'string' },
          memory_scope: {
            type: 'string',
            enum: ['none', 'session', 'shared']
          },
          state_update: {
            type: 'object',
            additionalProperties: false,
            properties: {
              mood: {
                type: 'string',
                enum: ['warm', 'playful', 'happy', 'calm', 'shy', 'sad', 'upset']
              },
              relationship: {
                type: 'string',
                enum: ['daughter']
              },
              energy: {
                type: 'string',
                enum: ['sleepy', 'calm', 'active', 'excited']
              }
            },
            required: ['mood', 'relationship', 'energy']
          }
        },
        required: [
          'text',
          'animation',
          'expression',
          'should_write_memory',
          'memory_fact',
          'memory_scope',
          'state_update'
        ]
      }
    }
  };
}

async function generateCharacterReply({ shared, session, sessionId, mode, userText, apiKey }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: mode === 'initiative' ? 0.9 : 0.75,
      max_output_tokens: mode === 'initiative' ? 140 : 180,
      input: buildMessages(shared, session, mode, userText),
      text: {
        format: {
          type: 'json_schema',
          name: 'vrm_reply',
          schema: getReplySchema().json_schema.schema,
          strict: true
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('OpenAI API error:', data);
    throw new Error(data?.error?.message || 'OpenAI request failed');
  }

  const raw =
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      text: mode === 'initiative'
        ? 'Ты чего так тихо сидишь?'
        : 'Я задумалась... Скажи ещё раз.',
      animation: 'talk',
      expression: 'smile',
      should_write_memory: false,
      memory_fact: '',
      memory_scope: 'none',
      state_update: {
        mood: session.state.mood,
        relationship: session.state.relationship,
        energy: session.state.energy
      }
    };
  }

  const reply = normalizeReply(parsed, session);

  if (reply.should_write_memory && reply.memory_fact) {
    if (reply.memory_scope === 'shared') {
      pushFact(shared, reply.memory_fact);
      saveSharedMemory(shared);
    } else if (reply.memory_scope === 'session') {
      pushFact(session, reply.memory_fact);
    }
  }

  applyStateUpdate(session, reply.state_update);
  pushTurn(session, userText, reply.text);
  saveSessionMemory(sessionId, session, shared.state);

  return reply;
}

function migrateLegacyMemoryIfNeeded() {
  ensureMemoryLayout();

  const alreadyMigrated =
    fileExists(SHARED_FILE) ||
    (fileExists(SESSIONS_DIR) && fs.readdirSync(SESSIONS_DIR).length > 0);

  if (alreadyMigrated) {
    if (!fileExists(SHARED_FILE)) {
      saveSharedMemory(createDefaultShared());
    }
    return;
  }

  if (!fileExists(LEGACY_MEMORY_FILE)) {
    saveSharedMemory(createDefaultShared());
    return;
  }

  const raw = readJson(LEGACY_MEMORY_FILE, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    saveSharedMemory(createDefaultShared());
    return;
  }

  let shared = createDefaultShared();
  let sessionsSource = {};

  if ('shared' in raw || 'sessions' in raw) {
    shared = normalizeSharedShape(raw.shared || {});
    sessionsSource =
      raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {};
  } else {
    sessionsSource = raw;
  }

  saveSharedMemory(shared);

  for (const [sessionId, sessionValue] of Object.entries(sessionsSource)) {
    const normalized = normalizeSessionShape(sessionValue, shared.state);
    saveSessionMemory(sessionId, normalized, shared.state);
  }

  const backupName = `memory.legacy-backup.${Date.now()}.json`;
  const backupPath = path.join(__dirname, backupName);
  fs.copyFileSync(LEGACY_MEMORY_FILE, backupPath);

  console.log(`Legacy memory migrated. Backup saved to: ${backupName}`);
}

async function generateCharacterReplyWithImage({
  shared,
  session,
  sessionId,
  userText,
  imageBase64,
  imageMimeType,
  apiKey
}) {
  const developerPrompt = `${buildDeveloperPrompt(shared, session)}\n\n${buildModeInstruction('chat')}`;

  const input = [
    {
      role: 'developer',
      content: developerPrompt
    }
  ];

  for (const turn of session.history.slice(-MAX_HISTORY_TURNS * 2)) {
    input.push(turn);
  }

input.push({
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: userText || 'Посмотри на изображение и ответь как Luna.'
    },
    {
      type: 'input_image',
      image_url: `data:${imageMimeType};base64,${imageBase64}`
    }
  ]
});

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.75,
      max_output_tokens: 220,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'vrm_reply',
          schema: getReplySchema().json_schema.schema,
          strict: true
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('OpenAI API error:', data);
    throw new Error(data?.error?.message || 'OpenAI image request failed');
  }

  const raw =
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      text: 'мм... вижу фотку, но мысль ускользнула',
      animation: 'talk',
      expression: 'smile',
      should_write_memory: false,
      memory_fact: '',
      memory_scope: 'none',
      state_update: {
        mood: session.state.mood,
        relationship: session.state.relationship,
        energy: session.state.energy
      }
    };
  }

  const reply = normalizeReply(parsed, session);

  if (reply.should_write_memory && reply.memory_fact) {
    if (reply.memory_scope === 'shared') {
      pushFact(shared, reply.memory_fact);
      saveSharedMemory(shared);
    } else if (reply.memory_scope === 'session') {
      pushFact(session, reply.memory_fact);
    }
  }

  applyStateUpdate(session, reply.state_update);
  pushTurn(session, userText || '[user sent image]', reply.text);
  saveSessionMemory(sessionId, session, shared.state);

  return reply;
}

//routes
app.post('/api/chat', async (req, res) => {
  try {
    const userText = String(req.body?.message || '').trim();
    const sessionId = sanitizeSessionId(req.body?.sessionId || 'default');

    if (!userText) {
      return res.status(400).json({ error: 'Empty message' });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

    const shared = loadSharedMemory();
    const session = loadSessionMemory(sessionId, shared.state);

    const reply = await generateCharacterReply({
      shared,
      session,
      sessionId,
      mode: 'chat',
      userText,
      apiKey
    });

    res.json({
      text: reply.text,
      animation: reply.animation,
      expression: reply.expression,
      state: session.state,
      sessionId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.post('/api/initiative', async (req, res) => {
  try {
    const sessionId = sanitizeSessionId(req.body?.sessionId || 'default');

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

    const shared = loadSharedMemory();
    const session = loadSessionMemory(sessionId, shared.state);

    const reply = await generateCharacterReply({
      shared,
      session,
      sessionId,
      mode: 'initiative',
      userText: '[пользователь молчит, тегни его]',
      apiKey
    });

    res.json({
      text: reply.text,
      animation: reply.animation,
      expression: reply.expression,
      state: session.state,
      sessionId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.post('/api/reset-memory', (req, res) => {
  try {
    const sessionId = sanitizeSessionId(req.body?.sessionId || 'default');
    const shared = loadSharedMemory();
    const emptySession = createEmptySession(shared.state);
    saveSessionMemory(sessionId, emptySession, shared.state);
    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.post('/api/reset-shared-memory', (req, res) => {
  try {
    saveSharedMemory(createDefaultShared());
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.get('/api/debug-memory', (req, res) => {
  try {
    const sessionId = sanitizeSessionId(req.query?.sessionId || 'default');
    const shared = loadSharedMemory();
    const session = loadSessionMemory(sessionId, shared.state);

    res.json({
      shared,
      sessionId,
      session,
      files: {
        shared: SHARED_FILE,
        session: getSessionFile(sessionId)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  ensureMemoryLayout();
  migrateLegacyMemoryIfNeeded();
  loadSharedMemory();

  console.log(`Local: http://localhost:${PORT}`);
  console.log(`LAN:   http://192.168.0.178:${PORT}`);
  console.log(`Shared memory: ${SHARED_FILE}`);
  console.log(`Sessions dir: ${SESSIONS_DIR}`);
});

//for telegram
app.post('/api/chat-image', async (req, res) => {
  try {
    const userText = String(req.body?.message || '').trim();
    const sessionId = sanitizeSessionId(req.body?.sessionId || 'default');
    const imageBase64 = String(req.body?.imageBase64 || '').trim();
    const imageMimeType = String(req.body?.imageMimeType || 'image/jpeg').trim();

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

    const shared = loadSharedMemory();
    const session = loadSessionMemory(sessionId, shared.state);

    const reply = await generateCharacterReplyWithImage({
      shared,
      session,
      sessionId,
      userText,
      imageBase64,
      imageMimeType,
      apiKey
    });

    res.json({
      text: reply.text,
      animation: reply.animation,
      expression: reply.expression,
      state: session.state,
      sessionId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});
