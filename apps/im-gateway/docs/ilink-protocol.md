# iLink Protocol — Reverse-Engineered Reference

> Source: extracted verbatim from `@tencent-weixin/openclaw-weixin@2.1.7`
> (npm package, full TypeScript source, no obfuscation).
> This is the protocol the official Tencent ClawBot plugin speaks to the
> WeChat iLink servers. We are reimplementing a client of it in Go for
> `internal/transport/wechat/`, **without** depending on OpenClaw.

## 1. Endpoints

All endpoints are JSON over HTTPS. Two base hosts:

| Phase | Host | Notes |
|---|---|---|
| QR scan / login | `https://ilinkai.weixin.qq.com` | Hardcoded in `auth/login-qr.ts` (`FIXED_BASE_URL`) |
| Messaging (after login) | Returned in `confirmed` callback as `baseurl` | May change per IDC; honor `scaned_but_redirect.redirect_host` during login |

### 1.1 `GET ilink/bot/get_bot_qrcode?bot_type=3`

Get a QR code to display to the user.

**Query:** `bot_type=3` (constant `DEFAULT_ILINK_BOT_TYPE`)

**Response:**
```json
{
  "qrcode": "<opaque token, used as query param for status polling>",
  "qrcode_img_content": "<URL string; render this as a QR image OR display as link>"
}
```

### 1.2 `GET ilink/bot/get_qrcode_status?qrcode=<qrcode>`

Long-poll (35s client timeout) for scan progress.

**Response:**
```json
{
  "status": "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect",
  "bot_token":     "<bearer token, only on confirmed>",
  "ilink_bot_id":  "<our bot identity, only on confirmed>",
  "ilink_user_id": "<who scanned, only on confirmed>",
  "baseurl":       "<host for all subsequent message API, only on confirmed>",
  "redirect_host": "<new host for status polling, only on scaned_but_redirect>"
}
```

State machine:
- `wait` → keep polling
- `scaned` → user opened the bot in WeChat, awaiting confirmation, keep polling
- `scaned_but_redirect` → server moved us to a different IDC; switch polling host to `https://<redirect_host>` and continue polling
- `expired` → QR is dead, generate a new one (max 3 refreshes per session in reference impl)
- `confirmed` → done, capture all 4 fields above

Client-side AbortError on the 35s long-poll → treat as `wait` and retry. Network/gateway errors (e.g. Cloudflare 524) → also treat as `wait`.

### 1.3 `POST ilink/bot/getupdates`

Long-poll for inbound messages. **Default timeout 35s** (`DEFAULT_LONG_POLL_TIMEOUT_MS`).

**Body:**
```json
{
  "get_updates_buf": "<opaque cursor; empty string on first call>",
  "base_info": { "channel_version": "2.1.7" }
}
```

**Response:**
```json
{
  "ret": 0,
  "errcode": 0,
  "errmsg": "",
  "msgs": [ /* WeixinMessage[] */ ],
  "get_updates_buf": "<new cursor to send on next call>",
  "longpolling_timeout_ms": 35000
}
```

**Critical behavior:**
- AbortError on client-side timeout → return `{ret:0, msgs:[], get_updates_buf: <previous>}` and immediately retry. **Long-poll timeout is normal.**
- `errcode === -14` → session timeout, credentials are dead, must re-login.
- `get_updates_buf` MUST be persisted to disk after each successful call (the reference impl writes `~/.openclaw/openclaw-weixin/accounts/<accountId>.sync.json`). On restart, load and resume.
- Server may suggest a `longpolling_timeout_ms` for the next request.

### 1.4 `POST ilink/bot/sendmessage`

Send one message. **Single-item only** — multi-item batches (e.g. text + image) are sent as **two separate requests**, each with `item_list` of length 1.

**Body:**
```json
{
  "msg": {
    "from_user_id": "",                    // empty when sending as bot
    "to_user_id": "<peer ilink_user_id>",
    "client_id": "<our generated id, used as messageId>",
    "message_type": 2,                     // BOT
    "message_state": 2,                    // FINISH
    "item_list": [ /* exactly one MessageItem */ ],
    "context_token": "<echo from latest inbound>"
  },
  "base_info": { "channel_version": "2.1.7" }
}
```

