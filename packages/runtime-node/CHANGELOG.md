# Changelog

All notable changes to `@vetta/runtime-node` are documented in this file.

## [Unreleased]

### Added

- **Node RuntimeHost 与沙箱适配器**：实现路径规范化、工作目录创建、队列 sidecar 文件存储、会话沙箱授权缓存及 AsyncLocalStorage 授权传播；`runtime-core` 只保留对应 Host Port 与沙箱合同。
- **Node MCP 适配器**：从 `@vetta/runtime-mcp` 接管文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 与内置 Vetta MCP；协议包继续拥有 Port、Schema、Supervisor 状态机、Tool 投影和渐进披露。
- **Node Coding Tool 适配器**：从 `@vetta/runtime-tools` 接管具体 Tool 工厂、TypeBox Schema、模型描述、文件/命令/PDF/OCR 行为及 Node Host 原语；协议包继续拥有 Catalog、注册、激活、绑定和结果策略合同。
- **Node Conversation 适配器**：从 `@vetta/runtime-storage` 接管文件与内存 Repository、所有权租约、原子文件发布、会话目录、持久化编解码及 Legacy 会话文件读取和迁移；保持原有并发、恢复、续接与兼容行为。
