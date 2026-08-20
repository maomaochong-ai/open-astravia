# Discord Setup

How to wire up `im-gateway` to a Discord bot. The transport uses the Discord gateway (WebSocket), so no public IP is required.

## 1. Create the application and bot

1. Go to <https://discord.com/developers/applications> and click **New Application**
2. Open **Bot** in the sidebar and click **Add Bot**
3. Click **Reset Token** and copy the token — this is your **bot token**

## 2. Enable the Message Content intent

Still on the **Bot** page, scroll to **Privileged Gateway Intents** and enable **MESSAGE CONTENT INTENT**. Without it every inbound message arrives with empty text and the bot appears to ignore you.

## 3. Invite the bot

Under **OAuth2 → URL Generator**, select the `bot` scope and these bot permissions:

- View Channels
- Send Messages
- Read Message History
- Add Reactions
- Attach Files
- Embed Links

Open the generated URL and pick a server. For DM-only use you can skip the invite entirely — users can DM the bot directly once it shares a server with them.

## 4. Configure the gateway

In the desktop app: **Settings → Claw → Discord**, paste the bot token, then activate the channel.

For standalone use:

```yaml
transport:
  name: discord
  discord:
    allowedUserIds: [] # empty = every user may DM the bot
    allowedGuildIds: [] # empty = every server the bot is in
```

```yaml
# credentials.yaml (chmod 0600)
discord:
  botToken: "..."
```

Keychain key `discord_bot_token`; env var `IM_GATEWAY_DISCORD_BOT_TOKEN`.

To collect IDs, enable **Settings → Advanced → Developer Mode** in the Discord client, then right-click a user or server and choose **Copy ID**.

## 5. Verify

DM the bot, or @-mention it in a server channel it can see.

## Supported interactions

| Capability | Support |
| --- | --- |
| Streaming replies | Yes — the message is edited in place |
| Buttons | Yes — component interactions are delivered back to the agent |
| Reactions | Yes — turn status (👀 / ✅ / ❌) |
| Reply threading | Yes — the first message of a turn replies to the trigger |
| Typing indicator | Yes |
| Attachments | Both directions |

Discord caps messages at 2000 characters; longer replies are split.

## Troubleshooting

- **Messages arrive with empty text**: the Message Content intent is not enabled (step 2).
- **The bot never responds in a server**: it needs @-mentioning, and must have View Channel + Send Messages in that channel.
- **`401: Unauthorized`**: the token was reset; copy the new one.