`context_token` should be omitted (not sent) when no inbound context exists — this becomes a "proactive push" subject to the 24h/10 quota. The reference impl just logs a warning when it's missing and sends anyway.

### 1.5 `POST ilink/bot/getconfig`

Fetch bot config — primarily to get `typing_ticket` for the typing indicator.

**Body:**
```json
{
  "ilink_user_id": "<peer>",
  "context_token": "<optional>",
  "base_info": { "channel_version": "2.1.7" }
}
```

**Response:**
```json
{ "ret": 0, "errmsg": "", "typing_ticket": "<base64>" }
```

### 1.6 `POST ilink/bot/sendtyping`

Send the "对方正在输入" indicator. Lifetime is short — must re-send every 5–8s to keep it visible.

**Body:**
```json
{
  "ilink_user_id": "<peer>",
  "typing_ticket": "<from getconfig>",
  "status": 1,                  // 1=typing, 2=cancel
  "base_info": { ... }
}
```

### 1.7 `POST ilink/bot/getuploadurl` (media — out of scope for M1)

Returns a pre-signed CDN URL for uploading AES-128-ECB encrypted media. Required fields: `media_type`, `to_user_id`, `rawsize`, `rawfilemd5`, `filesize` (encrypted size), `aeskey`, plus thumbnail variants for image/video. Defer until M6.

## 2. Headers (every request)

### 2.1 Common (GET + POST)

| Header | Value |
|---|---|
| `iLink-App-Id` | `bot` (from `package.json:ilink_appid`) |
| `iLink-App-ClientVersion` | uint32 decimal: `(major<<16) | (minor<<8) | patch`. For `2.1.7` → `(2<<16)|(1<<8)|7 = 131335`. |
| `SKRouteTag` | optional, from per-account config; only set if non-empty |

### 2.2 POST-only

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Content-Length` | byte length of body |
| `AuthorizationType` | `ilink_bot_token` (literal constant) |
| `Authorization` | `Bearer <bot_token>` (only after login) |
| `X-WECHAT-UIN` | base64(decimal(random uint32)). **Generated fresh per request.** Reference impl: `Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64")` |

## 3. Message Types (`MessageItem`)

```ts
type MessageItem = {
  type: 0 | 1 | 2 | 3 | 4 | 5,   // NONE | TEXT | IMAGE | VOICE | FILE | VIDEO
  create_time_ms?: number,
  update_time_ms?: number,
  is_completed?: boolean,
  msg_id?: string,
  ref_msg?: { message_item?: MessageItem, title?: string },  // quoted reply
  text_item?:  { text: string },
  image_item?: ImageItem,
  voice_item?: { media, encode_type, sample_rate, playtime, text },
  file_item?:  { media, file_name, md5, len },
  video_item?: VideoItem,
}

type WeixinMessage = {
  seq?: number,
  message_id?: number,
  from_user_id?: string,
  to_user_id?: string,
  client_id?: string,
  create_time_ms?: number,
  ...
  message_type?: 0 | 1 | 2,        // NONE | USER | BOT
  message_state?: 0 | 1 | 2,       // NEW | GENERATING | FINISH
  item_list?: MessageItem[],
  context_token?: string,
}
```

### 3.1 Text-only inbound parsing (M1 scope)

```
for item in msg.item_list:
  if item.type == TEXT and item.text_item.text:
    if item.ref_msg:
      // formatted as: "[引用: <title> | <quoted body>]\n<text>"
    else:
      return item.text_item.text
  if item.type == VOICE and item.voice_item.text:
    return item.voice_item.text   // server-side STT
```

### 3.2 Text-only outbound (M1 scope)

```ts
{
  msg: {
    from_user_id: "",
    to_user_id: <peer>,
    client_id: <generateId("openclaw-weixin")>,  // we'll use a similar prefix
    message_type: 2,    // BOT
    message_state: 2,   // FINISH
    item_list: [{ type: 1, text_item: { text } }],
    context_token: <latest from inbound>,
  }
}
```

## 4. State to Persist

For each bound account (`ilink_bot_id`):

