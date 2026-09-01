# 内容创作工具的渐进披露

## 调研结论

Cloudflare Code Mode 解决的核心矛盾是：能力目录越完整，模型在开始任务前被迫加载的 Tool Schema 越大。其官方资料给出两种模式：

- 小型、可管理工具集使用单一 `code` 工具，将上游工具转换为类型化方法，并在隔离执行器内组合调用。
- 大型 API 使用 `search` + `execute`；完整 OpenAPI 文档留在沙箱内，模型只取回当前任务所需的 operation 和结果投影。

Cloudflare 报告其全量 API 超过 2,500 个 endpoint，传统 MCP 工具面约需 117 万 tokens，而两工具入口约 1,000 tokens；其设计重点还包括中间结果留在执行环境、认证保留在宿主回调、生成代码默认无任意网络访问、写操作仍在真实 handler 内执行授权与审批。

主要资料：

- [Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
- [Code Mode MCP server patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)
- [Build a search and execute MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/)
- [Use MCP tools with Code Mode](https://developers.cloudflare.com/agents/tools/codemode/mcp/)

## 本仓库基线

内容创作原本只有四个领域工具，但数量掩盖了 Schema 体积：`content_creation_edit` 的 12 种 operation 与五套视频 `promptPlan` 合同序列化后约为 50,131 字符，粗略相当于 12.5k tokens。这个成本会进入每次模型调用，即使用户只想读取摘要、导入一张图或添加普通节点。

问题来自披露时机，不来自领域服务过多：

- `inspect` / `assets` / `edit` / `run` 的职责、revision 和审批边界已经清楚，不应重新合并为万能 handler。
- 视频方法 Schema 很大但确有必要，不能为了缩短上下文降低类型安全。
- 模型不需要在每轮同时知道所有 edit variant，只需要当前步骤的精确合同。

## 采用的方案

模型面固定为：

```text
content_creation_search
  -> 紧凑 operation index
  -> 按 query 或精确 ID 返回必要 Schema

content_creation_execute
  -> { operation: inspect | assets | edit | run, input }
  -> 插件边界再次按完整 Schema 校验 input
  -> 既有领域服务
```

`edit` 在目录中细分为 `edit.add_node`、`edit.connect_nodes`、`edit.configure_video_shot` 等发现项；模型把一个或多个已发现 variant 放进同一 `execute(operation="edit")` 批次，因此原子性不变。常驻两工具 JSON 面通过测试限制在 4,000 字符以内，单次 Schema 搜索结果限制在约 24,000 字符并报告被省略的 operation，完整视频合同只在搜索命中 `edit.configure_video_shot` 后返回。

同时删除 `add_node` / `update_node` 中重复的 `promptPlan` 入口。Agent 视频计划继续由 `configure_video_shot` 唯一拥有；这既减少 Schema 体积，也消除同一业务规则的并行写入路径。

## 为什么不直接执行模型生成代码

本插件没有 Cloudflare Dynamic Worker Loader 等安全隔离执行器。为四个成熟领域操作引入 JavaScript 解释器，会新增任意代码、资源限制、取消、审计和重放边界，却不会改善当前主要瓶颈。因此只采用 Cloudflare 的固定入口、渐进发现、宿主授权和结果聚焦原则，不复制其代码执行机制。

`execute` 也不会绕过安全策略：

- 素材路径仍由现有宿主文件能力和素材服务约束；
- edit 仍以 `expectedRevision` 原子提交，任一 operation 失败不产生部分变更；
- prepare 不调用供应商、不消耗额度；用户全局确认后才开始生成；
- 嵌套 input 在插件边界重新校验，不能依赖模型先前拿到的 Schema 或宿主只校验轻量 envelope。

## 后续评测

当前门禁覆盖常驻工具面字符预算、紧凑索引不携带 Schema、精确 operation 披露、视频合同按需返回、嵌套输入拒绝、revision 编辑、素材导入和生成确认。后续若宿主提供通用 deferred catalog，应复用本 operation catalog，并比较：首轮输入 tokens、搜索命中率、无效 execute 重试率、任务完成轮次和运行确认误触率。
