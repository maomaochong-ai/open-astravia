# Vetta Actions

Vetta 官方 App Action 插件。当前已迁移 Desktop 全部 App Action 域：

- 首批：`general`、`agent`、`downloads`、`updater`、`webhook`
- 第二批：`skills`（产品文案：能力）、`shortcuts`、`im`、`mcp`、`models`、`projects`、`knowledge`、`plugins`
- 第三批：`batch-tasks`、`scheduler`、`appearance`、`navigation`

均通过 `publicId` 注册稳定公共 id。Desktop 已不再提供静态领域 Action；本插件（及后续官方 Action 插件）是这些公共 id 的实现来源。

**能力（原技能）**：公共 id 仍为 `skills.*` 以保持兼容；title/summary/keywords 使用「能力」。
`skills.manage` 支持 `install-from-market`（type + slug）。

**密钥类字段**：`models.upsert-provider` 的 `apiKey`、`mcp.upsert` 的 env/headers、
`webhook` 的 `signSecret`、`im.set-feishu-config` 的 `appSecret` 等应由用户在审批弹窗手填；
Agent 调用时请省略，不要把真实密钥写进 RPC 参数。

Catalog 冲突策略：同一 action id **先注册为准**，后到者只记日志。

本插件只通过受信任的 `ctx.official` 能力读写宿主数据。写操作仍由宿主根据 `effect`
统一审批，并复用宿主已有的领域审批界面。引用实体的写操作通过 `assertReady` 在审批前
确认实体存在。远端更新、签名和灰度服务暂不在本插件内实现。
