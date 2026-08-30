# Changelog

All notable changes to `@vetta/runtime-mcp` are documented in this file.

## [Unreleased]

### Breaking Changes

- **Node MCP 实现迁至平台层**：文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 和内置 Vetta MCP 改由 `@vetta/runtime-node/mcp` 导出；本包保留协议、Port、Schema、Supervisor 状态机、Tool 投影与渐进披露逻辑。

### Added

- 新增 MCP Apps 平台无关 Host/Attachment 合同，并按 `2026-01-26` 扩展解析 `_meta.ui`、旧版 resource URI、
  array visibility、`ui://` HTML Resource、CSP 与权限元数据；App-only Tool 不再进入模型工具目录。
- 新增集中式 MCP 媒体投影策略：验证规范 Base64、安全图片/音频 MIME，并限制单项、总字节和数量；大结果卸载后
  仍可保留受限音频预览，非法或超限媒体只进入完整 artifact。
- 新增可注入持久化 Port 的 MCP Task 执行协调器：Tool 创建 Task 后统一轮询、处理输入请求、取消并恢复为原始 ToolResult；
  非终态 Task 可在 Server binding 重建后恢复，状态投影不携带远端 taskId、inputRequests 或结果正文。
- 建立 MCP `2026-07-28` Modern/Legacy 协议时代合同：版本选择、现代请求 `_meta`、`resultType`、MRTR 输入请求、
  `server/discover`、Tasks 和 MCP Apps 扩展类型，并增加按协议时代区分的运行时 guards。
- `structuredContent` 扩展为完整 JSON 值；Tool/Resource 结果继续保留多媒体和未知扩展字段。
- MCP ToolResult 的原始详情继续携带完整 structured JSON、图片和音频块，供宿主渲染器按能力消费。
- 新增安全的 MCP Protocol Observation 合同，供协商、请求、MRTR、Task 和 App 生命周期记录摘要，禁止正文和凭证进入事件。

- MCP ToolResult 协议边界补齐 AudioContent、ResourceLink、EmbeddedResource、`structuredContent`、annotations 和 `_meta`；
  `resources/read` 改用独立的 Text/Blob ResourceContents 合同。直接图片与 image blob 资源可投影为 Runtime 图片，
  其它当前未进入 Agent Core 的内容保留原始详情并提供明确文本降级。
- 新增 MCP ToolResult/ResourceResult/InitializeResult 运行时 guards，拒绝结构非法的外部响应并保留未知扩展字段。

- `McpRuntimeToolSynchronizer` 可注入通用 `RuntimeObservationPublisher`，发布同步开始/完成/失败、revision、
  Tool 数量与 dispose 事件；fingerprint、描述、凭证和错误 message 不进入观测记录。
- `McpDeferredToolController.bindToolVisibility()` 冻结当前 MCP 目录代际，同时保留 Session-local
  `tool_search` 激活的实时可见性，供单个 Turn 内的后续模型调用安全刷新工具 Frame。

### Changed

- 新增 `@vetta/runtime-mcp/browser` 纯浏览器入口，Renderer 可复用 MCP App Attachment 解析与媒体准入策略，
  不再经包根入口把 Agent、Provider 或 Node transport 带入浏览器 bundle。
- `prompts/list` 的 `McpPrompt.arguments` 修正为冻结 Schema 的 `PromptArgument[]`；Tool annotations、Icon、Resource size
  和 Implementation 展示字段同步补齐官方公共合同。
- MCP ToolResult 的协议级 `isError` 现在从结果投影传播到 Runtime/Agent ToolResultMessage；结构化结果保留在 details 或 artifact 中。

- `tool_search` 是渐进披露的唯一实现；删除 `runtime-node` 中无人使用的重复定义和旧自验证测试。模型描述同步明确：
  激活后的完整 Tool Schema 在同一 Turn 的下一模型步骤即可调用，与实际 generation 行为一致。
