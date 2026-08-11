# 第 239 阶段：Settings Domain Runtime 重写

## 阶段目标

在不改变用户设置格式和可观察行为的前提下，拆解旧 1041 行 `core/settings-manager.ts`，建立独立的设置合同、持久化边界、迁移与校验、状态事务和调用方视图；迁移全部生产调用方并删除旧实现，不保留转发壳。

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

设置是宿主能力，不属于 Agent 执行内核。旧实现把设置模型、文件锁、兼容迁移、合并、持久化、错误队列、局部刷新和八十余个业务 getter/setter 集中在单个具体类中，使 Session、资源、CLI、SDK 和 Desktop 同时依赖该类。本阶段把调用方改为依赖组合合同 `SettingsRuntime`，具体文件系统只存在于 Storage Adapter；新领域没有回接 `src/core`。

这里的 `Runtime` 表示一组可组合设置能力，不是对旧 Manager 的改名。旧类已经删除，公开入口也不再提供兼容转发。

## 实施内容

### 1. 设置合同与调用方视图

- `settings/contracts/settings-document.ts` 只保存持久化文档和值对象。
- 生命周期、模型、Session、资源和宿主设置分别由独立 Port 表达，`settings-runtime.ts` 只负责组合这些能力。
- `settings/views` 将稳定的读取与写入语义投影给不同调用方，调用方无需知道 JSON、文件锁或合并算法。
- 最大实现文件为 194 行，避免再次形成集状态、IO、迁移和业务 API 于一体的大文件。

### 2. Storage、State 与并发写入

- `FileSettingsStorage` 持有全局/项目路径、文件创建和 `proper-lockfile` 锁定；`MemorySettingsStorage` 支撑纯内存组合与测试。
- `SettingsState` 只管理 global/project/effective 三层状态、错误队列、写队列与局部 reload。
- 写入时在锁内重新读取磁盘，只覆盖本次变更字段；嵌套块按字段级 change set 合并，保留用户或其他进程刚写入的同级字段。
- `flush()` 保留异步写队列的完成边界；加载失败时继续保留错误并阻止覆盖损坏文件。

### 3. 迁移与 TypeBox 边界

- 旧 `queueMode`、`websockets` 和对象形式 `skills` 的兼容迁移集中在 `migration/migrate-settings.ts`。
- TypeBox 只校验磁盘 JSON 这个不可信边界；已类型化的内部 Port 和状态不重复校验。
- Schema 对已知字段执行类型约束，同时允许未知字段通过并在后续写入中保留，避免新版本覆盖旧版本或插件扩展字段。
- 本阶段不引入 Zod；一个校验库足以覆盖该边界。

### 4. 调用方与公共边界迁移

- CLI、SDK、AgentSession、资源 Host、Greenfield Adapter 和 Desktop Host 全部切换到 `SettingsRuntime` 合同。
- 新增显式 `@vetta/coding-agent/settings` 子路径；`host-services` 可向宿主暴露同一合同。
- 包根不再聚合导出设置实现，宿主服务参数从 `settingsManager` 改为 `settings`，防止新公共 API 延续旧 Manager 语义。
- 删除 `core/settings-manager.ts` 和对应旧结构测试文件名，不保留 shim；设置示例改用新入口。

## 行为兼容性验证

- 既有设置行为测试迁移到新合同，继续覆盖全局/项目优先级、默认值、读写、reload、错误队列、迁移、锁定写入和并发外部编辑。
- 新增边界测试，覆盖旧设置字段迁移、已知字段类型错误、未知顶层字段保留和嵌套块外部同级变更保留。
- 公共子路径测试验证 `settings` 与 `host-services` 提供相同合同，包根不暴露 `SettingsRuntime`，旧深层入口已经移除。
- 本阶段 12 个定向测试文件共 147 项全部通过。
- 额外执行的 3 项既有 AgentSession 分支测试因环境条件跳过，不计入上述 147 项通过数。
- `check:quick` 与完整 `bun run check` 均通过；完整检查包含 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 旧实现依赖变化

| 指标 | 第 238 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 107 | 97 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 144 | 143 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

设置域的 10 条旧依赖边与唯一旧文件已经清零。审查基线已机械更新；后续重新引入旧路径、重建旧文件或增加 Runtime 反向依赖都会被质量守卫拒绝。

## 尚未完成的替换

- 全仓仍有 97 条生产代码到旧实现的依赖和 143 个旧实现文件，最终目标尚未完成。
- 当前最大剩余域是 Session（17）、SessionManager（14）和 ModelRegistry（8）。下一阶段宜整体处理 Session Persistence：先建立中立会话文档、目录、分支读取与写入事务合同，再迁移 `SessionManager` 调用方并删除旧 Manager；不要直接继续扩展 `AgentSession`。
- 旧文档只记录历史过程，不作为新架构约束；后续继续新增阶段实施记录，不反复改写既有过程文档。
