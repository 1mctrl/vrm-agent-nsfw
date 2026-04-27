# Luna VRM Agent

Браузерный 3D-персонаж на базе VRM-модели с LLM-чатом, анимациями, памятью и интеграцией с Telegram.

В этой версии используется OpenAI API как языковая модель. Luna рендерится в браузере через Three.js + `@pixiv/three-vrm`, умеет проигрывать `.vrma` анимации, запоминать пользователей и вести отдельную память для каждого собеседника.

## Preview

https://github.com/user-attachments/assets/56abce79-b443-4c9c-a16a-98dcd3a4db8e

<img width="1127" height="920" alt="preview" src="https://github.com/user-attachments/assets/c8cc9e23-46ff-4d75-b561-6d9af30fbfbd" />

## Возможности

- 3D VRM персонаж прямо в браузере
- Three.js сцена с окружением
- Поддержка VRMA анимаций
- Общение с Luna через OpenAI API
- JSON-ответы: текст / эмоция / анимация
- Локальная система памяти
- Отдельная память для каждого пользователя
- Telegram аккаунт для Luna
- Поддержка изображений через Telegram bridge
- Инициативный режим (Luna может сама начать диалог)
- Настраиваемая длина истории чата и памяти

Telegram аккаунт Luna:

https://t.me/lovelyluna213

---
```
# Структура проекта

.
├── assets/
│   ├── animations/               # VRMA анимации
│   ├── fantasy_landscape_3.glb   # фон / небо
│   └── stylised_sky_player_home_dioroma.glb
├── blends/                       # blender исходники
├── luna-telegram/                # Telegram bridge
├── memory/                       # память (игнорируется git)
├── index.html
├── main.js                       # frontend: сцена, VRM, UI
├── server.js                     # backend: API, память, OpenAI
├── styles.css
├── package.json
└── .env                          # секреты, игнорируется git
```
---

# Требования

* Node.js
* npm
* OpenAI API key
* Современный браузер с WebGL

Для Telegram:

* Python 3
* Telegram API ID
* Telegram API HASH
* Telethon
* python-dotenv

---

# Установка

Клонировать репозиторий:

```bash
git clone https://github.com/1mctrl/vrm-agent-nsfw-.git
cd vrm-agent-nsfw-
```

Установить зависимости:

```bash
npm install
```

Создать `.env`:

Заполнить `.env`:

```env
OPENAI_API_KEY=your_openai_api_key
HOST=0.0.0.0
PORT=8000
```

## HOST варианты

Доступ и с localhost, и по локальной сети:

```env
HOST=0.0.0.0
```

Только локально:

```env
HOST=127.0.0.1
```

Только LAN:

```env
HOST=192.168.0.178
```

---

# Запуск

```bash
npm start
```

Открыть в браузере:

```txt
http://localhost:8000
```

Или с телефона / другого устройства в той же Wi-Fi сети:

```txt
http://ВАШ_IP:8000
```

Пример:

```txt
http://192.168.0.178:8000
```

---

# Система памяти

Luna автоматически создаёт файлы памяти.

```txt
memory/
├── shared.json
└── sessions/
    ├── default.json
    ├── tg_123456.json
    └── ...
```

## shared.json

Общие факты о Luna:

* кто она
* стиль общения
* постоянные сведения

## sessions/

Отдельная память для каждого пользователя.

Это позволяет:

* помнить каждого отдельно
* не смешивать пользователей
* снижать стоимость API запросов

---

# Настройка длины памяти

В `server.js`:

```js
const MAX_HISTORY_TURNS = 15;
const MAX_FACTS = 30;
const MAX_FACT_LENGTH = 160;
```

## Что влияет:

### Больше значения:

* лучше память
* лучше контекст
* дороже запросы

### Меньше значения:

* дешевле
* быстрее
* меньше запоминает

---

# Возможные ошибки

## fetch failed

Если сеть нестабильна, DNS сломан или VPN мешает:

```txt
fetch failed
```

У меня это было из-за сетевых проблем локально.

---

# Примечание

OpenAI API платный.

Чем больше:

* длина памяти
* длина истории
* изображения
* частота сообщений

тем дороже использование.

---

# Статус проекта

Экспериментальный персональный AI character project.

---

```
```
