import os
from telethon import TelegramClient
from dotenv import load_dotenv

load_dotenv()

api_id = int(os.getenv("API_ID"))
api_hash = os.getenv("API_HASH")

client = TelegramClient("luna_session", api_id, api_hash)

async def main():
    me = await client.get_me()
    print(f"Logged in as: {me.username or me.first_name}")

    # тест: отправка самому себе
    await client.send_message("me", "Luna test: я подключилась")

with client:
    client.loop.run_until_complete(main())
