# 全面重写实施日志

本索引只指向已经实施并验证的事实。尚未实现的设计仍以本目录其他方案文档为准。

按「一次修改一个文件」拆分后的日志位于 [`08-implementation-log/`](./08-implementation-log/)。后续每一轮已验证实施新增一个文件，并在本索引登记。

## 日志列表

| 文件 | 轮次 |
| --- | --- |
| [01-greenfield-kernel-slice.md](./08-implementation-log/01-greenfield-kernel-slice.md) | Greenfield Kernel 第一纵向切片 |
| [02-snapshot-lease-and-storage.md](./08-implementation-log/02-snapshot-lease-and-storage.md) | Snapshot Lease 与文件会话仓储 |
| [03-agent-core-turn-engine.md](./08-implementation-log/03-agent-core-turn-engine.md) | Agent Core Turn Engine Adapter |
| [04-runtime-schema-boundary.md](./08-implementation-log/04-runtime-schema-boundary.md) | 运行时 Schema 边界 |
| [05-coding-tools-feature.md](./08-implementation-log/05-coding-tools-feature.md) | 第一个独立 Coding Tools Feature |
| [06-behavior-compatibility-correction.md](./08-implementation-log/06-behavior-compatibility-correction.md) | 行为兼容性纠偏 |
| [07-coding-tool-registration.md](./08-implementation-log/07-coding-tool-registration.md) | Coding Tool 注册边界与差分合同 |
| [08-read-behavior-baseline.md](./08-implementation-log/08-read-behavior-baseline.md) | Read 参数化行为基线 |
| [09-runtime-read.md](./08-implementation-log/09-runtime-read.md) | 独立 Runtime Read 与 Feature 接入 |
| [10-runtime-ls.md](./08-implementation-log/10-runtime-ls.md) | 独立 Runtime Ls 与默认暴露兼容 |
| [11-coding-tool-catalog.md](./08-implementation-log/11-coding-tool-catalog.md) | 动态 Coding Tool Catalog 与 Feature 解耦 |
| [12-model-call-frame.md](./08-implementation-log/12-model-call-frame.md) | Model Call Frame 与实时能力校验 |
| [13-capability-lifecycle.md](./08-implementation-log/13-capability-lifecycle.md) | 稳定能力绑定、生命周期与在途执行仲裁 |
| [14-runtime-grep.md](./08-implementation-log/14-runtime-grep.md) | Grep 行为兼容、独立 Runtime 实现与 Tool Loop 接入 |
| [15-runtime-find.md](./08-implementation-log/15-runtime-find.md) | Find 行为兼容、空 scope 与显式 Tool Loop 接入 |
| [16-runtime-glob.md](./08-implementation-log/16-runtime-glob.md) | Glob 行为兼容、绝对模式与 `.gitignore` Tool Loop 接入 |
| [17-host-executable-resolver.md](./08-implementation-log/17-host-executable-resolver.md) | 宿主 `rg`/`fd` 解析 Port 与 Runtime 注入 |
| [18-coding-agent-executable-adapter.md](./08-implementation-log/18-coding-agent-executable-adapter.md) | 旧 `ensureTool` 到 Resolver Port 的宿主适配 |
| [19-host-adapter-boundary-and-behavior-tests.md](./08-implementation-log/19-host-adapter-boundary-and-behavior-tests.md) | 宿主适配器目录边界与 `ensureTool` 行为合同 |
| [20-runtime-executable-re-resolution.md](./08-implementation-log/20-runtime-executable-re-resolution.md) | Runtime 可执行文件实时重解析合同 |
| [21-host-download-plan-contract.md](./08-implementation-log/21-host-download-plan-contract.md) | 宿主下载计划与跨平台产物合同 |
| [22-host-archive-installation-contract.md](./08-implementation-log/22-host-archive-installation-contract.md) | 宿主归档安装与清理合同 |
| [23-network-artifact-and-composition-root.md](./08-implementation-log/23-network-artifact-and-composition-root.md) | 网络边界、独立产物验证与 CLI Composition Root |
| [24-tool-profile-differential-gate.md](./08-implementation-log/24-tool-profile-differential-gate.md) | 旧新 Tool Profile 差分门禁与兼容导出审计 |
| [25-capability-aware-tool-activation.md](./08-implementation-log/25-capability-aware-tool-activation.md) | Tool requires/capabilities 激活合同 |
| [26-command-tool-port-and-compatibility-adapter.md](./08-implementation-log/26-command-tool-port-and-compatibility-adapter.md) | Bash/Shell Port、兼容适配器与 Profile 接入 |
| [27-independent-foreground-command-executor.md](./08-implementation-log/27-independent-foreground-command-executor.md) | 独立 Runtime 前台命令执行器与宿主进程适配 |
| [28-background-command-service-and-task-tools.md](./08-implementation-log/28-background-command-service-and-task-tools.md) | 后台命令 Service Port、Runtime 协调与 Task Tools |
| [29-runtime-background-command-lifecycle.md](./08-implementation-log/29-runtime-background-command-lifecycle.md) | Runtime 后台任务生命周期与低层宿主端口 |
| [30-runtime-dir-tree.md](./08-implementation-log/30-runtime-dir-tree.md) | Dir Tree 行为兼容、独立 Runtime 实现与 Profile 接入 |
| [31-runtime-write.md](./08-implementation-log/31-runtime-write.md) | Write 行为兼容、宿主路径策略与独立 Runtime 实现 |
| [32-runtime-edit.md](./08-implementation-log/32-runtime-edit.md) | Edit 双模式行为兼容、纯编辑引擎与独立 Runtime 实现 |
| [33-runtime-session-backend-boundary.md](./08-implementation-log/33-runtime-session-backend-boundary.md) | RuntimeHost 可注入 Session Backend 创建边界与旧实现适配器 |
| [34-session-observation-and-greenfield-events.md](./08-implementation-log/34-session-observation-and-greenfield-events.md) | 旧会话事件特征基线、独立观察合同与 Greenfield SessionEvent 适配 |
| [35-session-input-concurrency.md](./08-implementation-log/35-session-input-concurrency.md) | 活动 Turn 的 steer、follow-up、队列模式与终态仲裁 |
| [36-greenfield-session-backend.md](./08-implementation-log/36-greenfield-session-backend.md) | Greenfield 并行后端、Continue Turn 与恢复边界 |
| [37-session-resume-and-recovery.md](./08-implementation-log/37-session-resume-and-recovery.md) | 类型基线修复、显式 Session Resume 与未完成 Turn 恢复 |
| [38-runtime-session-core-ports.md](./08-implementation-log/38-runtime-session-core-ports.md) | RuntimeHost Turn Control、Event Stream 与 State Read Port |
| [39-runtime-session-backend-assembly.md](./08-implementation-log/39-runtime-session-backend-assembly.md) | Backend Assembly、旧 Backend 兼容适配与 Composition Root 解耦 |
| [40-session-identity-lifecycle-and-history-read.md](./08-implementation-log/40-session-identity-lifecycle-and-history-read.md) | Session Identity/Lifecycle、History Read Port 与 Assembly 交付 |
| [41-session-history-controller.md](./08-implementation-log/41-session-history-controller.md) | History 写操作行为基线、Controller Port 与 Assembly 交付 |
| [42-session-model-controller.md](./08-implementation-log/42-session-model-controller.md) | 模型选择行为基线、Model Controller 与 Assembly 交付 |
| [43-session-model-view.md](./08-implementation-log/43-session-model-view.md) | 模型只读视图、外围候选行为基线与 Assembly 交付 |
| [44-session-host-interaction.md](./08-implementation-log/44-session-host-interaction.md) | 独立宿主交互合同、旧 Extension UI 适配与重绑定语义 |
| [45-session-execution-and-workspace.md](./08-implementation-log/45-session-execution-and-workspace.md) | 工作目录视图、执行模式控制与旧工具重配置适配 |
| [46-session-work-management.md](./08-implementation-log/46-session-work-management.md) | 后台工作、subagent、todo 稳定合同与 Assembly 交付 |
| [47-session-runtime-configuration.md](./08-implementation-log/47-session-runtime-configuration.md) | 输入队列模式、插件运行时配置与 agent mode 的统一配置边界 |
| [48-raw-session-handle-removal.md](./08-implementation-log/48-raw-session-handle-removal.md) | 裸 Session 句柄移除、结构门禁与创建/存储边界审计 |
| [49-session-creation-and-storage-boundary.md](./08-implementation-log/49-session-creation-and-storage-boundary.md) | Runtime-owned 创建请求、离线 Catalog、文件历史与共享模型服务 |
| [50-greenfield-session-projection.md](./08-implementation-log/50-greenfield-session-projection.md) | Greenfield 同步会话投影、真实 Core Assembly 与文件恢复集成 |
| [51-conversation-document-and-history-read.md](./08-implementation-log/51-conversation-document-and-history-read.md) | Conversation Document、原生 V2/Legacy 读取与 Greenfield History Reader |
| [52-conversation-document-write-and-history-controller.md](./08-implementation-log/52-conversation-document-write-and-history-controller.md) | Conversation Document 写命令、并发边界与 Greenfield History Controller |
| [53-greenfield-model-runtime-and-turn-binding.md](./08-implementation-log/53-greenfield-model-runtime-and-turn-binding.md) | Greenfield 模型事实源、抽象 Catalog/Credential Port 与 Turn 级模型绑定 |
| [54-runtime-core-dependency-inversion.md](./08-implementation-log/54-runtime-core-dependency-inversion.md) | Runtime Core 依赖倒置、Legacy Adapter 上移与显式生产组合 |
| [55-greenfield-parallel-runtime-composition.md](./08-implementation-log/55-greenfield-parallel-runtime-composition.md) | Greenfield 通用 Factory、模型/Prompt Adapter 与 CLI 并行真实组合 |
| [56-dynamic-capability-and-prompt-context.md](./08-implementation-log/56-dynamic-capability-and-prompt-context.md) | 动态能力组合、通用 Turn Context 与 Prompt 输入等价 |
| [57-session-dynamic-capability-sources.md](./08-implementation-log/57-session-dynamic-capability-sources.md) | 会话级动态 Skill/Scene、Knowledge 与 MCP 能力源适配 |
| [58-mcp-progressive-disclosure-and-model-call-gate.md](./08-implementation-log/58-mcp-progressive-disclosure-and-model-call-gate.md) | MCP 会话级渐进披露与模型调用输入门禁 |
| [59-workspace-build-order-type-gate.md](./08-implementation-log/59-workspace-build-order-type-gate.md) | Workspace 构建顺序纠偏与类型门禁补漏 |
| [60-desktop-workspace-prerequisite-graph.md](./08-implementation-log/60-desktop-workspace-prerequisite-graph.md) | Desktop 前置构建图纠偏与 `TS5055` 回归门禁 |
| [61-model-call-frame-composer-and-prompt-parity.md](./08-implementation-log/61-model-call-frame-composer-and-prompt-parity.md) | Model Call Frame Composer 与调用级 Prompt 等价切片 |
| [62-session-prompt-runtime-and-unified-draft.md](./08-implementation-log/62-session-prompt-runtime-and-unified-draft.md) | Session Prompt Runtime、统一 Prompt Draft 与 MCP 单通道 |
| [63-cli-typecheck-and-build-surface-gate.md](./08-implementation-log/63-cli-typecheck-and-build-surface-gate.md) | CLI 显式类型门禁与 Build Surface 声明消费验证 |
| [64-dynamic-plugin-run-and-continuation-policy.md](./08-implementation-log/64-dynamic-plugin-run-and-continuation-policy.md) | 动态 Plugin Run Orchestrator 与通用 Continuation Policy |
| [65-session-local-plugin-tool-runtime.md](./08-implementation-log/65-session-local-plugin-tool-runtime.md) | Session-local Plugin Tool Runtime、动态撤销与同 Turn Effect |
| [66-product-continuation-orchestrator.md](./08-implementation-log/66-product-continuation-orchestrator.md) | 产品级 Continuation Orchestrator 与 Todo/Plugin/Stop Hook 收敛 |
| [67-session-local-todo-runtime.md](./08-implementation-log/67-session-local-todo-runtime.md) | Session-local Todo Runtime、分支持久化与 Controller 纵向切片 |
| [68-session-local-ecosystem-hook-runtime.md](./08-implementation-log/68-session-local-ecosystem-hook-runtime.md) | Session-local Ecosystem Hook Runtime、运行期 Context 串行持久化与生命周期收敛 |
| [69-session-local-context-runtime.md](./08-implementation-log/69-session-local-context-runtime.md) | Session-local Context Runtime、原生压缩投影与逐调用 microcompact |
| [70-model-call-compaction-orchestrator.md](./08-implementation-log/70-model-call-compaction-orchestrator.md) | 模型调用级压缩检查点、同 Turn 阈值与 overflow 自动恢复 |
| [71-session-manual-compaction.md](./08-implementation-log/71-session-manual-compaction.md) | Session 手动压缩、Extension 兼容与统一持久化提交边界 |
| [72-cross-conversation-turn-continuation.md](./08-implementation-log/72-cross-conversation-turn-continuation.md) | 跨 Conversation Turn 续接事务、运行时身份与宿主路径重绑定 |
| [73-memory-rollover-orchestrator.md](./08-implementation-log/73-memory-rollover-orchestrator.md) | Memory Rollover 产品编排、既有 MEMORY/Tool/JOURNAL 复用与默认关闭接线 |
| [74-memory-rollover-finalization-and-flush-control.md](./08-implementation-log/74-memory-rollover-finalization-and-flush-control.md) | Rollover 后置时序兼容、continuation finalization 与主动 Memory Flush 控制 |
| [75-rpc-host-anti-corruption-layer.md](./08-implementation-log/75-rpc-host-anti-corruption-layer.md) | RPC JSONL/校验/分发解耦、分组 Capability、Legacy Adapter 与无模型协议基线 |
| [76-profile-aware-rpc-and-greenfield-im-adapter.md](./08-implementation-log/76-profile-aware-rpc-and-greenfield-im-adapter.md) | Profile-aware RPC、Greenfield IM Adapter、事件/Host Tool/路径与释放边界 |
| [77-greenfield-im-runtime-host-and-session-ownership.md](./08-implementation-log/77-greenfield-im-runtime-host-and-session-ownership.md) | 共享 Host Bootstrap、Greenfield IM Runtime Host、进程级会话所有权与 Legacy fallback |
| [78-explicit-runtime-selector-and-rpc-executable.md](./08-implementation-log/78-explicit-runtime-selector-and-rpc-executable.md) | 显式 Legacy/Greenfield Selector、独立 RPC 可执行入口、stdout 与 ownership wire 子进程门禁 |
| [79-provider-tool-loop-subprocess-differential-gate.md](./08-implementation-log/79-provider-tool-loop-subprocess-differential-gate.md) | 真实 Provider/Tool Loop 子进程差分门禁与 Legacy/Greenfield 兼容修复 |
| [80-im-sidecar-runtime-opt-in-and-executable-closure.md](./08-implementation-log/80-im-sidecar-runtime-opt-in-and-executable-closure.md) | IM Sidecar Runtime 显式 opt-in、三平台 Selector 入口闭包与实际后端可观察性 |
| [81-format-neutral-session-catalog-and-lifecycle-routing.md](./08-implementation-log/81-format-neutral-session-catalog-and-lifecycle-routing.md) | Legacy/Greenfield 格式中立会话目录、历史读取与生命周期路由 |
| [82-session-access-capabilities-and-desktop-open-policy.md](./08-implementation-log/82-session-access-capabilities-and-desktop-open-policy.md) | 格式中立会话访问能力、Desktop 显式打开策略与主进程保护 |
| [83-runtime-host-assembly-gate-and-desktop-greenfield-candidate.md](./08-implementation-log/83-runtime-host-assembly-gate-and-desktop-greenfield-candidate.md) | RuntimeHost Assembly 完整性门禁、Greenfield 缺口评估与 Desktop 非生产候选组合 |
| [84-session-local-configuration-and-work-control-boundary.md](./08-implementation-log/84-session-local-configuration-and-work-control-boundary.md) | Session 创建后外围工厂、动态配置事实源与后台工作隔离边界 |
| [85-session-local-execution-and-host-interaction.md](./08-implementation-log/85-session-local-execution-and-host-interaction.md) | Session-local 执行覆盖层、Host Interaction Broker 与动态工具绑定兼容 |
| [86-greenfield-subagent-runtime.md](./08-implementation-log/86-greenfield-subagent-runtime.md) | Greenfield Session-local Subagent Runtime、异步通知续轮与完整 RuntimeHost Assembly |
| [87-runtime-host-greenfield-backend-and-catalog-routing.md](./08-implementation-log/87-runtime-host-greenfield-backend-and-catalog-routing.md) | RuntimeHost Greenfield Backend、Catalog 格式路由、请求等价门禁与 Desktop Candidate 真实接入 |
| [88-runtime-host-plugin-and-question-capabilities.md](./08-implementation-log/88-runtime-host-plugin-and-question-capabilities.md) | RuntimeHost Plugin/用户提问能力接线、动态移除与来源冲突门禁 |
| [89-subagent-state-journal-and-recovery.md](./08-implementation-log/89-subagent-state-journal-and-recovery.md) | Subagent 增量状态日志、确定性恢复、delivery 去重与 transcript ownership 门禁 |
| [90-desktop-greenfield-opt-in-and-host-differential-gate.md](./08-implementation-log/90-desktop-greenfield-opt-in-and-host-differential-gate.md) | Desktop 进程级 Greenfield Backend Pool、显式 opt-in、Catalog/访问路由与 Legacy/Greenfield 宿主差分门禁 |
| [91-desktop-real-turn-and-runtime-consumer-canary.md](./08-implementation-log/91-desktop-real-turn-and-runtime-consumer-canary.md) | Desktop 真实 Provider Tool Loop、动态外围能力、三类 RuntimeHost 消费者与生产选择诊断门禁 |
| [92-cli-driven-desktop-runtime-canary.md](./08-implementation-log/92-cli-driven-desktop-runtime-canary.md) | 独立 Vetta CLI 驱动的 Desktop Greenfield 会话创建、继续、列举与 CWD 身份持久化门禁 |
| [93-real-desktop-process-runtime-canary.md](./08-implementation-log/93-real-desktop-process-runtime-canary.md) | 真实 Desktop 主进程 Greenfield Canary、CLI 会话闭环、优雅退出与取消清理门禁 |
| [94-desktop-runtime-consumer-lifecycle.md](./08-implementation-log/94-desktop-runtime-consumer-lifecycle.md) | Desktop 交互/Scheduler/Batch 多消费者共存、异步合同与进程级退出所有权门禁 |
| [95-runtime-composition-package-and-artifact-closure.md](./08-implementation-log/95-runtime-composition-package-and-artifact-closure.md) | Greenfield Composition Root 归位、CLI 兼容边界与独立 `dist` 产物闭包 |
| [96-installed-artifact-and-process-restart-gate.md](./08-implementation-log/96-installed-artifact-and-process-restart-gate.md) | 独立安装 CLI 产物、宿主能力注入与跨进程会话恢复门禁 |
| [97-desktop-installed-artifact-process-restart-closure.md](./08-implementation-log/97-desktop-installed-artifact-process-restart-closure.md) | Desktop 独立 CLI、双进程恢复、动态 Skill/MCP 重装配与清理闭环 |
| [98-mcp-runtime-port-and-legacy-adapter.md](./08-implementation-log/98-mcp-runtime-port-and-legacy-adapter.md) | MCP Runtime 独立端口、增量同步、旧实现适配与真实宿主门禁 |
| [99-mcp-protocol-and-config-source-boundary.md](./08-implementation-log/99-mcp-protocol-and-config-source-boundary.md) | MCP 协议合同、TypeBox 配置解析、文件 Source 与 Manager 行为基线 |
| [100-mcp-client-and-transport-boundary.md](./08-implementation-log/100-mcp-client-and-transport-boundary.md) | MCP Client、stdio 子进程、HTTP SDK Adapter 与 OAuth 产品适配边界 |
| [101-mcp-oauth-state-store-and-provider-boundary.md](./08-implementation-log/101-mcp-oauth-state-store-and-provider-boundary.md) | MCP OAuth 状态合同、Store Port、文件适配器与 SDK Provider 边界 |
| [102-mcp-interactive-oauth-orchestration.md](./08-implementation-log/102-mcp-interactive-oauth-orchestration.md) | MCP Browser OAuth、RFC 8628 Device Flow 与宿主交互边界 |
| [103-mcp-server-supervisor-and-manager-adapter.md](./08-implementation-log/103-mcp-server-supervisor-and-manager-adapter.md) | MCP Server 生命周期、状态观察、差量协调与旧 Manager 兼容适配 |
| [104-runtime-native-mcp-tool-source.md](./08-implementation-log/104-runtime-native-mcp-tool-source.md) | Runtime-native MCP Tool Source、产品组合工厂与 Greenfield 宿主切换 |
| [105-session-local-plugin-mcp-runtime.md](./08-implementation-log/105-session-local-plugin-mcp-runtime.md) | Session-local Plugin MCP Runtime、动态重配置、隔离与渐进披露闭环 |
| [106-greenfield-subagent-mcp-capability-projection.md](./08-implementation-log/106-greenfield-subagent-mcp-capability-projection.md) | Greenfield 子代理 MCP Tool Binding 投影、激活兼容与连接所有权收敛 |
| [107-mcp-cutover-differential-gate.md](./08-implementation-log/107-mcp-cutover-differential-gate.md) | MCP 新旧端到端差分门禁、测试稳定性纠正与迁移边界收口 |
| [108-production-model-call-frame-readiness.md](./08-implementation-log/108-production-model-call-frame-readiness.md) | 生产 Model Call Frame 差分门禁、动态 Profile 切换与缺失能力清单 |
| [109-production-tool-surface-gap-closure.md](./08-implementation-log/109-production-tool-surface-gap-closure.md) | 生产 Tool Surface 缺口闭合、动态 Skill/Agent Mode 与确定性顺序 |
| [110-runtime-native-product-tools-and-model-order.md](./08-implementation-log/110-runtime-native-product-tools-and-model-order.md) | Runtime-native 产品工具、Session cwd 隔离与通用模型顺序合同 |
| [111-real-host-provider-frame-and-session-isolation.md](./08-implementation-log/111-real-host-provider-frame-and-session-isolation.md) | 真实 CLI/RPC/IM 完整 Provider Frame 与同宿主多会话 cwd 隔离 |
| [112-real-host-lifecycle-and-dynamic-capability-boundaries.md](./08-implementation-log/112-real-host-lifecycle-and-dynamic-capability-boundaries.md) | 真实宿主生命周期、进程内重启恢复与动态 Skill 边界 |
| [113-installed-artifact-runtime-boundary-closure.md](./08-implementation-log/113-installed-artifact-runtime-boundary-closure.md) | 标准安装产物 Provider Frame、跨进程恢复与动态 Skill/MCP 边界 |
| [114-production-cutover-control-and-session-migration.md](./08-implementation-log/114-production-cutover-control-and-session-migration.md) | 中性启动入口、Runtime 决策观察、显式 Legacy 会话迁移与架构回退守卫 |
| [115-composition-ownership-and-dependency-graph.md](./08-implementation-log/115-composition-ownership-and-dependency-graph.md) | Coding Agent Composition 所有权、兼容转发、分段构建与依赖声明守卫 |
| [116-public-api-subpaths-and-root-consumer-guard.md](./08-implementation-log/116-public-api-subpaths-and-root-consumer-guard.md) | Coding Agent 公开子路径、仓库内消费者迁移与兼容根入口守卫 |
| [117-legacy-boundaries-and-knowledge-processing-port.md](./08-implementation-log/117-legacy-boundaries-and-knowledge-processing-port.md) | Legacy/Compat 窄入口、Knowledge Processing Session Port 与生产根消费者归零 |
| [118-greenfield-knowledge-processing-session.md](./08-implementation-log/118-greenfield-knowledge-processing-session.md) | Greenfield Knowledge Processing Factory、会话级 Writer、Todo 锁定与首次持久化 |
| [119-knowledge-poller-greenfield-opt-in-and-batch-differential.md](./08-implementation-log/119-knowledge-poller-greenfield-opt-in-and-batch-differential.md) | Knowledge Poller 显式 Greenfield opt-in、Desktop Factory Resolver 与真实多批写入差分 |
| [120-knowledge-round-controller-and-side-effect-contracts.md](./08-implementation-log/120-knowledge-round-controller-and-side-effect-contracts.md) | Knowledge Round Controller、轮级副作用与成功/失败/中止合同 |
| [121-real-desktop-knowledge-lifecycle-canary.md](./08-implementation-log/121-real-desktop-knowledge-lifecycle-canary.md) | 真实 Desktop Knowledge CLI/审批/退出/重启/失败生命周期 Canary |
| [122-real-desktop-knowledge-runtime-differential.md](./08-implementation-log/122-real-desktop-knowledge-runtime-differential.md) | 真实 Legacy/Greenfield Desktop Knowledge 完整合同差分与切换门禁 |
| [123-desktop-greenfield-default-cutover.md](./08-implementation-log/123-desktop-greenfield-default-cutover.md) | Desktop Greenfield 默认切换、显式 Legacy 回退与三路真实宿主门禁 |
| [124-desktop-runtime-cutover-stabilization.md](./08-implementation-log/124-desktop-runtime-cutover-stabilization.md) | Desktop Runtime 进程决策、会话路由观察、Composition Root 拆分与 Legacy 兼容隔离 |
| [125-legacy-responsibility-allowlist.md](./08-implementation-log/125-legacy-responsibility-allowlist.md) | 中性共享模型控制器、Desktop 三服务 Legacy 边界与生产依赖白名单 |
| [126-legacy-format-execution-separation.md](./08-implementation-log/126-legacy-format-execution-separation.md) | Legacy JSONL 格式兼容与旧 Agent 执行兼容分离 |
| [127-cli-format-neutral-continue-selection.md](./08-implementation-log/127-cli-format-neutral-continue-selection.md) | CLI 格式中立 `--continue` 选择、Greenfield 恢复与 Legacy 回退收缩 |
| [128-legacy-extension-capability-assessment.md](./08-implementation-log/128-legacy-extension-capability-assessment.md) | Legacy Extension 能力分类、宿主评估与能力驱动回退合同 |
| [129-extension-execution-host-contract.md](./08-implementation-log/129-extension-execution-host-contract.md) | Extension Execution Host 合同、共享 Runtime 原位绑定与 Legacy 等价适配 |
| [130-greenfield-extension-action-host.md](./08-implementation-log/130-greenfield-extension-action-host.md) | Greenfield Extension Action Host、五种消息投递语义与 Provider/Flag 安全切换 |
| [131-greenfield-extension-event-host.md](./08-implementation-log/131-greenfield-extension-event-host.md) | Greenfield Extension Input/Tool 事件宿主、只读 Session Context 与事件级回退 |
| [132-greenfield-extension-execution-observation.md](./08-implementation-log/132-greenfield-extension-execution-observation.md) | Runtime 执行观察合同、Extension 生命周期/执行事件适配与身份事件回退 |
| [133-agent-run-preparation-and-before-start.md](./08-implementation-log/133-agent-run-preparation-and-before-start.md) | Agent Run Preparation、首次 Frame 复用与 `before_agent_start` 无损适配 |
| [134-runtime-message-identity-and-extension-events.md](./08-implementation-log/134-runtime-message-identity-and-extension-events.md) | Runtime 消息身份信封、Extension `message_*` / `agent_end` 无损适配与 `context` 回退边界 |
| [135-lossless-context-and-model-call-boundaries.md](./08-implementation-log/135-lossless-context-and-model-call-boundaries.md) | 完整 AgentMessage 上下文投影、Extension `context` 与最终模型消息边界 |
| [136-real-cli-context-model-call-differential-gate.md](./08-implementation-log/136-real-cli-context-model-call-differential-gate.md) | 真实 CLI Context/Compaction/Image Legacy-Greenfield 差分门禁 |
| [137-greenfield-extension-tool-runtime-and-cutover-gate.md](./08-implementation-log/137-greenfield-extension-tool-runtime-and-cutover-gate.md) | Greenfield Extension Tool Runtime、显式宿主能力与 CI 切换门禁 |
| [138-greenfield-extension-command-host-and-rpc-discovery.md](./08-implementation-log/138-greenfield-extension-command-host-and-rpc-discovery.md) | Greenfield Extension Command Host 边界、RPC Prompt/Skill 发现与安全回退 |
| [139-active-session-transition-host.md](./08-implementation-log/139-active-session-transition-host.md) | Active Session Transition Host、RPC 会话事务与 setup 迁移桥 |
| [140-extension-command-context-and-runtime-reload.md](./08-implementation-log/140-extension-command-context-and-runtime-reload.md) | Extension Command Context、树导航、动态 Runner/Tool 与热重载事务 |
| [141-extension-host-capability-closure.md](./08-implementation-log/141-extension-host-capability-closure.md) | Extension 宿主能力三态、资源发现、压缩与模型事件闭环 |
| [142-extension-profile-and-cli-cutover-gate.md](./08-implementation-log/142-extension-profile-and-cli-cutover-gate.md) | Extension Event 穷尽 Profile、回退诊断与真实 CLI 切换门禁 |
| [143-installed-extension-gate-and-im-default-cutover.md](./08-implementation-log/143-installed-extension-gate-and-im-default-cutover.md) | 安装产物 Extension 门禁、IM 默认 Greenfield 与工具顺序兼容 |
| [144-legacy-session-migration-and-runtime-decision.md](./08-implementation-log/144-legacy-session-migration-and-runtime-decision.md) | 旧会话只读迁移、结构化 Runtime 决策与 IM 路径闭环 |
| [145-strict-lossless-legacy-import-gate.md](./08-implementation-log/145-strict-lossless-legacy-import-gate.md) | 旧会话逐行严格分析、失败关闭与无正文诊断门禁 |
| [146-official-legacy-message-normalization.md](./08-implementation-log/146-official-legacy-message-normalization.md) | 官方 Legacy AgentMessage 无损规范化、产品适配边界与安装产物门禁 |
| [147-migrated-legacy-session-execution-differential.md](./08-implementation-log/147-migrated-legacy-session-execution-differential.md) | 迁移旧会话真实 Provider 继续执行、Extension 身份、重启与持久化差分闭环 |
| [148-mixed-history-mutation-and-fork.md](./08-implementation-log/148-mixed-history-mutation-and-fork.md) | Import Seed + V2 Event 树修改、引用修复、Fork、真实 CLI Provider 与重启闭环 |
| [149-seed-graph-and-atomic-publication.md](./08-implementation-log/149-seed-graph-and-atomic-publication.md) | Seed 完整图合同、统一损坏映射与会话文件原子发布 |
| [150-runtime-host-history-mutation-differential.md](./08-implementation-log/150-runtime-host-history-mutation-differential.md) | RuntimeHost 历史导航、切换、删除、替换、Fork、重启与 Provider 差分门禁 |
| [151-extension-history-command-differential.md](./08-implementation-log/151-extension-history-command-differential.md) | Extension Tree/Fork 真实 CLI 差分、执行上下文覆盖与持久化图修正 |
| [152-rpc-turn-terminal-and-recovery.md](./08-implementation-log/152-rpc-turn-terminal-and-recovery.md) | RPC Turn 唯一终态、Provider 失败/流断开/abort 恢复与安装产物门禁 |
| [153-active-turn-session-transition.md](./08-implementation-log/153-active-turn-session-transition.md) | 活动 Turn 会话切换、Turn 准入、所有权转移与安装产物门禁 |
| [154-rpc-command-drain-and-shutdown.md](./08-implementation-log/154-rpc-command-drain-and-shutdown.md) | RPC 已接收命令 drain、异步 Extension shutdown 与关闭事务 |
| [155-rpc-background-turn-ownership.md](./08-implementation-log/155-rpc-background-turn-ownership.md) | RPC 后台 prompt 所有权、Bridge 取消与关闭收敛 |
| [156-rpc-cancellable-long-operation-scope.md](./08-implementation-log/156-rpc-cancellable-long-operation-scope.md) | RPC 可取消长操作作用域、选择性 drain 与 Retry timer 所有权 |
| [157-awaitable-session-resource-close.md](./08-implementation-log/157-awaitable-session-resource-close.md) | Session 可等待关闭事务、子资源静默点与最终 ownership 释放 |
| [158-session-identity-resource-transition.md](./08-implementation-log/158-session-identity-resource-transition.md) | Session Identity 资源隔离、动态工具绑定与切换静默点 |
| [159-conversation-volatile-state-isolation.md](./08-implementation-log/159-conversation-volatile-state-isolation.md) | Conversation 易失状态、在途操作与工作区 Runtime 配置隔离 |
| [160-session-identity-transition-transaction.md](./08-implementation-log/160-session-identity-transition-transaction.md) | Session Identity prepare-before-commit、并发准入、失败恢复与真实 CLI 锁冲突差分 |
| [161-memory-rollover-transaction-and-mutation-admission.md](./08-implementation-log/161-memory-rollover-transaction-and-mutation-admission.md) | Memory Rollover prepare-before-commit、存储身份续接、同步写准入与树事务静默 |
| [162-session-capability-command-boundary.md](./08-implementation-log/162-session-capability-command-boundary.md) | Session 可变能力命令控制器、统一写准入、动态 Subagent 绑定与观察者隔离 |
| [163-session-continuity-contract-matrix.md](./08-implementation-log/163-session-continuity-contract-matrix.md) | Session replacement/continuation 四象限合同、可等待后台静默点与 Greenfield 观察者隔离 |
| [164-session-replacement-resource-transaction.md](./08-implementation-log/164-session-replacement-resource-transaction.md) | Switch/Fork replacement 资源合同、失败静默语义与 RPC fork 可发现性 |
| [165-session-replacement-admission-linearization.md](./08-implementation-log/165-session-replacement-admission-linearization.md) | Switch/Fork/Extension replacement 并发准入、FIFO identity 归属与唯一终态 Gate |
| [166-session-replacement-lifecycle-side-effects.md](./08-implementation-log/166-session-replacement-lifecycle-side-effects.md) | Replacement Extension/Hook 生命周期副作用、失败回滚与未提交目标清理 |
| [167-real-cli-replacement-lifecycle-gate.md](./08-implementation-log/167-real-cli-replacement-lifecycle-gate.md) | 真实 CLI Extension/Hook 联合时间线、项目配置与 EOF 生命周期门禁 |
| [168-session-replacement-commit-and-cleanup-contract.md](./08-implementation-log/168-session-replacement-commit-and-cleanup-contract.md) | Replacement 提交点、post-commit 清理诊断与 ownership 重试合同 |
| [169-retryable-runtime-shutdown-transaction.md](./08-implementation-log/169-retryable-runtime-shutdown-transaction.md) | Runtime/Composition/Extension/RPC 可重试最终关闭事务 |
| [170-initialization-rollback-transaction.md](./08-implementation-log/170-initialization-rollback-transaction.md) | Runtime/Composition/IM/Extension 初始化失败逆序回滚事务 |
| [171-real-cli-initialization-failure-gate.md](./08-implementation-log/171-real-cli-initialization-failure-gate.md) | 最终发布边界、MCP 失败子进程释放与真实 CLI 初始化失败门禁 |
| [172-ordinary-rpc-greenfield-default-cutover.md](./08-implementation-log/172-ordinary-rpc-greenfield-default-cutover.md) | 普通 RPC 中性 Greenfield 默认切换、完整能力适配与真实进程门禁 |
| [173-installed-ordinary-rpc-cutover-gate.md](./08-implementation-log/173-installed-ordinary-rpc-cutover-gate.md) | 普通 RPC 安装产物默认切换、完整能力恢复与 standalone 资产闭包门禁 |
| [174-automatic-legacy-fallback-policy.md](./08-implementation-log/174-automatic-legacy-fallback-policy.md) | 自动 Legacy 回退穷尽策略、结构化证据与迁移 failed 门禁 |
| [175-non-rpc-cli-intent-and-print-host-boundary.md](./08-implementation-log/175-non-rpc-cli-intent-and-print-host-boundary.md) | 非 RPC CLI 意图分流、中立 Print Host 合同与 Legacy 等价适配 |
| [176-greenfield-print-candidate-and-cli-differential.md](./08-implementation-log/176-greenfield-print-candidate-and-cli-differential.md) | Greenfield Print 显式候选、完整事件投影与标准 CLI 差分门禁 |
| [177-neutral-session-host-and-turn-orchestration.md](./08-implementation-log/177-neutral-session-host-and-turn-orchestration.md) | 中立 Agent Session Host、Turn/Retry 编排与 Print/RPC 外围分离 |
| [178-greenfield-print-production-parity-gate.md](./08-implementation-log/178-greenfield-print-production-parity-gate.md) | Greenfield Print 附件、工具、Provider 故障、Extension 与跨进程继续会话生产差分门禁 |
| [179-greenfield-print-default-cutover-and-artifact-closure.md](./08-implementation-log/179-greenfield-print-default-cutover-and-artifact-closure.md) | Greenfield Print 默认切换、统一会话目录与单文件图片能力闭环 |
| [266-dev-merge-and-greenfield-compatibility.md](./08-implementation-log/266-dev-merge-and-greenfield-compatibility.md) | 合并 dev 功能增量并保持 Greenfield 架构边界 |
| [297-runtime-subagents-production-kernel.md](./08-implementation-log/297-runtime-subagents-production-kernel.md) | Runtime Subagents 生产内核收敛 |
| [298-pi-manifest-compatibility-restoration.md](./08-implementation-log/298-pi-manifest-compatibility-restoration.md) | `pi` 资源清单兼容合同恢复 |

## 维护约定

- 每一轮已验证实施对应一个文件，编号递增，文件名用英文短 slug。
- 单文件只记录该轮：目标、修改范围、明确未修改、测试、结果、未解决问题、下一步。
- 不把多轮修改合并进同一文件；本索引保持轻量，细节只写在对应轮次文件中。
