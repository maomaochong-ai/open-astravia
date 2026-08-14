# @vetta/runtime-node

Vetta Runtime 协议的共享 Node.js 实现层。

本包拥有文件系统、进程、锁、本地持久化及 Node Coding Tool 的具体行为，可由 Desktop、CLI
和服务端 Node Host 复用。产品或平台 Composition Root 负责选择和配置适配器；协议包不包含 Node I/O。

主要入口：

- `@vetta/runtime-node/conversation`：文件/内存 Repository、租约、原子发布、会话服务与 Legacy 迁移
- `@vetta/runtime-node/coding`：具体 Coding Tool、Schema、模型描述、文件/命令/PDF/OCR 实现与 Node Host 原语
- `@vetta/runtime-node/mcp`：文件配置与凭证、stdio/HTTP Client、MCP SDK/OAuth 和 Device Flow 实现

`runtime-node` 不拥有 Agent Turn/Session Kernel，也不拥有 Electron IPC、Desktop 生命周期、UI 或产品策略。
平台无关编排属于 `runtime-core`，Desktop 生命周期和平台装配属于 `runtime-desktop`。当前
`coding-agent` 产品组合使用本包的默认实现；非 Node 产品组合不得依赖本包。
