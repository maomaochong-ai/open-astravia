# 第 240 阶段：Session Read Model 与 Legacy 格式隔离

## 阶段目标

在不改变会话历史、Extension、SDK 和宿主目录行为的前提下，建立不依赖旧 `SessionManager` 的 Coding Agent Session 读取合同与投影；同时把旧 JSONL 的识别、解析、目录、历史、锁和 setup 兼容全部限制在独立格式边界中。

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

旧 `SessionManager` 同时承担数据类型、树投影、模型上下文、文件目录、JSONL、锁和 Extension 写入合同，导致 Greenfield 运行时即使使用原生 Conversation Storage，仍需引用旧具体实现。本阶段先把稳定 Session 语义从旧执行对象中抽出，再让 Legacy JSONL 只作为明确的数据迁移边界存在。

本阶段没有把持久化搬回 `coding-agent`：原生 Conversation 的 Repository、Document Store、目录和迁移仍由 `runtime-storage` 持有。`coding-agent/src/sessions` 只包含产品层会话合同和纯投影。

## 实施内容

### 1. 独立 Session 合同与纯投影

- 新增 `src/sessions/contracts`，定义 Entry、Header、Tree、Context、只读 View 与 Writer 合同。
- 新增分支、Label、Tree、模型上下文和 Compaction 投影；这些函数只消费值对象，不获取文件锁、不读取磁盘，也不持有活动 Agent。
- Extension 会话合同改为复用上述结构类型；`newSession.setup` 所需的 `isPersisted()` 被明确保留在兼容 Writer，而不是泄漏具体 Manager。
- Greenfield Context、Compaction、Branch Navigation、History 和只读 Extension View 全部切换到新合同。

### 2. Legacy JSONL 格式边界独立化

- `legacy-session-format/document.ts` 复用 `runtime-storage` 的旧格式 Reader，并在 Coding Agent 边界恢复历史扩展消息；不复制 Conversation 持久化实现。
- Catalog 自行完成旧 JSONL 发现、元数据投影、排序、命名和删除，不再实例化 `SessionManager`。
- History Reader 直接把只读文档投影为现有 `HistoryEntry`，保持不获取写锁的行为。
- Lease 在格式边界内实现相同的排他创建、活进程检测、陈旧锁回收和幂等释放，不再回接旧 `core/session-lock.ts`。

### 3. Extension setup 与 SDK 兼容输入

- 新增单一职责的临时 `LegacySessionSetupWriter`，实现既有 Extension setup 可见的写入、分支、Label、Session 名称、持久化查询和临时文件快照行为。
- setup 结束后仍通过 `runtime-storage` 严格迁移到原生 Conversation V2；临时 Legacy 文件不会成为活动 Session 的存储。
- SDK 的旧 `sessionManager` 参数在 Host Adapter 内改为结构化快照 Port；上下文由纯 Session 投影构建，调用方仍可传入原具体 Manager，但新适配代码不依赖其类型或实现。

### 4. 校验边界选择

- 本阶段没有新增 Zod 或重复 TypeBox Schema。
- 不可信 JSONL 已由 `runtime-storage` 的 Legacy Reader / Import Analyzer 使用 TypeBox 校验；Coding Agent 内部 Session 投影只处理已解析的值对象，再次校验不会增加有效安全边界。

## 行为兼容性验证

- 新增 Legacy 格式边界测试，覆盖目录过滤、首末消息摘要、活动时间、父会话元数据、重命名、锁释放、单写者 lease 和 setup Writer。
- 新增 Session 投影测试，覆盖分支选择、有效模型、Tree/Label 与 Compaction kept tail。
- 既有 Active Session Transition、SDK Storage、Greenfield Context、Compaction、Branch Navigation、History Adapter 和 Legacy normalizer 测试继续通过。
- 两轮定向测试共 10 个测试文件、50 项通过。
- `check:quick` 与完整 `bun run check` 均通过；完整检查覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫，Legacy 格式边界到旧实现的依赖为 0。

## 旧实现依赖变化

| 指标 | 第 239 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 97 | 83 | 0 |
| `session-manager` 域旧依赖边 | 14 | 1 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 143 | 143 | 0 |
| Legacy 格式边界到旧实现的依赖边 | 3 | 0 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

治理基线已按当前依赖图机械更新。Session Manager 域仅剩 `src/index.ts` 对旧公开 API 的兼容导出；任何 Greenfield、Extension、SDK Storage 或 Legacy 格式模块重新引用旧实现都会被守卫拒绝。

## 尚未完成的替换

- 包根仍导出旧 `SessionManager`、旧 Entry 类型和格式辅助函数；它们不能在新生产实现中继续扩散。
- 旧 `AgentSession` 内部仍直接组合旧 `SessionManager`，因此不能在本阶段孤立删除 13 个旧会话文件，否则会造成真实功能退化。
- 下一阶段应把旧 `AgentSession` 与 `SessionManager` 作为一个执行闭环处理：先审计包根、CLI、RPC 和兼容 SDK 的实际消费者，再由 Greenfield Session 门面替代公开执行路径，迁移仍需保留的格式辅助能力，最后联合删除旧执行对象与其会话目录。
- 全仓仍有 83 条旧实现依赖和 143 个旧实现文件，最终目标尚未完成。
