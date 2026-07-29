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
| `category` | no | Managed category **name**, not an id. Read the live list with `scripts/categories.mjs` — an unmatched name is not an error, it silently lands in uncategorised. Matching is case-insensitive and also accepts a category's translated name. |
| `version` | no | Letters, digits, `.` `_` `-` only. Honoured for `skill`/`scene`/`mcp`/`bundle`; **`plugin` always takes the version from `plugin.json`** and ignores this. Omitted → `1.0.0` for a new entry, patch+1 on re-submission. |

Where a package carries the same information, the payload wins and the package is the fallback:
`skill`/`scene` fall back to `SKILL.md` frontmatter (`metadata.category`, `metadata.version`,
`metadata.tags`), `plugin` to `plugin.json`. On a re-submission that specifies neither, the
existing category is kept rather than cleared.

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
| `icon` | no | Empty, one of the built-in Solar names below, or an `http(s)://` URL. See [Icons](#icons). |
| `tags` | no | Free-form; orthogonal to `category`. For `skill`/`scene` the package's own `SKILL.md` frontmatter tags apply unless you set this. |
| `showcases` | no | Structured hero panels, see below |
| `meta` | no | Ordered list of `{key?, label?, value}`; `key` must be `homepage`/`repository`/`docs`/`license`, otherwise use `label` |
| `i18n` | no | `{ "<locale>": { …same fields… } }` |

## Icons

`detail.icon` has three forms: empty (client picks a default by type), an `http(s)://` image URL,
or one of the **30 built-in Solar names** below. The host renders Solar icons from a literal
allow-list compiled into its stylesheet, so a name outside it uploads fine but displays as the
default icon. `scripts/publish.mjs` rejects unknown `solar:` names for that reason.

```
solar:star-bold            solar:magic-stick-3-bold   solar:bolt-bold
solar:fire-bold            solar:heart-bold           solar:cup-star-bold
solar:code-bold            solar:widget-2-bold        solar:layers-bold
solar:cpu-bolt-bold        solar:database-bold        solar:cloud-bold
solar:server-bold          solar:shield-bold          solar:lock-keyhole-bold
solar:key-bold             solar:chat-round-bold      solar:letter-bold
solar:document-bold        solar:folder-bold          solar:gallery-bold
solar:camera-bold          solar:videocamera-record-bold
solar:music-note-bold      solar:chart-2-bold         solar:graph-up-bold
solar:map-point-bold       solar:global-bold          solar:rocket-2-bold
solar:lightbulb-bolt-bold
```

## Showcases

Each entry needs `template`, `user_prompt`, and `assistant_reply`. These are the detail page's
hero panels — the host draws them, you supply the text.

`template`:

- `chat-over-canvas` — a mock product window beside the conversation. Also pass `canvas`.
- `chat-thread` — conversation only. `canvas` is rejected here.

`canvas` picks **which mock window is drawn**. It is not a screenshot and you cannot supply one:
each value is a fixed CSS composition, sized small (roughly a third of the panel) next to the
chat bubbles. Pick whichever resembles what the ability produces:

| Value | Drawn as |
| --- | --- |
| `design` | Hero block, swatch row, control bar — design-tool look |
| `code` | Gutter plus syntax-coloured code lines with one highlighted row |
| `docs` | Heading, paragraph lines, and a callout card |
| `generic` | Area chart plus two stat tiles — dashboard look |

Optional: `brand_icon_url` (must be `http(s)://`), `brand_name`.

Write prompts that show a real use of the ability, not placeholders.

## Shipping `detail` inside the package

`vetta.json` at the package root (next to `SKILL.md` / `plugin.json`) holds exactly the same
object as `detail`. It is the second delivery route for the same data: **the `detail` field wins,
the file is the fallback**, and it is read only when the payload omits `detail` entirely — there
is no per-field merge between the two.

Use it when the package is the thing being maintained (the description then travels with the
code and stays right on every re-submission). Use the payload field for one-off submissions or
for marketplace copy you do not want in the package. A malformed `vetta.json` fails the upload
rather than being skipped.

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
