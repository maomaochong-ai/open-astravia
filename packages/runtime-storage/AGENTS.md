# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-telemetry`、`runtime-tools`、`cli-host`

## 职责范围

存储协议包，拥有 Conversation 持久化端口、错误模型、Schema 与无 I/O 的协议逻辑。

## 注意事项

- 生产源码不得导入 `node:*`、Electron、DOM、数据库客户端或具体平台 Runtime
- 具体文件、内存、数据库或远端 Repository 实现放入对应平台 Runtime；Node 共享实现位于 `@vetta/runtime-node`
- 包根只导出 Conversation 协议能力，不得恢复认证、设置或旧 Session Manager 兼容导出
- 新代码可通过包根或 `@vetta/runtime-storage/conversation` 使用相同的 Conversation API
- 生产代码、测试、配置和包清单均不得依赖 `@vetta/coding-agent`
- 历史格式测试使用 Runtime 自有 fixture，不把产品实现作为测试 Oracle

## 测试要求

- 使用 Vitest 与每个用例独立的临时目录；不得读取或修改用户真实会话、配置目录和仓库 fixture 原件。
- 端口、Schema、错误映射或纯状态转换变化必须覆盖合同测试和无平台依赖边界测试。
- 具体实现的一致性测试由平台实现包拥有，不能把协议包内部实现当作 Oracle。
