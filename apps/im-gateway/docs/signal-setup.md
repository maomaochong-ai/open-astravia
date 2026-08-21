# Signal Setup

Signal has no official bot API. `im-gateway` speaks to **`signal-cli`**, which owns the Signal credentials. Installing signal-cli is the only manual step: the gateway finds it, links the device, and runs the daemon for you.

## 1. Install signal-cli

| Platform | Command |
| --- | --- |
| macOS | `brew install signal-cli` |
| Windows | `scoop install signal-cli` |
| Linux | Distro package, or the release archives — see <https://github.com/AsamK/signal-cli/wiki> |

The gateway looks for the executable on `PATH` first, then in the usual package-manager locations (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, scoop/WinGet shims). Installed somewhere else? Set `cliPath` (standalone) or the signal-cli path field in settings.

## 2. Link the device

**In the desktop app:** **Settings → Claw → Signal → 扫码连接**. A QR code appears; on your phone open **Signal → Settings → Linked devices → Link new device** and scan it. That is the whole setup — the account number is read back from signal-cli, and the daemon starts automatically on a loopback port.

**Standalone:** link once from the terminal, then start the gateway:

```sh
signal-cli link -n "Vetta"   # prints a sgnl://linkdevice URI; render it as a QR and scan
im-gateway start --transport signal
```

The gateway discovers the linked account itself; `transport.signal` may be omitted entirely.

## 3. Optional configuration

```yaml
transport:
  name: signal
  signal:
    # Leave endpoint empty (the default) to let the gateway run signal-cli.
    endpoint: "" # set = connect to a daemon you run yourself; then account is required
    account: "" # E.164 number; discovered from signal-cli when empty
    cliPath: "" # explicit executable, for installs outside PATH
    configDir: "" # signal-cli --config; empty = signal-cli's own default
    proxyUrl: "" # empty = HTTPS_PROXY/HTTP_PROXY, then the OS proxy settings
    allowedNumbers: [] # empty = every sender
    attachmentsDir: "" # derived from configDir when empty
```

No credentials entry is needed — signal-cli holds them.

### Running your own daemon

Set `endpoint` (and `account`) to keep the previous behaviour, where the gateway only speaks JSON-RPC and never spawns anything:

```sh
signal-cli -a +15551234567 daemon --http 127.0.0.1:8080
```

```yaml
transport:
  signal:
    endpoint: http://127.0.0.1:8080
    account: "+15551234567"
```

Do not expose that port publicly — anyone who can reach it can send as your account. The desktop app reaches this mode via **Signal 对话框 → 连接自建 signal-cli 服务**.

### Where the linked device lives

In the desktop app, managed mode points signal-cli at `~/.vetta/desktop-app/im-signal-cli/` instead of signal-cli's default directory, so unbinding in Vetta clears only Vetta's device and leaves a signal-cli install you set up yourself untouched. Standalone managed mode uses signal-cli's own default directory and never deletes anything.

## 4. Proxies

signal-cli is a JVM/GraalVM program: it ignores `HTTPS_PROXY` and the OS proxy settings that every other part of the gateway follows. On a network where Signal is only reachable through a proxy, the symptom is silent — `link` never prints its device-link URI, no QR ever appears, and after a while signal-cli exits with `Link request timed out`.

The gateway therefore passes the proxy to signal-cli explicitly as JVM system properties, resolved in this order:

1. `transport.signal.proxyUrl` (standalone) / `CLIOptions.ProxyURL`, when set
2. the process environment — `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` (the desktop app injects the proxy Electron resolved, so a system-wide proxy is covered)
3. `-Djava.net.useSystemProxies=true`, letting signal-cli read the OS proxy settings itself

No proxy at any level means a direct connection. `NO_PROXY` is translated into `-Dhttp.nonProxyHosts`, and loopback is always excluded so the gateway reaches its own daemon directly.

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
| Attachments | Both directions |
| Message deletion | Yes — remote delete |

Group chats use a `group:<base64 id>` chat ID. Quoting inside groups is best-effort: signal-cli needs the original author, which the gateway cannot always recover, so the quote is omitted rather than sent wrong.

## Troubleshooting

- **「未检测到 signal-cli」/ `signal-cli executable not found`**: install it (table above), or point `cliPath` at the executable. A launched `.app` inherits a minimal `PATH`, which is why the well-known locations are searched too.
- **Stuck at `awaiting_bind`**: no device is linked yet in the config directory being used. Run the QR flow, or check that `configDir` points where you linked.
- **`signal daemon: not ready`**: signal-cli failed to start — the error carries its last stderr lines. A JVM-based install is slow on first launch; the gateway waits up to 60s.
- **`signal daemon: exited`**: two daemons cannot share one config directory. Stop the one you started by hand, or switch to the `endpoint` mode and let the gateway use yours.
- **二维码一直不出现，最后报 `Link request timed out`**: signal-cli 连不上 Signal 服务器。先确认 `curl -x <你的代理> https://chat.signal.org` 能通，再检查代理是否已配置在系统设置或 `HTTPS_PROXY` 里。
- **Attachments never appear**: `attachmentsDir` points at the wrong cache. Managed mode derives it from `configDir`; with your own daemon set it explicitly (typically `~/.local/share/signal-cli/attachments`).
