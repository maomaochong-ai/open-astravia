# Troubleshooting

Common problems and how to fix them.

## "session file is in use by another process"

```
Project "foo" has a session that's currently open elsewhere
(pid 12345 on macbook). Close it in the desktop app, or use
/new to start a fresh session.
```

**Cause:** The `coding-agent` SessionManager enforces a single-writer rule via `<sessionFile>.lock`. The desktop app opened the same project's most-recent session before you tried to use it from IM.

**Fix:**

- Switch to the desktop app and close the project (or quit the app entirely), then retry from IM, or
- Run `/new` in IM to start a fresh session in the same project — that creates a new `.jsonl` so the desktop app's lock doesn't conflict
- If you're sure no process actually has the file open, the lockfile may be stale. The next gateway / coding-agent invocation cleans up dead-pid stale locks automatically; you usually don't need to delete the `.lock` file by hand.

## "no project selected. Use /projects then /use <name>"

You sent a plain message before picking a project. Type `/projects` to see what's available, then `/use <name>`. Project names are read from `~/.vetta/desktop-config.json`, the same list the desktop app shows in its sidebar.

If `/projects` returns empty: add at least one project in the desktop app first.

## Feishu connection won't establish

Run with `--log-level debug` (set `logging.level: debug` in config.yaml) and look for the SDK's connect log line.

Common causes:

- **App ID / Secret typo.** Verify by visiting the Feishu open platform and copy-pasting both fields. Watch for trailing whitespace.
- **Bot capability not enabled.** See [feishu-setup.md](feishu-setup.md) step 2.
- **App version not released.** Self-built apps must be released; the create-version button isn't enough.
- **Permission scopes missing.** The bot needs `im:message` plus the p2p/send-as-bot scopes.
- **Network egress blocked.** The SDK uses outbound TLS to `*.feishu.cn` (or `*.larksuite.com` if you set `transport.feishu.baseUrl`). Corporate firewalls sometimes block these.

## "coding-agent: not found" or `OpenSession` fails immediately

The gateway spawns `coding-agent` (the binary published by `packages/coding-agent`, installed as `vetta`) as a subprocess. If the binary isn't on `$PATH`:

```yaml
hostClient:
  codingAgentBin: /full/path/to/your/vetta-binary
```

You can also set `IM_GATEWAY_CODING_AGENT_BIN=/path/to/vetta` in the environment.

## Pool full / "all sessions in flight"

The default `hostClient.poolMaxSize` is 8. If 8 conversations are simultaneously waiting on the agent, the next one gets:

```
error: acquire session: hostclient: pool full and no idle session to evict: all sessions in flight
```

This is rare in personal mode (you can only really chat with the bot from one IM client at a time). If you legitimately need more, raise the pool size:

```yaml
hostClient:
  poolMaxSize: 16
```

Each pool slot is a coding-agent subprocess, so memory usage scales linearly. 16 is reasonable for an enterprise-style deployment; for personal use 4–8 is plenty.

## Garbled replies / unicode bugs

The bridge passes raw text from the agent through to Feishu without rewriting it. If you see mojibake:

- Check your terminal locale when running `coding-agent` directly — same bug, same fix
- Make sure your Feishu client and app version both support whatever Unicode range you need (very old Feishu Lite clients have rendering issues with some emoji)

## State file got corrupted

```
im-gateway start: load state: parse state ~/.vetta/im-gateway/state.json: ...
```

The state file is the routing table — a flat `(im_user, project) → sessionPath` map. It is written atomically (write-temp + fsync + rename), so a crash mid-write should never produce a corrupt file. If you somehow have one, deleting it is safe; you'll just need to `/use <project>` again on your next message.

```bash
rm ~/.vetta/im-gateway/state.json
```

## Logs

```bash
im-gateway logs       # print everything once
im-gateway logs -f    # follow (tail -f equivalent)
```

If `logging.file` is empty in your config, the gateway only logs to stderr — there's no file to print. Set `logging.file` first.

## Gateway running but no replies

```bash
im-gateway status
```

Should print `running (pid N)`. If it does and you still see no replies in IM:

1. Check the gateway logs for a stack trace or error
2. Verify your bot is in the chat you're talking from (Feishu sometimes silently removes bots from chats after long inactivity)
3. Send `/help` — if the bot doesn't even reply to `/help` then the issue is at the transport layer (Feishu connection or permission scopes), not the agent layer
