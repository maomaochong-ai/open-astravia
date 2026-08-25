# Changelog

All notable changes to `@vetta/runtime-mcp` are documented in this file.

## [Unreleased]

### Breaking Changes

- **Node MCP 实现迁至平台层**：文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 和内置 Vetta MCP 改由 `@vetta/runtime-node/mcp` 导出；本包保留协议、Port、Schema、Supervisor 状态机、Tool 投影与渐进披露逻辑。

### Added

- `McpRuntimeToolSynchronizer` 可注入通用 `RuntimeObservationPublisher`，发布同步开始/完成/失败、revision、
  Tool 数量与 dispose 事件；fingerprint、描述、凭证和错误 message 不进入观测记录。
- `McpDeferredToolController.bindToolVisibility()` 冻结当前 MCP 目录代际，同时保留 Session-local
  `tool_search` 激活的实时可见性，供单个 Turn 内的后续模型调用安全刷新工具 Frame。

### Changed

- `tool_search` 是渐进披露的唯一实现；删除 `runtime-node` 中无人使用的重复定义和旧自验证测试。模型描述同步明确：
  激活后的完整 Tool Schema 在同一 Turn 的下一模型步骤即可调用，与实际 generation 行为一致。
