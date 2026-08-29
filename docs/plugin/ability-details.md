# 能力详情页（ability.json）

`ability.json` 是插件在 Desktop「能力」页里的**可选展示描述**。它不参与插件加载，也不授予权限：

- `plugin.json` 决定插件身份、入口、权限、命令和 Agent 贡献；
- `ability.json` 只决定能力详情中的介绍内容；
- 安装、启停、权限、命令、版本和贡献项仍由宿主固定渲染，详情文件不能覆盖这些交互。

没有 `ability.json` 的插件仍能正常安装和运行。能力页会显示 `plugin.json` 提供的名称、简介、图标、作者，
以及宿主自动生成的权限和贡献信息，但不会出现 showcase、功能网格或长篇说明。

## 推荐目录

```text
my-plugin/
├── plugin.json
├── ability.json
├── presentation/
│   ├── README.md
│   ├── README.en.md
│   └── preview.webp
├── src/
└── dist/
```

`@vetta-org/plugin-vite` 发现根目录的 `ability.json` 后，会把它和整个 `presentation/` 目录打进插件 zip。
因此，插件的 Markdown 与图片展示资源应放在 `presentation/` 下。

## 最小详情

身份字段必须和 `plugin.json` 保持一致：`slug = plugin.json.id`，`version = plugin.json.version`。

```json
{
  "schemaVersion": 1,
  "type": "plugin",
  "slug": "my-plugin",
  "version": "0.1.0",
  "detail": {
    "blocks": [
      {
        "type": "markdown",
        "path": "presentation/README.md"
      }
    ]
  }
}
```

Markdown 区块可以二选一：

```json
{ "type": "markdown", "content": "## 使用方法\n\n直接写短内容。" }
```

```json
{ "type": "markdown", "path": "presentation/README.md" }
```

`content` 与 `path` 必须且只能提供一个。长正文优先使用 `path`，避免在 JSON 字符串里手工转义换行、引号和代码块。
路径相对插件根目录解析，不能是绝对路径，也不能用 `..` 越出插件目录。

## 推荐的丰富详情

```json
{
  "schemaVersion": 1,
  "type": "plugin",
  "slug": "my-plugin",
  "version": "0.1.0",
  "detail": {
    "blocks": [
      {
        "type": "showcase",
        "showcase": {
          "template": "workbench",
          "canvas": "code",
          "user_prompt": "检查这个页面在手机上的效果。",
          "assistant_reply": "我会打开预览并检查响应式布局。"
        }
      },
      {
        "type": "feature-grid",
        "title": "主要能力",
        "items": [
          {
            "title": "实时预览",
            "description": "在工作区中直接查看页面。",
            "icon": "solar:monitor-smartphone-linear"
          },
          {
            "title": "继续交给 Agent",
            "description": "把检查结果带回当前任务继续修改。",
            "icon": "solar:magic-stick-3-linear"
          }
        ]
      },
      {
        "type": "markdown",
        "path": "presentation/README.md"
      },
      {
        "type": "links",
        "title": "相关资源",
        "items": [
          { "label": "使用文档", "href": "https://example.com/docs" }
        ]
      }
    ],
    "meta": [
      { "key": "homepage", "value": "https://example.com" },
      { "key": "repository", "value": "https://github.com/example/my-plugin" }
    ]
  }
}
```

## 区块参考

区块按数组顺序渲染。宿主只接受下列白名单类型，不执行包内 HTML、JavaScript、CSS、iframe 或自定义操作。
如果需要兼容尚未支持新区块的旧版客户端，请在整页 `format: "blocks"` 声明中提供 `fallback` Markdown；旧版校验失败时会回退到该文件。

### hero

封面承诺，适合详情页开头。它只描述一句主张、徽章和可选配图；宿主把它画成带侧线的引言，而不是能力清单或右侧 Logo 栏。

```json
{
  "type": "hero",
  "eyebrow": "REAL BROWSER AUTOMATION",
  "title": "让 Agent 在你看得见的浏览器里工作",
  "description": "复用登录态，完成多步骤网页任务；提交前始终确认。",
  "image": "presentation/logo.svg",
  "image_alt": "Browser 插件标志",
  "layout": "split",
  "badges": ["可见窗口", "会话隔离"]
}
```

