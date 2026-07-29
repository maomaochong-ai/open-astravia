# GitHub 开源能力市场格式

Desktop 从 GitHub 下载完整仓库归档，并在本地读取 `.vetta/marketplace.json`。GitHub 不承担搜索、筛选或分页；这些操作全部基于客户端已校验的本地快照完成。

## Manifest

```json
{
  "schemaVersion": 1,
  "name": "example-abilities",
  "displayName": "Example Abilities",
  "marketplaceVersion": "2026.08.1",
  "repository": "https://github.com/example/abilities",
  "minAppVersion": "0.5.11",
  "abilities": []
}
```

版本字段职责不同：

- `schemaVersion`：JSON 结构版本。当前只支持 `1`。
- `marketplaceVersion`：仓库内容发布版本；同一版本的归档内容不得变化。
- `minAppVersion`：必填，能够读取该内容的最低 Desktop SemVer 版本。
- `abilities[].version`：单个能力的产物版本。
- `abilities[].configVersion`：仅表示单个能力本地配置的结构版本，不用于选择客户端兼容性。

## Plugin、MCP 与 Bundle

Plugin 的 `source.path` 指向一个可直接安装的插件目录。目录至少包含 `plugin.json` 以及清单声明的已构建入口文件。客户端同步时校验 `plugin.json` 的 `id`、`version`、入口、样式路径，并从清单派生权限和命令展示信息；安装时复用 Desktop Plugin Store，默认保持禁用且不授予权限。

```json
{
  "type": "plugin",
  "slug": "demo-plugin",
  "name": "Demo Plugin",
  "version": "1.0.0",
  "source": { "path": "abilities/plugins/demo-plugin" }
}
```

MCP 没有可执行安装产物，但必须有独立包目录。`marketplace.json` 只通过 `source.path` 指向目录，运行配置放在目录内的 `mcp.json`。客户端同步时读取并校验该文件，再在用户安装时把 `server` 写入 `~/.vetta/agent/mcp.json` 的 `mcpServers[slug]`。索引内联 `config.mcp` 会被拒绝，避免索引与包文件形成两个真相源。

```json
{
  "type": "mcp",
  "slug": "context7",
  "name": "Context7",
  "version": "1.0.0",
  "configVersion": 1,
  "source": { "path": "abilities/mcp/context7" }
}
```

对应的 `abilities/mcp/context7/mcp.json`：

```json
{
  "schemaVersion": 1,
  "slug": "context7",
  "version": "1.0.0",
  "server": {
    "type": "http",
    "url": "https://mcp.context7.com/mcp"
  },
  "parameters": [
    {
      "key": "CONTEXT7_API_KEY",
      "label": "Context7 API Key",
      "required": false,
      "secret": true,
      "helpUrl": "https://context7.com/dashboard"
    }
  ]
}
```

`server` 接受 Desktop 原生 MCP 配置格式：

- stdio：`command`、`args`、`env`、`cwd`。
- HTTP：`type: "http"`、`url`、`headers`、OAuth 公共参数。
- 固定安装参数直接放在 `args`、`env` 或 `headers`。
- 需要用户填写的值放在顶层 `parameters`。安装时客户端复用 MCP 参数弹窗收集；stdio 写入 `env[key]`，HTTP 写入 `headers[key]`。
- `required` 控制是否必填，`secret` 控制密码输入，`placeholder`、`helpUrl` 提供填写指引，`valueTemplate` 可声明 `Bearer {value}` 这类存储格式。
- 也可以在配置中使用 `${ENV_NAME}` 占位，运行时从环境变量解析。仓库不得提交真实 token、密钥或用户凭证。

例如带启动参数和私有环境变量的 stdio MCP：

```json
{
  "schemaVersion": 1,
  "slug": "demo-mcp",
  "version": "1.0.0",
  "server": {
    "command": "npx",
    "args": ["-y", "@example/demo-mcp", "--stdio"],
    "env": {
      "DEMO_API_KEY": "${DEMO_API_KEY}"
    }
  }
}
```

Bundle 没有独立安装产物，只声明同一 Manifest 中的成员。成员支持 `skill`、`scene`、`mcp` 和 `plugin`，不允许嵌套 Bundle。安装和卸载时均由用户在确认弹窗中选择成员，不强制一次处理全部成员。Bundle 可以提供可选的 `source.path`，但该目录只能承载下述展示文件。

```json
{
  "type": "bundle",
  "slug": "starter-bundle",
  "name": "Starter Bundle",
  "version": "1.0.0",
  "config": {
    "members": [
      { "type": "skill", "slug": "hello-vetta" },
      { "type": "mcp", "slug": "context7" },
      { "type": "plugin", "slug": "demo-plugin" }
    ]
  }
}
```

## 能力自带图标与详情

