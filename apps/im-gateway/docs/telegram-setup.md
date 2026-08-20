# Telegram Setup

How to wire up `im-gateway` to a Telegram bot. The transport uses the official Bot API with long polling, so no public IP, webhook, or reverse proxy is required.

## 1. Create a bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts (display name, then a username ending in `bot`)
3. BotFather replies with a token like `123456789:AAF...` — this is your **bot token**

## 2. Configure privacy mode (group chats only)

By default a bot only sees messages that start with a command or that @-mention it. The gateway triggers on @-mentions in groups, which works with the default setting. If you also want the bot to read every group message (not recommended), send `/setprivacy` to BotFather and disable privacy mode.

Private chats are unaffected — the bot always sees every direct message.

## 3. Find your user ID (optional, recommended)

Leaving the allowlist empty means anyone who finds the bot can talk to it. To restrict it, get your numeric user ID from [@userinfobot](https://t.me/userinfobot) and add it to `allowedUserIds`.

## 4. Configure the gateway

In the desktop app: **Settings → Claw → Telegram**, paste the bot token, optionally add allowed user IDs, then activate the channel.

For standalone (`im-gateway start`) use, put the token in credentials and the rest in `config.yaml`:

```yaml
transport:
  name: telegram
  telegram:
    allowedUserIds: [123456789] # empty = accept every private chat
```

```yaml
# credentials.yaml (chmod 0600) — or use the OS keychain / env var
telegram:
  botToken: "123456789:AAF..."
```

The token may also come from the keychain (service `vetta-im-gateway`, key `telegram_bot_token`) or the `IM_GATEWAY_TELEGRAM_BOT_TOKEN` environment variable.

## 5. Verify

Send a direct message to the bot. You should see a 👀 reaction appear on your message while the agent works, then ✅ when the reply lands. In groups, @-mention the bot to trigger it.

## Supported interactions

| Capability | Support |
| --- | --- |
| Streaming replies | Yes — the reply message is edited in place as the agent writes |
| Inline buttons | Yes — button presses are delivered back to the agent |
| Reactions | Yes — used as the turn status indicator (👀 working / ✅ done / ❌ failed) |
| Reply threading | Yes — the first message of a turn quotes the triggering message |
| Typing indicator | Yes |
| Attachments | Both directions — photos, documents and voice messages |

Message length is capped at 4096 characters per the Bot API; longer replies are split.

## Troubleshooting

- **`401 Unauthorized`**: the token is wrong or was revoked. Re-issue it with `/token` in BotFather.
- **The bot ignores group messages**: confirm it was @-mentioned by its exact username, and that it is actually a member of the group.
- **Media arrives as a hint instead of a file**: inbound media requires the conversation cwd to be set; in desktop mode this is automatic.