`layout` 可选 `stacked`（默认：主张在上、配图在下）或 `split`（有配图时文案与图片左右分栏）。没有 `image` 时不会留下空栏。配图应是场景静帧，不要再放一遍插件图标。

### stats

用少量数字或短词概括适用范围、规模和关键约束。宿主使用自适应网格，不需要填写列数。

```json
{
  "type": "stats",
  "title": "适合哪些任务",
  "items": [
    { "value": "真实", "label": "页面环境", "description": "不是静态 HTML" },
    { "value": "多步", "label": "任务流程" },
    { "value": "可控", "label": "关键动作", "description": "提交前人工确认" }
  ]
}
```

最多 6 项。`value` 和 `label` 必填，`description` 可省略。

### gallery

展示多张界面截图或流程图。图片可以是插件包内的 `presentation/**` 文件，也可以是 HTTPS 地址；不接受 HTML、iframe 或脚本。

```json
{
  "type": "gallery",
  "title": "工作流预览",
  "items": [
    {
      "src": "presentation/step-1.webp",
      "alt": "打开网站并等待登录",
      "caption": "1. 在可见窗口中完成登录"
    },
    {
      "src": "presentation/step-2.webp",
      "alt": "读取页面快照",
      "caption": "2. Agent 根据页面结构定位内容"
    }
  ]
}
```

图片按自适应网格排列，最多 8 张；`alt` 和 `caption` 可省略，但建议为截图提供有意义的 `alt`。

### comparison

解释两种方式、适用边界或「之前 / 之后」。两侧文案逐条对照阅读，不是两份互不相干的清单。`tone` 选择中性或强调样式。

```json
{
  "type": "comparison",
  "title": "从查资料到完成任务",
  "left": {
    "title": "只做网页搜索",
    "items": ["返回搜索结果", "遇到登录态就中断"]
  },
  "right": {
    "title": "使用 Browser",
    "tone": "accent",
    "items": ["打开真实网站", "提交前交还人工确认"]
  }
}
```

`tone` 可选 `neutral` 或 `accent`；默认左列为 `neutral`、右列为 `accent`。每列最多 8 条。

### feature-grid

能力清单：并列主张，不是先后步骤。宿主按短条目自动并排，不需要填写列数。`items` 至少一项，图标可省略；图标支持 `solar:` 或包内/HTTPS 图片。

```json
{
  "type": "feature-grid",
  "title": "主要能力",
  "items": [
    { "title": "读取页面", "description": "提取页面结构与文字。", "icon": "solar:document-text-linear" }
  ]
}
```

### steps

有先后顺序的流程。宿主画成带序号和连线的步骤轨，文案一次全部可见。

```json
{
  "type": "steps",
  "title": "开始使用",
  "items": [
    { "title": "安装插件" },
    { "title": "授予权限", "description": "只开启任务实际需要的权限。" }
  ]
}
```

### showcase

宿主生成的场景头图，不是真实截图，也不能由插件注入 CSS。插件只选择 `template`、`canvas` 和文案；
窗体外形、舞台和对话样式全部由 Desktop 绘制。

`template` 决定构图，不只是「一问一答」：

| template | 构图 |
| --- | --- |
| `canvas-hero` | 大号产品窗口 + 一句说明；提示词收成角标 |
| `prompt-result` | 左侧提示词卡片，右侧变成产物窗口 |
| `spotlight` | 居中命令面板：检索条 + 高亮结果 |
| `workbench` | 迷你工作台：活动栏 + 窗口 + 助手批注 |
| `chat-over-canvas` | 产品窗口为主角，对话作为附注 |
| `chat-thread` | 完整会话窗口（顶栏、消息、输入条） |

需要产品窗口的模板再选 `canvas`。每种 canvas 是可辨认的窗体外形，不是同一外壳里换几根色条：

| canvas | 窗体 |
| --- | --- |
| `design` | 点状画板 + 带控制点的 Frame |
| `code` | 编辑器：文件页签、行号、状态栏 |
| `docs` | 纸页文档 + 清单 |
| `browser` | 浏览器：标签、地址栏、页面列表 |
| `terminal` | 深色终端与提示符 |
| `board` | 三列看板 |
| `generic` | 指标卡 + 趋势图的仪表盘 |

