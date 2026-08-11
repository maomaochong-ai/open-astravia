# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-telemetry`、`runtime-tools`、`cli-app`

## 职责范围

存储实现包，拥有独立的 Conversation Repository 和旧会话格式只读迁移边界。

## 注意事项

- `src/conversation/` 必须真正拥有新 Kernel 的会话持久化实现，不得导入 `@vetta/coding-agent`
- 包根只转发原生 Conversation 能力，不得恢复认证、设置或旧 Session Manager 兼容导出
- 新代码可通过包根或 `@vetta/runtime-storage/conversation` 使用相同的 Conversation API
- 生产代码、测试、配置和包清单均不得依赖 `@vetta/coding-agent`
- 历史格式测试使用 Runtime 自有 fixture，不把产品实现作为测试 Oracle

## 测试要求

- 使用 Vitest 与每个用例独立的临时目录；不得读取或修改用户真实会话、配置目录和仓库 fixture 原件。
- Repository、事件追加、快照、分支、恢复或迁移变化必须覆盖正常读写、损坏/未知版本、原子失败、重复操作、并发冲突和重新打开后的持久化结果。
- 历史格式兼容使用最小、自包含、已脱敏 fixture，并明确验证只读迁移边界；不能通过调用 Coding Agent 旧实现生成期望结果。
