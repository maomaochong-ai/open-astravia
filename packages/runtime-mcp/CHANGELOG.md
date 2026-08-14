# Changelog

All notable changes to `@vetta/runtime-mcp` are documented in this file.

## [Unreleased]

### Breaking Changes

- **Node MCP 实现迁至平台层**：文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 和内置 Vetta MCP 改由 `@vetta/runtime-node/mcp` 导出；本包保留协议、Port、Schema、Supervisor 状态机、Tool 投影与渐进披露逻辑。
