# Changelog

All notable changes to `@vetta/runtime-node` are documented in this file.

## [Unreleased]

### Breaking Changes

- 移除 `@vetta/runtime-node/coding` 的 7 个子代理控制 Tool（`spawn_agent`、`dispatch_workflows`、`wait_agent`、
  `list_agents`、`interrupt_agent`、`send_message`、`followup_task`）及其 Schema、描述和注册导出。它们不依赖
  Node 环境，现由 `@vetta/coding-agent` 的 Subagent Feature 持有；Node Runtime 继续只提供平台实现。

- 移除 `@vetta/runtime-node/coding` 中无人使用的重复 `tool_search` Tool、评分器、Schema 与注册导出。
  会话级渐进披露的唯一生产实现和公共合同位于平台中立的 `@vetta/runtime-mcp`。

- 移除 `@vetta/runtime-node/coding` 的 `invoke_skill` Tool、Schema、描述和注册导出。Skill 已在进入
  Coding Agent 领域时完成物化，该模型可见语义现由 `@vetta/coding-agent` 的 Skill 领域持有；Node Runtime
  不再承载无平台依赖的产品 Tool 定义。

- 移除 `@vetta/runtime-node/coding` 的 `ask_user_question` Tool、Schema、描述、Capability 类型和注册导出。
  该模型可见交互语义现由 `@vetta/coding-agent` 的 Ask User Question Feature 持有，并直接消费
  `runtime-core` 的通用宿主提问 Capability；用户行为保持不变。

- 移除 `@vetta/runtime-node/coding` 的 `memory` Tool、Schema、描述和注册导出。模型可见 Memory 语义现由
  `@vetta/coding-agent` 拥有；Node Runtime 只提供通用文本文件存储适配器。

- 移除 `@vetta/runtime-node/coding` 的 `kb_list_available_tags`、`kb_filter_by_tags` 与 `kb_write_page`
  Tool 定义及其 Schema/注册导出。这些模型可见语义现由 `@vetta/coding-agent` 的 Knowledge Feature 拥有；Node Runtime
  只提供显式根目录的查询与写入适配器。

- `@vetta/runtime-node/sandbox` 不再导出带 Coding Agent UI 文案和授权决策的 `confirmSandboxPermission()` 与
  `isSensitiveSandboxRequest()`；确认策略现由调用方拥有，Node Runtime 只提供路径、Grant 和 OS 执行能力。

- 移除 `@vetta/runtime-node/coding` 的 Todo Tool、Schema 和注册导出。Todo 不访问 Node 环境且包含明确
  产品规则，现由 `@vetta/coding-agent` 的 Todo Feature 直接拥有；Coding Agent 用户行为保持不变。

### Added

- Conversation persistence bundle 新增 `resolveSessionDirectory(sessionId)`；文件实现直接返回其已知根目录，内存实现返回
  `undefined`，上层不再从可恢复会话路径反推制品目录。

- `@vetta/runtime-node/coding` 新增 `createNodeSandboxCodingToolEnvironment()`，从显式路径策略与 Host
  选项统一创建 `read`、`write`、`edit`、平台命令 Tool 和 Node sandbox services；上层产品只需装饰权限语义，
  不再重复选择具体 Tool 构造器。

- `@vetta/runtime-node/coding` 新增 `createNodeCommandToolEnvironment()` 与
  `createNodeHostSessionCommandEnvironment()`，为每个 Session 组合独占的命令注册、环境覆盖、后台任务服务和释放生命周期；
  完整 Node ToolEnvironment 复用同一命令装配路径，避免两套执行实现漂移。

- `@vetta/runtime-node/coding` 新增 `createNodePathBoundaryClassifier()` 与
  `createNodeHostCodingToolEnvironment()`：前者统一处理平台路径规范化和目录边界，后者组合 Shell、前后台命令、
  托管可执行文件与基础 Coding Tool；产品路径策略和目录选择仍由最终宿主显式传入。

- `@vetta/runtime-node/coding` 新增 `createNodeDocToPdfOperations()`，统一拥有 Office/WPS 探测、
  平台命令构造、文件存在性检查和进程错误映射；Coding Agent 只负责工具注册与模型顺序策略。
- `@vetta/runtime-node/coding` 新增 `createNodeVettaDesktopCommandPort()`，统一拥有 Desktop 可执行文件定位、
  配置读取和 Node 进程取消错误映射，并允许宿主显式注入平台与环境事实用于测试和非默认部署。

- `@vetta/runtime-node/host` 新增 `NodeTextFileStorage`，以缺失读取、临时文件替换和追加能力实现平台中立的
  `MemoryTextStorage` 合同，由 CLI、Desktop 与 SDK Composition Root 显式选择具体 Memory 与 Journal 路径。

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
