# @vetta/runtime-mcp

Greenfield Runtime 的独立 MCP Feature 合同与模型调用级同步实现。

## What It Owns

- 当前 MCP 工具视图的 `McpRuntimeToolSource` Port
- 与具体产品路径无关的 MCP 协议合同、TypeBox 配置 Schema 与文件配置 Source
- stdio JSON-RPC Client、Node 子进程适配器与 Streamable HTTP SDK Client
- OAuth 状态合同、Store Port、显式目录文件适配器和 SDK Provider
- Browser OAuth 用例编排、SDK Auth Session 与 RFC 8628 Device Flow
- HTTP Auth Provider Factory；产品目录、页面和操作系统交互由宿主适配器注入
- MCP Server Supervisor：初始化、状态观察、生命周期、静态/动态配置叠加与差量协调
- MCP Tool 的 TypeBox Schema 投影、调用结果投影与 Runtime-native Tool Source
- 动态 Server 完整替换到 Runtime Tool View 的窄控制 Source
- MCP 工具到 Runtime Registry 的增量同步与生命周期
- Turn generation 内的会话级渐进披露、`tool_search` 和 MCP Prompt 物化
- stdio、HTTP SDK 适配、配置和模型调用级能力的行为测试

## What It Does Not Own

- Desktop、CLI 等产品对全局/项目配置路径的选择，以及配置 UI
- OAuth token 产品目录解析、localhost 页面、系统浏览器和 provider-specific 策略
- Coding Agent 的产品 OAuth 入口、插件命名策略和 `AgentTool` 协议
- Desktop、CLI、IM 的 Composition Root

## Who Depends On It

- `runtime-composition`：在 Turn admission 捕获共享 MCP 与 Session-local 插件 MCP 工具 generation
- `coding-agent`：为 Greenfield 组合产品 OAuth 与 Runtime-native MCP Source，并以兼容
  `McpManager` 保留插件贡献和旧 `AgentTool` API
- Desktop 与 CLI 宿主：通过 coding-agent 产品工厂创建和释放 Runtime-native MCP Source

依赖方向必须保持为：

```text
runtime-mcp -> runtime-core + MCP SDK
coding-agent product composition -> runtime-mcp supervisor + native tool source + product OAuth paths/interactions
coding-agent compatibility adapter -> runtime-mcp supervisor + legacy API projection
runtime-composition -> runtime-mcp + runtime-tools
```

`runtime-mcp/src` 禁止反向导入 `@vetta/coding-agent`。