`marketplace.json` 负责列表检索所需的轻量元信息；图标、长详情和展示图片可以与能力包放在同一 `source.path` 下：

```text
abilities/mcp/context7/
├── mcp.json
├── ability.json
├── README.md
├── detail.json
└── assets/
    ├── icon.svg
    └── preview.webp
```

`ability.json` 是展示入口，身份字段必须与 `marketplace.json` 中的能力完全一致：

```json
{
  "schemaVersion": 1,
  "type": "mcp",
  "slug": "context7",
  "version": "1.0.0",
  "icon": "assets/icon.svg",
  "detail": {
    "format": "blocks",
    "path": "detail.json",
    "fallback": "README.md",
    "meta": [
      { "key": "docs", "value": "https://context7.com/docs" }
    ],
    "i18n": {
      "zh-CN": { "format": "markdown", "path": "README.zh-CN.md" }
    }
  }
}
```

- `icon` 支持能力目录内的相对图片、`https://` 图片和已有的 `solar:` 图标；本地图片优先，离线可用且随市场版本缓存。
- `detail.format: "markdown"` 时，`path` 直接指向 Markdown 文件。
- `detail.format: "blocks"` 时，`path` 指向结构化详情 JSON；解析失败且声明了 `fallback` 时回退到 Markdown。
- `i18n[locale]` 可以覆盖格式和文件路径；未命中语言时使用顶层详情。
- 所有相对路径都必须留在当前能力目录内。客户端限制描述文件、详情文件和图片大小，并拒绝非图片资源。

结构化详情由客户端白名单组件渲染，不执行仓库提供的 HTML、JavaScript、CSS、iframe 或自定义操作。当前区块包括 `feature-grid`、`steps`、`showcase`、`image`、`callout`、`markdown` 和 `links`：

```json
{
  "schemaVersion": 1,
  "blocks": [
    {
      "type": "feature-grid",
      "title": "Capabilities",
      "items": [
        { "title": "Current docs", "description": "Fetch version-specific documentation." },
        { "title": "Code examples", "description": "Add relevant examples to the context." }
      ]
    },
    { "type": "image", "src": "assets/preview.webp", "alt": "Context7 preview" },
    { "type": "markdown", "content": "## Usage\nSelect the MCP and finish its setup." },
    {
      "type": "links",
      "items": [{ "label": "Documentation", "href": "https://context7.com/docs" }]
    }
  ]
}
```

安装、权限、MCP 参数和 Bundle 成员选择仍由客户端固定区域渲染，详情文件不能覆盖这些安全相关交互。

## 兼容规则

- 新增字段应优先设计为可选字段，不改变已有字段含义。
- 客户端版本低于 `minAppVersion` 时不会激活新快照；存在旧的兼容快照时继续使用旧快照。
- 开发期不兼容缺少 `minAppVersion` 或使用旧字段名的 Manifest；直接修改仓库中的 `.vetta/marketplace.json`。
- 当前不使用 `marketplace-index.json`。只有同一仓库确实需要并存互不兼容的 Schema 时才重新评估。

## 发布规则

1. 修改能力内容或 Manifest 后必须生成新的 `marketplaceVersion`。
2. 每个 Manifest 都必须设置对应的 `minAppVersion`。
3. 不从 GitHub 仓库执行 JavaScript 或其它迁移脚本。
4. 发布前必须校验 Manifest、能力目录、能力版本和来源路径。

## 本地缓存身份

客户端将 `sourceId`、`repository`、`ref` 和 `archiveUrl` 共同作为市场来源身份。每一种来源配置都使用独立的指纹缓存目录；修改仓库、分支或归档地址后，不会继续读取旧配置的缓存。

同一来源身份下，`marketplaceVersion` 对应的内容仍然不可变。来源身份发生变化时，即使新来源暂时使用相同的 `marketplaceVersion`，也允许下载并建立新的缓存快照。

能力页打开时优先立即返回本地快照，并在后台读取 GitHub 上的 `.vetta/marketplace.json`。只有远端 `marketplaceVersion` 变化时才下载完整仓库归档；更新成功不发送通知，已打开的能力页只静默重读本地快照，未打开时则在下次进入时读取。后台检查失败时继续使用已有快照，不向用户产生干扰；用户主动点击刷新仍会立即执行完整同步并返回结果。

## 内置来源配置

内置 GitHub 来源不在代码中设置仓库地址，完全由环境变量提供：

- `VETTA_OPEN_MARKETPLACE_REPOSITORY`：GitHub 仓库 URL；未设置时不创建内置来源。
- `VETTA_OPEN_MARKETPLACE_REF`：分支或 ref，默认 `main`。
- `VETTA_OPEN_MARKETPLACE_ARCHIVE_URL`：可选归档地址；未设置时根据仓库与 ref 推导。
