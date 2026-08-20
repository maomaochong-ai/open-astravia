# Slack Setup

How to wire up `im-gateway` to a Slack app using Socket Mode. Socket Mode keeps an outbound WebSocket to Slack, so no public request URL is required.

## 1. Create the app

1. Go to <https://api.slack.com/apps> and click **Create New App → From scratch**
2. Name it and pick the workspace to install into

## 2. Enable Socket Mode

Under **Settings → Socket Mode**, toggle **Enable Socket Mode**. Slack prompts you to create an app-level token — give it the `connections:write` scope. Copy the resulting **`xapp-…` app token**.

## 3. Bot token scopes

Under **Features → OAuth & Permissions → Bot Token Scopes**, add:

- `chat:write` — send and edit messages
- `im:history` — read direct messages
- `app_mentions:read` — receive @-mentions in channels
- `reactions:write` — status reactions
- `files:write` — send attachments
- `files:read` — download inbound files
- `channels:history`, `groups:history` — only if you want channel messages beyond @-mentions

## 4. Subscribe to events

Under **Features → Event Subscriptions**, enable events and subscribe to these bot events:

- `message.im` — direct messages
- `app_mention` — @-mentions in channels

## 5. Install and collect tokens

Click **Install to Workspace**. Afterwards copy the **Bot User OAuth Token** (`xoxb-…`) from **OAuth & Permissions**.

You now have two tokens: `xoxb-…` (bot) and `xapp-…` (app-level, from step 2). Both are required.

## 6. Configure the gateway

In the desktop app: **Settings → Claw → Slack**, paste both tokens, then activate the channel.

For standalone use:

```yaml
transport:
  name: slack
  slack:
    allowedUserIds: [] # empty = every user
    allowedChannelIds: [] # channel IDs (C…/D…), NOT names; empty = every channel
```

```yaml
# credentials.yaml (chmod 0600)
slack:
  botToken: "xoxb-..."
  appToken: "xapp-..."
```

Keychain keys are `slack_bot_token` / `slack_app_token`; env vars are `IM_GATEWAY_SLACK_BOT_TOKEN` / `IM_GATEWAY_SLACK_APP_TOKEN`.

> The channel allowlist matches **channel IDs**, not names. A name like `#general` never matches and the filter silently drops everything. Get the ID from the channel's **View channel details → About** panel.

## 7. Verify

Send the bot a direct message. In channels, invite the bot (`/invite @yourbot`) and @-mention it.

## Supported interactions

| Capability | Support |
| --- | --- |
| Streaming replies | Yes — `chat.update` edits the message in place |
| Block Kit buttons | Yes — presses are delivered back to the agent |
| Reactions | Yes — turn status (👀 / ✅ / ❌) |
| Thread replies | Yes — the turn replies inside the triggering message's thread |
| Typing indicator | No — Slack has no bot typing API; the status reaction serves this role |
| Attachments | Both directions |

## Troubleshooting

- **`invalid_auth`**: the bot token is wrong or the app was uninstalled.
- **Socket Mode never connects**: the app token is missing the `connections:write` scope.
- **The bot sees nothing in a channel**: it must be invited to the channel and @-mentioned, and `app_mention` must be subscribed.
- **A DM @-mention seems to fire twice**: it does not — the transport de-duplicates the `message.im` / `app_mention` pair.
