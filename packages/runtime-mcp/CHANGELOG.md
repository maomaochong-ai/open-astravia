# Changelog

All notable changes to `@vetta/runtime-mcp` are documented in this file.

## [Unreleased]

### Breaking Changes

- **Node MCP 实现迁至平台层**：文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 和内置 Vetta MCP 改由 `@vetta/runtime-node/mcp` 导出；本包保留协议、Port、Schema、Supervisor 状态机、Tool 投影与渐进披露逻辑。

### Added

- `McpDeferredToolController.bindToolVisibility()` 冻结当前 MCP 目录代际，同时保留 Session-local
  `tool_search` 激活的实时可见性，供单个 Turn 内的后续模型调用安全刷新工具 Frame。
