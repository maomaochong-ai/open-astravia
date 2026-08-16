# Changelog

All notable changes to `@vetta/runtime-node` are documented in this file.

## [Unreleased]

### Breaking Changes

- 移除 `@vetta/runtime-node/coding` 的 `kb_list_available_tags`、`kb_filter_by_tags` 与 `kb_write_page`
  Tool 定义及其 Schema/注册导出。这些模型可见语义现由 `@vetta/coding-agent` 的 Knowledge Feature 拥有；Node Runtime
  只提供显式根目录的查询与写入适配器。

- `@vetta/runtime-node/sandbox` 不再导出带 Coding Agent UI 文案和授权决策的 `confirmSandboxPermission()` 与
  `isSensitiveSandboxRequest()`；确认策略现由调用方拥有，Node Runtime 只提供路径、Grant 和 OS 执行能力。

- 移除 `@vetta/runtime-node/coding` 的 Todo Tool、Schema 和注册导出。Todo 不访问 Node 环境且包含明确
  产品规则，现由 `@vetta/coding-agent` 的 Todo Feature 直接拥有；Coding Agent 用户行为保持不变。

### Added

- `@vetta/runtime-node/host` 新增 `createNodeKnowledgeRuntime(root)`，把 `runtime-knowledge` 的 Tag 查询、页面写入和
  绝对路径解析绑定到宿主选择的根目录，不读取 Coding Agent 配置或进程开关。

- 新增 `createNodeResourcePackageHost()`，统一创建 Resource Package 所需的 Node 命令、路径、文件、摘要、Registry 与环境服务，
  供最终应用组合根显式注入上层资源语义。

- **Resource Package SHA-256 适配器**：`@vetta/runtime-node/host` 新增无状态 `nodeResourcePackageDigest`，供上层位置策略
  在不直接依赖 Node crypto 的情况下保持既有临时缓存目录摘要格式。

- **Node Tool Result Artifact 存储**：新增普通 Coding Tool 与 MCP 共用的原子 JSON 文件存储基础实现、
  协议适配器和组合会话清理器；保持安全路径段、SHA-256 摘要、临时文件重命名与定向递归清理语义，
  由平台组合根选择实际目录。

- **Node Sandbox Host**：新增 `createNodeSandboxHost()` 及 Linux bubblewrap、macOS Seatbelt、Windows sandbox host、
  Windows policy 和符号链接感知的工作区边界实现；通过 `ForegroundCommandOperations` 与结构化 Host Services 供
  Coding Agent 装配，不形成 runtime-node 对上层包的反向依赖。

- **Node Bash 宿主**：新增 `NodeHostBashExecutor`，集中实现本地 Shell 子进程、进程树终止、输出流、ANSI/二进制清理、
  截断和完整输出临时文件；Coding Agent 只通过 `HostBashExecutor` 契约进行装配，保留原有命令执行结果与取消语义。

- **Node Resource Package 文件事务**：新增 `NodeResourcePackageFiles`，集中实现包安装所需的异步文件读取、目录准备、
  非覆盖文本初始化、递归清理和目录枚举；由 Coding Agent Node 宿主显式注入，保持 npm/git 生命周期的既有文件语义。

- **Node Resource Package 路径事实**：新增 `createNodeResourcePackageLocationFacts()`，集中提供 Home、Temp
  和惰性全局 npm root 解析，并以结构化事实交给 Coding Agent 包路径策略；Node 命令 Port 不再承担同步路径查询。
- **Resource Package Node Host**：新增命令运行器、npm Registry Client 与动态 `PI_OFFLINE` 环境适配器，供上层资源
  包 Runtime 通过显式 Port 装配；子进程 stdio、Windows shell、Registry 超时和离线值语义保持原实现兼容。
- 新增文件与内存 Conversation persistence bundle 工厂，由 Node Runtime 统一拥有 Repository、Document、
  Continuation、路径投影和释放接线；文件实现同时提供恢复路径归属与存在性评估，产品层无需访问文件系统。
- **Node RuntimeHost 与沙箱适配器**：实现路径规范化、工作目录创建、队列 sidecar 文件存储、会话沙箱授权缓存及 AsyncLocalStorage 授权传播；`runtime-core` 只保留对应 Host Port 与沙箱合同。
- **Node MCP 适配器**：从 `@vetta/runtime-mcp` 接管文件配置、OAuth 状态文件、Vetta credentials、具体 Client Factory、stdio/HTTP transport、SDK OAuth Provider、Device Flow 与内置 Vetta MCP；协议包继续拥有 Port、Schema、Supervisor 状态机、Tool 投影和渐进披露。
- **Node Coding Tool 适配器**：从 `@vetta/runtime-tools` 接管具体 Tool 工厂、TypeBox Schema、模型描述、文件/命令/PDF/OCR 行为及 Node Host 原语；协议包继续拥有 Catalog、注册、激活、绑定和结果策略合同。
- **Node Conversation 适配器**：从 `@vetta/runtime-storage` 接管文件与内存 Repository、所有权租约、原子文件发布、会话目录、持久化编解码及 Legacy 会话文件读取和迁移；保持原有并发、恢复、续接与兼容行为。
