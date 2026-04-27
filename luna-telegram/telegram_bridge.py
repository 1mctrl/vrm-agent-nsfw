import os
import base64
import mimetypes
import aiohttp
from telethon import TelegramClient, events
from dotenv import load_dotenv

load_dotenv()

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")

LUNA_TEXT_API_URL = "http://localhost:8000/api/chat"
LUNA_IMAGE_API_URL = "http://localhost:8000/api/chat-image"

client = TelegramClient("luna_session", API_ID, API_HASH)


def guess_mime_type(file_path: str) -> str:
    mime, _ = mimetypes.guess_type(file_path)
    return mime or "image/jpeg"


@client.on(events.NewMessage(incoming=True))
async def handler(event):
    try:
        if event.out:
            return

        if not event.is_private:
            return

        sender = await event.get_sender()

        if getattr(sender, "bot", False):
            print("Ignored bot:", sender.id)
            return

        session_id = f"tg_{event.sender_id}"
        text = (event.raw_text or "").strip()

        has_photo = bool(event.photo)
        has_image_doc = bool(
            event.document and
            getattr(event.document, "mime_type", "").startswith("image/")
        )

        async with aiohttp.ClientSession() as session:
            if has_photo or has_image_doc:
                file_path = await event.download_media(file="tmp/")
                if not file_path:
                    await event.reply("не смогла забрать фотку")
                    return

                with open(file_path, "rb") as f:
                    image_b64 = base64.b64encode(f.read()).decode("utf-8")

                mime_type = guess_mime_type(file_path)

                payload = {
                    "sessionId": session_id,
                    "message": text or "откомментируй что на фото, и ответь как Luna. без поезии",
                    "imageBase64": image_b64,
                    "imageMimeType": mime_type
                }

                async with session.post(LUNA_IMAGE_API_URL, json=payload) as resp:
                    raw = await resp.text()

                    if resp.status != 200:
                        print("Image API error:", resp.status, raw)
                        await event.reply("луна не поняла фотку")
                        return

                    try:
                        data = await resp.json()
                    except Exception:
                        print("Invalid JSON from image API:", raw)
                        await event.reply("луна зависла над картинкой")
                        return

                reply = data.get("text", "мм... странная фотка")
                await event.reply(reply)

                try:
                    os.remove(file_path)
                except OSError:
                    pass

                return

            if not text:
                return

            async with session.post(
                LUNA_TEXT_API_URL,
                json={
                    "message": text,
                    "sessionId": session_id
                }
            ) as resp:
                raw = await resp.text()

                if resp.status != 200:
                    print("Text API error:", resp.status, raw)
                    await event.reply("луна сломалась")
                    return

                try:
                    data = await resp.json()
                except Exception:
                    print("Invalid JSON from text API:", raw)
                    await event.reply("луна задумалась и зависла")
                    return

            reply = data.get("text", "...")
            await event.reply(reply)

    except Exception as e:
        print("Error:", e)
        await event.reply("луна умерла")


async def main():
    me = await client.get_me()
    print(f"Logged in as: {me.username or me.first_name}")
    print("Listening to private messages...")


with client:
    client.loop.run_until_complete(main())
    client.run_until_disconnected()
