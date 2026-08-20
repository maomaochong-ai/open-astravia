# Signal Setup

Signal has no official bot API. `im-gateway` talks to a **`signal-cli` daemon** that you run yourself; the daemon owns the Signal credentials and exposes HTTP JSON-RPC plus an SSE event stream.

## 1. Install signal-cli

See <https://github.com/AsamK/signal-cli> for platform packages. On macOS:

```sh
brew install signal-cli
```

## 2. Register or link an account

**Option A — link to your existing phone (recommended).** The gateway then sends as you:

```sh
signal-cli link -n "Vetta"
```

This prints a `sgnl://linkdevice?...` URI; render it as a QR code and scan it from Signal on your phone under **Settings → Linked devices**.

**Option B — register a dedicated number.** Requires a phone number that can receive SMS, plus a captcha token from <https://signalcaptchas.org/registration/generate.html>:

```sh
signal-cli -a +15551234567 register --captcha "signalcaptcha://..."
signal-cli -a +15551234567 verify 123456
```

## 3. Run the daemon

```sh
signal-cli -a +15551234567 daemon --http 127.0.0.1:8080
```

Keep this running (a launchd/systemd unit is recommended). The gateway connects to it over loopback; do not expose the port publicly — anyone who can reach it can send as your account.

## 4. Configure the gateway

In the desktop app: **Settings → Claw → Signal**, enter the daemon endpoint and your account number, then activate the channel.

For standalone use:

```yaml
transport:
  name: signal
  signal:
    endpoint: http://127.0.0.1:8080
    account: "+15551234567" # the number the daemon serves
    allowedNumbers: [] # empty = every sender
    attachmentsDir: "" # signal-cli's attachment cache; set it to receive inbound media
```

No credentials entry is needed — the daemon holds them.

To receive inbound attachments, point `attachmentsDir` at signal-cli's cache (typically `~/.local/share/signal-cli/attachments`, or `~/Library/Application Support/signal-cli/attachments` on macOS).

## 5. Verify

Message your Signal account from another device. A 👀 reaction should appear while the agent works.

## Supported interactions

| Capability | Support |
| --- | --- |
| Streaming replies | No — signal-cli has no message-edit RPC; replies arrive as complete messages |
| Buttons | No — rendered as a numbered text list; answer with the number or value |
| Reactions | Yes — turn status (👀 / ✅ / ❌) |
| Quote replies | Yes — the turn's first message quotes the trigger |
| Typing indicator | Yes |
| Attachments | Both directions (inbound requires `attachmentsDir`) |
| Message deletion | Yes — remote delete |

Group chats use a `group:<base64 id>` chat ID. Quoting inside groups is best-effort: signal-cli needs the original author, which the gateway cannot always recover, so the quote is omitted rather than sent wrong.

## Troubleshooting

- **`connection refused`**: the daemon is not running, or is bound to a different address than `endpoint`.
- **Nothing arrives**: confirm the daemon was started with `--http` (not just `daemon`), and that `account` matches the registered number exactly, in E.164 form.
- **Attachments never appear**: `attachmentsDir` is unset or points at the wrong cache directory.
