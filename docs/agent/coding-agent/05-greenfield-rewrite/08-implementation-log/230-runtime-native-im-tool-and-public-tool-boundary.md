# 第 230 阶段：Runtime 原生 IM Tool 与公共 Tool 边界

## 阶段目标

把剩余 RPC/IM Tool 实现迁入 `runtime-tools`，让 CLI/RPC 直接消费原生 Registration；同时退役 `coding-agent` 包根和 RPC 子路径对具体内置 Tool 的聚合导出，并删除只展示旧 API 的示例。本阶段只重构所有权与依赖方向，不改变工具名称、描述、Schema、scope、文件校验、宿主发送、输出或错误语义。

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

`im_send_attachment` 是由 IM Host 提供副作用能力的 Tool，不属于 Agent 内核，也不应由 `coding-agent/src/core/tools` 持有。现在它的 Schema、TS 描述、文件校验、Runtime Tool 与 Registration 全部位于 `runtime-tools/src/coding/tools/im-send-attachment/`；`coding-agent` 只保留中立 `ImHostBridge` 协议与显式 Legacy RPC 协议转换，CLI 组合根直接注入当前宿主发送实现。

包根旧 Tool 工厂、单例和类型聚合出口不属于稳定 Session 合同，因此按固定目标删除。工具功能没有被删除：生产组合仍从 `runtime-tools` 注册相同工具；只有依赖旧内部结构的 API 和示例退出。

## 实施内容

- 新增 Runtime 原生 `im_send_attachment` Tool，使用 TypeBox 固化模型输入边界，并通过 `ImSendAttachmentSender` 与 `ImSendAttachmentFileOperations` 注入宿主副作用。
- CLI Greenfield RPC 直接注册原生 Tool；显式 Legacy RPC Adapter 在最外层把 Runtime Tool Result 转成旧 `AgentTool` Result，不让 Runtime 反向依赖旧合同。
- 将 `ImHostBridge` 移到 RPC 中立能力合同，RPC 公共入口只导出协议，不再导出具体 Tool 工厂。
- 删除旧 IM Tool 实现与结构测试；新增 Runtime 行为测试覆盖元数据、成功发送、相对路径、文件不存在、目录输入和宿主配额错误。
- 从包根删除所有具体内置 Tool 工厂、单例和实现类型导出；删除只展示旧包根 SDK/Tool 或旧 Extension Tool 装配的示例。
- 增加公共 Tool Surface 审查规则和独立质量测试，阻止具体 Tool 实现重新从 `coding-agent` 包根或 RPC 子路径回流。

## 旧实现依赖变化

| 指标 | 第 229 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 187 | 181 | 0 |
| Tool 域旧依赖 | 6 | 0 | 0 |
| Knowledge 域旧依赖 | 6 | 6 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 182 | 181 | 0 |
| 旧 SDK 示例 | 1 | 0 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

6 条 Tool 域旧依赖已全部删除：包根 `core/tools` 聚合出口 1 条、知识 Tool 直出 3 条、RPC Host Bridge/Tool 直出 2 条。旧 IM Tool 实现文件和唯一旧 SDK 示例同步删除；Tool 域现为零，审查基线会拒绝其回流。

## 行为兼容性验证

- Runtime Tools 共 20 项定向测试通过，其中原生 IM Tool 6 项覆盖完整成功与失败行为，能力 Tool 与产品 Tool 合同继续通过。
- Coding Agent 公共 API、旧 SDK 示例归零、RPC Bridge 与 Legacy RPC Adapter 共 8 项测试通过。
- CLI IM RPC Adapter 与真实 Provider 差分共 26 项测试通过；附件 Host Bridge 完成 Tool Call、Tool Result 与第二次模型调用往返。
- 公共 Tool Surface 与重写治理共 9 项质量测试通过，全仓包边界扫描通过。
- `bun run check:quick` 与完整 `bun run check` 均通过；Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫无错误。

## 尚未完成的替换

- 仍有 181 条生产代码到旧实现的精确依赖，目标为零；Tool 域已归零，不应再作为下一阶段迁移对象。
- Knowledge 域仍有 6 条旧依赖，应优先把知识读取、标签查询和知识模式组合迁到独立知识能力边界。
- 旧实现文件仍为 181 个；后续必须按域建立生产替代和行为合同后删除，不能只移动目录。
- 8 个旧格式边界及其中 3 条旧实现依赖仍需独立审计；旧数据兼容必须与旧执行代码分离。
