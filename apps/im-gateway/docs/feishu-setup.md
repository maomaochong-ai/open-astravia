# Feishu Setup

How to wire up `im-gateway` to a Feishu (Lark) bot using long-connection events. No public IP, webhook, or reverse proxy required.

## Quick path: scan to create the app

The Feishu Open Platform can create the app for you. `im-gateway feishu register`
starts an OAuth 2.0 Device Authorization flow and prints a verification link:

```bash
im-gateway feishu register
```

Scan the printed link with Feishu (or open it inside the client). The page it
opens creates the bot with the scopes and the `im.message.receive_v1`
subscription this gateway needs already ticked; confirm it and the command
prints the App ID and App Secret, ready to drop into the credential store
described in step 7 below. A Lark tenant additionally needs
`transport.feishu.baseUrl: https://open.larksuite.com` in `config.yaml`.

Desktop users get the same flow with a rendered QR code under
**设置 → Claw → 飞书 → 扫码接入**; the credentials are stored for them.

The rest of this document is the manual route, for tenants where members
cannot create apps themselves.

## 1. Create a self-built application

1. Sign in to the Feishu Open Platform: <https://open.feishu.cn/app>
2. Click **Create Custom App**, give it a name and icon
3. Open the new app's detail page and copy the **App ID** and **App Secret** from the **Credentials & Basic Info** section — keep these handy

## 2. Enable bot capability

In the left sidebar, **Add Features → Bot → Enable Bot**. This is what lets the application receive `im.message.receive_v1` events.

## 3. Subscribe to message events

In **Event Subscriptions**, switch to **Long-Connection** mode (the default in newer Feishu releases). Add the following event:

- `im.message.receive_v1` — receive private chat messages

The first-milestone gateway only supports private chats, so you do not need to subscribe to group events. Adding extra events is harmless but they will be silently dropped.

## 4. Permission scopes

Open **Permissions & Scopes** and grant the bot the minimum scope set:

- `im:message` — send messages
- `im:message.p2p_msg` — send private messages
- `im:message:send_as_bot`

(If you cannot find a scope by the exact name, search the page; Feishu renames them periodically.)

## 5. Publish a version

In **Version Management & Release**, create a version and submit it. Self-built apps approve themselves; click **Confirm Release**. The bot is now installed in your tenant.

## 6. Add the bot to a chat

The first-milestone gateway only handles private chats. Open Feishu, search for your app's name in the people search, and start a private chat with it.

## 7. Configure im-gateway

```bash
im-gateway init
```

This creates `~/.vetta/im-gateway/config.yaml` and `~/.vetta/im-gateway/credentials.yaml`. Edit the config to select Feishu:

```yaml
transport:
  name: feishu
```

Then put the App ID + App Secret somewhere the gateway can find them. Three options, in order of preference:

### Option A — OS keychain (recommended)

```bash
# macOS / linux secret service / Windows credential manager
security add-generic-password -s vetta-im-gateway -a feishu_app_id     -w
security add-generic-password -s vetta-im-gateway -a feishu_app_secret -w
```

(On Linux use `secret-tool store`; on Windows use the Credential Manager UI or `cmdkey`.)

### Option B — credentials.yaml

Edit the file `im-gateway init` generated:

```yaml
feishu:
  appId:     "cli_a1234567890abcde"
  appSecret: "AbcDef..."
```

Make sure the file is `chmod 0600`. The gateway will warn at startup if it isn't.

### Option C — environment variables

```bash
export IM_GATEWAY_FEISHU_APP_ID=cli_a1234567890abcde
export IM_GATEWAY_FEISHU_APP_SECRET=AbcDef...
im-gateway start
```

Environment variables override both keychain and file values.

## 8. Run

```bash
im-gateway start
```

You should see a banner like:

```
im-gateway dev
  config:      /Users/you/.vetta/im-gateway/config.yaml
  transport:   feishu
  credentials: keychain
  state:       /Users/you/.vetta/im-gateway/state.json
  log level:   info
  pool size:   8
```

Then open your private chat with the bot in Feishu and send `/help`. You should get a list of slash commands back. From there:

```
/projects
/use my-project
ask the agent something here
```

## 9. (Optional) run as a service

The gateway is just a single binary. The simplest way to run it in the background is whatever your OS prefers — `launchd` on macOS, `systemd --user` on linux. A minimal systemd unit:

```ini
# ~/.config/systemd/user/im-gateway.service
[Unit]
Description=vetta IM gateway
After=network-online.target

[Service]
ExecStart=%h/go/bin/im-gateway start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now im-gateway
```

Logs go to wherever `logging.file` is configured (or `journalctl --user -u im-gateway` if you leave it on stderr).