```json
{
  "type": "showcase",
  "showcase": {
    "template": "canvas-hero",
    "canvas": "browser",
    "brand_name": "Orders",
    "user_prompt": "打开后台订单页。",
    "assistant_reply": "我会在真实浏览器里读取页面，提交前先停下来确认。"
  }
}
```

`user_prompt` 与 `assistant_reply` 在非对话模板里也会用到：分别作为提示词/检索条和结果说明。
可选 `brand_name`、`brand_icon_url` 会出现在窗体标题或页签上。

### image

展示真实图片。包内资源建议放进 `presentation/`；也可使用 HTTPS 图片。

```json
{
  "type": "image",
  "src": "presentation/preview.webp",
  "alt": "插件界面预览",
  "caption": "工作区主界面"
}
```

### callout

提示块；`tone` 支持 `info`、`success`、`warning`。

```json
{
  "type": "callout",
  "tone": "info",
  "title": "首次使用",
  "content": "启用前需要完成本地运行时安装。"
}
```

### markdown

Markdown 正文，支持内联 `content` 或包内文件 `path`。代码块由宿主统一高亮。

```json
{ "type": "markdown", "path": "presentation/README.md" }
```

### links

HTTP(S) 外链按钮。

```json
{
  "type": "links",
  "title": "继续阅读",
  "items": [{ "label": "文档", "href": "https://example.com/docs" }]
}
```

## 整页引用文件

如果详情只有 Markdown，不需要 `blocks`：

```json
{
  "schemaVersion": 1,
  "type": "plugin",
  "slug": "my-plugin",
  "version": "0.1.0",
  "detail": {
    "format": "markdown",
    "path": "presentation/README.md"
  }
}
```

也可以把全部结构化区块放进独立 JSON：

```json
{
  "detail": {
    "format": "blocks",
    "path": "presentation/detail.json",
    "fallback": "presentation/README.md"
  }
}
```

此时 `presentation/detail.json` 的格式为：

```json
{
  "schemaVersion": 1,
  "blocks": [
    { "type": "markdown", "path": "presentation/README.md" }
  ]
}
```

`fallback` 只在结构化详情文件无法读取或校验失败时生效。

## 多语言

详情页的 `i18n` 与 `plugin.json` 的 `%catalogKey%`/`locales/*.json` 是两套合同。详情文件不解析
`%catalogKey%`；应在 `ability.json#detail.i18n` 中提供本地化内容或文件路径。

```json
{
  "detail": {
    "blocks": [
      { "type": "markdown", "path": "presentation/README.md" }
    ],
    "i18n": {
      "en": {
        "blocks": [
          { "type": "markdown", "path": "presentation/README.en.md" }
        ]
      }
    }
  }
}
```

本地化字段采用**整体覆盖**：一旦 `i18n.en.blocks` 存在，它会替换默认的整个 `blocks` 数组，不做逐项合并。
因此，多语言丰富详情需要在每个 locale 中给出完整区块序列。

## 元信息

`detail.meta` 是有序数组。预置 `key` 支持 `homepage`、`repository`、`docs`、`license`；也可使用
`label` 创建自定义文本项。以 `http://` 或 `https://` 开头的值会渲染成链接。

```json
{
  "meta": [
    { "key": "docs", "value": "https://example.com/docs" },
    { "label": "维护团队", "value": "Example Team" }
  ]
}
```

## 安全与大小限制

- `ability.json` 最大 64 KiB；
- 单个 Markdown/结构化详情文件最大 512 KiB；
- 单张本地图片最大 8 MiB；
- 包内引用必须留在插件根目录；
- 图片只接受 AVIF、GIF、ICO、JPEG、JPG、PNG、SVG、WebP；
- 外部图片只接受 HTTPS；链接按钮接受 HTTP(S)；
- 详情损坏不会阻断插件或能力页启动，宿主会忽略该插件的自定义介绍并记录诊断日志。

## 发布前检查

- `ability.json` 的 `slug`、`version` 与 `plugin.json` 完全一致；
- 长 Markdown 使用 `path`，文件位于 `presentation/`；
- `i18n` 中的 `blocks` 是完整数组；
- 图片路径大小写与归档中的真实文件一致；
- `bunx vite build` 生成的 zip 包含 `ability.json` 和 `presentation/**`；
- 安装后在「能力 → 我的」打开插件详情，核对宿主自动生成的权限和贡献项是否符合预期。
