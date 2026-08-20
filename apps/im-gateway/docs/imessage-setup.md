# iMessage Setup

iMessage has no API. The transport runs **only on macOS**: it reads new messages directly from the local Messages database and sends by driving Messages.app through AppleScript. The Mac must stay signed in and awake.

## 1. Sign in to Messages

Open **Messages.app** and sign in with the Apple Account that should send and receive. Send yourself a test message to confirm it works.

## 2. Grant Full Disk Access

Reading `~/Library/Messages/chat.db` is protected by macOS privacy controls.

**System Settings → Privacy & Security → Full Disk Access** → enable it for the app running the gateway (Vetta for desktop use, or your terminal for standalone use).

Restart the app afterwards; the permission is only picked up on launch.

## 3. Grant Automation permission

The first send triggers a prompt asking to control Messages.app — allow it. If you dismissed it, re-enable under **System Settings → Privacy & Security → Automation**.

## 4. Configure the gateway

In the desktop app: **Settings → Claw → iMessage**, activate the channel. There are no credentials to enter — access is entirely governed by the two macOS permissions above.

For standalone use:

```yaml
transport:
  name: imessage
  imessage:
    dbPath: "" # default ~/Library/Messages/chat.db
    allowedHandles: [] # phone numbers (+E.164) or iCloud emails; empty = every sender
```

## 5. Verify

Send an iMessage to the signed-in account from another device. Only messages that arrive **after** the gateway starts are processed — history is never replayed.

## Supported interactions

| Capability | Support |
| --- | --- |
| Streaming replies | No — AppleScript sends complete messages only |
| Buttons | No — rendered as a numbered text list; answer with the number or value |
| Reactions / tapbacks | No — tapbacks need private APIs the transport deliberately does not use |
| Reply threading | No |
| Typing indicator | No |
| Attachments | Both directions |
| Edit / delete | No — both return an error |

## Known limitations

- **macOS only.** On other platforms the transport refuses to start.
- **Polling.** New messages are picked up on a 2-second poll of the database, so replies are not instantaneous.
- **No message IDs on send.** AppleScript is fire-and-forget, so sent messages get a synthetic `osa:<timestamp>` ID and cannot be edited or deleted afterwards.
- **Attributed text is best-effort.** Messages whose text lives only in `attributedBody` (rich text, some link previews) are decoded heuristically and may come through empty.
- **Allowlist matching is literal.** `allowedHandles` must match the handle exactly as Messages stores it — normally `+E.164` for phone numbers. Email handles are matched case-insensitively.

## Troubleshooting

- **`unable to open chat.db` / permission errors**: Full Disk Access is missing, or the app was not restarted after granting it.
- **Sending silently does nothing**: Automation permission for Messages.app was denied. Re-enable it and restart.
- **Nothing is received**: confirm Messages.app itself is receiving the messages, and that the sender passes `allowedHandles`.
