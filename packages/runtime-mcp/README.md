# @vetta/runtime-mcp

Vetta 平台无关的 MCP 协议、Port 与 Runtime 状态协调层。

## 本包拥有

- MCP wire/config 类型与 TypeBox 配置 Schema
- `McpConfigSource`、`McpOAuthStateStore`、Client Factory、Server 与 Tool Source Port
- OAuth 持久状态 Schema 和平台无关的 Browser Authorization Code 编排
- Server Supervisor 的 generation、lease、失败保持和差量协调状态机
- MCP Tool 的 Schema/结果投影、Runtime Tool 同步与动态 Server Source
- 会话级渐进披露、`tool_search` 和 MCP Prompt 物化
- 可选的 MCP Tool 同步观测 Publisher；只发布阶段、revision 和数量，不发布描述、fingerprint、凭证或错误正文

## 本包不拥有

- 文件配置、凭证和 OAuth 状态文件读写
- stdio 子进程、HTTP SDK Client、网络请求和具体 Client Factory
- SDK OAuth Provider、Device Flow 网络执行和内置 Vetta MCP 组装
- Desktop 回调页面、系统浏览器、配置路径、UI 或交互授权策略

Node 实现由 `@vetta/runtime-node/mcp` 提供；Desktop 专属交互由 `runtime-desktop` 或
`desktop` Host 适配器提供。`runtime-mcp/src` 不得导入平台 Runtime 或 `node:*`。

依赖方向：

```text
runtime-node/runtime-desktop -> runtime-mcp -> runtime-core
coding-agent composition -> runtime-mcp ports + selected platform implementation
```
