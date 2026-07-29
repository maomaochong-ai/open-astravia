# Payload reference

The JSON passed to `publish.mjs --input`.

## Top level

| Field | Required for | Notes |
| --- | --- | --- |
| `type` | all | `skill` / `scene` / `mcp` / `plugin` / `bundle` |
| `detail` | all | Everything shown in the marketplace. See below. |
| `package_path` | `skill`, `scene`, `plugin` | Absolute path to the local archive. `plugin` must be `.zip`; `skill`/`scene` accept `.zip` or `.tar.gz`. |
| `slug` | `mcp`, `bundle` | Machine identifier, unique per type. Letters, digits, `.` `_` `-` only. For packaged types the slug comes from the manifest (`plugin.json` `id`, `SKILL.md` `name`) — passing one is ignored. |
| `mcp_config` | `mcp` | The config block written verbatim into the user's `mcp.json`, e.g. `{command, args}` or `{type: "http", url}`. |
| `members` | `bundle` | Member list, always one level — a bundle cannot nest a bundle. Members must already be published. |
| `category` | no | Managed category name (设计/开发/写作…). Unmatched values fall back to uncategorised. |
| `version` | no | Letters, digits, `.` `_` `-` only. `plugin` always takes the version from `plugin.json`. Omitted → `1.0.0` for a new entry, patch+1 on re-submission. |

## `detail`

The single source of truth for everything the marketplace displays — the server keeps no separate
columns for display fields.

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Card and detail-page title |
| `description` | yes | One sentence, shown on the card |
| `author` | yes | Attribution |
| `content` | yes | Detail-page body, markdown |
| `license` | no | e.g. `MIT` |
| `icon` | no | Empty, `solar:<name>-bold` (Iconify Solar), or an `http(s)://` URL. **Nothing else validates.** |
| `tags` | no | Free-form; orthogonal to `category` |
| `showcases` | no | Structured hero panels, see below |
| `meta` | no | Ordered list of `{key?, label?, value}`; `key` must be `homepage`/`repository`/`docs`/`license`, otherwise use `label` |
| `i18n` | no | `{ "<locale>": { …same fields… } }` |

## Showcases

Each entry needs `template`, `user_prompt`, and `assistant_reply`.

`template` is either `chat-over-canvas` (the ability produces an artifact — also pass `canvas` as
`design`/`code`/`docs`/`generic`) or `chat-thread` (conversation only; `canvas` is rejected here).

Optional: `brand_icon_url` (must be `http(s)://`), `brand_name`.

Write prompts that show a real use of the ability, not placeholders.

## Multi-language

Put the default language at the top level of `detail` and other languages under `detail.i18n`.
A locale that omits a field falls back to the top level, so translate only what differs.

**For plugins, do not hand-write `i18n` for text that already lives in the package.** If
`plugin.json` uses `%key%` placeholders for `name`/`description` and ships `locales/*.json`, the
server expands every locale automatically at upload time. Only add `detail.i18n` for marketplace
copy that is not in the package — typically `content`, `showcases`, and `meta`.

## Example

A plugin whose package already carries its own translations:

```json
{
  "type": "plugin",
  "package_path": "/Users/me/build/lottie-studio.zip",
  "category": "设计",
  "detail": {
    "name": "Lottie Studio",
    "description": "用 AI 生成并预览 Lottie 动画",
    "author": "Vetta Labs",
    "license": "MIT",
    "icon": "solar:magic-stick-3-bold",
    "tags": ["设计", "动画"],
    "content": "# Lottie Studio\n\n生成、预览并微调 Lottie 动画。\n\n## 使用\n\n描述你想要的动画，插件会生成 Lottie JSON 并实时预览。\n\n## 需要\n\n一个可用的模型服务商。",
    "meta": [
      { "key": "repository", "value": "https://github.com/example/lottie-studio" },
      { "key": "license", "value": "MIT" }
    ],
    "showcases": [
      {
        "template": "chat-over-canvas",
        "canvas": "design",
        "user_prompt": "做一个加载中的圆环动画",
        "assistant_reply": "已生成一个 2 秒循环的圆环加载动画，可在右侧预览并调整配色。"
      }
    ],
    "i18n": {
      "en": {
        "content": "# Lottie Studio\n\nGenerate, preview and fine-tune Lottie animations.\n\n## Usage\n\nDescribe the animation you want.\n\n## Requirements\n\nA configured model provider."
      }
    }
  }
}
```

`name` and `description` are not repeated under `i18n.en` because `plugin.json` already declares
them as `%key%` placeholders backed by `locales/en.json`.