| File | Purpose | Lifetime |
|---|---|---|
| `wechat.json` (credentials) | `bot_token`, `ilink_bot_id`, `ilink_user_id`, `baseurl` | until server invalidates |
| `<accountId>.sync.json` | `get_updates_buf` (long-poll cursor) | rolled forward on every successful getupdates |
| `<accountId>.context-tokens.json` | per-peer `{userId: contextToken}` map | refreshed on every inbound |

For our embedded use, we collapse all of these into a single `~/.vetta/im-gateway/wechat-<accountId>.json` written atomically. Single-account is the M1 assumption; the multi-account case can be added later by keying on `ilink_bot_id`.

## 5. Long-Poll Loop (pseudocode)

```
buf := load_get_updates_buf()
loop:
  resp := POST getupdates { get_updates_buf: buf }
  if resp.errcode == -14:
    notify "credentials expired, re-login required"
    return
  for msg in resp.msgs:
    record context_token for msg.from_user_id
    deliver to handler
  buf = resp.get_updates_buf
  save_get_updates_buf(buf)            // before next call, AFTER delivery
  // immediately loop; long-poll handles waiting
```

The reference impl persists the buf inside its own gateway's account loop; we will mirror that pattern in `internal/transport/wechat/ilink/poll.go`.

## 6. Quota & Limits

The protocol itself does **not** appear to expose remaining quota in any response field surveyed. The 24h/10-message ceiling appears to be enforced server-side and surfaced only via send failures. We must:

1. Track our own counter per `peerUserId` (`internal/transport/wechat/quota.go`).
2. Treat any send failure with a known quota errcode (TBD — fill in once we hit it in real testing) as confirmation our local counter is correct.
3. Reset the per-peer window on any inbound message from that peer.

## 7. Items We Will NOT Implement in M1

| Feature | Why deferred |
|---|---|
| Image / video / file send | Requires CDN upload + AES-128-ECB encrypt; large surface area, see `src/cdn/*` |
| Image / video / voice receive | Requires CDN download + decrypt; same |
| Voice transcoding (silk → wav) | Requires `silk-wasm`; pure native Go alternative TBD |
| Typing indicator | Adds complexity (5–8s heartbeat goroutine); cosmetic |
| Streaming responses | User explicitly excluded from current scope |
| Multi-account | Single bind on M1, lift later |
| Slash commands / pairing handshake | OpenClaw-specific; we route to vetta agents directly |
| Group chat | Not supported by upstream protocol AFAICT; all msgs are 1v1 |

## 8. Risks Captured From Source

- **`X-WECHAT-UIN` randomness**: Server may use this for fingerprinting. We must replicate the `base64(decimal(random_uint32))` shape exactly.
- **`iLink-App-Id` is literally `"bot"`**: This is suspicious for a fingerprint — any third-party using a different value gets immediately flagged. We use the same value.
- **`iLink-App-ClientVersion` mirrors plugin version**: Bumping our advertised version periodically may help avoid being detected as a stale fork. We will pin to the upstream version we last verified against.
- **Error code -14 = session timeout** is the only protocol error decoded in the reference; everything else is opaque HTTP error strings. We will need to observe and document more codes as we encounter them.
- **No retry/backoff hints from server.** Reference impl has no exponential backoff on getupdates failures, just retries immediately. We will add 1s → 30s exponential backoff to be polite.

## 9. Mapping to `transport.Capabilities`

```go
transport.Capabilities{
    SupportsMessageEdit: false,   // protocol has no edit endpoint
    SupportsCards:       false,
    SupportsButtons:     false,
    SupportsFileUpload:  true,    // upstream supports it; M1 returns NotImplemented
    SupportsThreads:     false,
    MaxMessageLength:    0,       // unknown; will probe and update
}
```

## 10. References

- npm package: `@tencent-weixin/openclaw-weixin@2.1.7`
- Key source files (paths inside the package):
  - `src/api/api.ts` — HTTP layer
  - `src/api/types.ts` — protocol types
  - `src/auth/login-qr.ts` — QR + status polling
  - `src/messaging/inbound.ts` — message parsing + context_token store
  - `src/messaging/send.ts` — outbound builders
  - `src/storage/sync-buf.ts` — get_updates_buf persistence
  - `package.json:ilink_appid` — `"bot"`
