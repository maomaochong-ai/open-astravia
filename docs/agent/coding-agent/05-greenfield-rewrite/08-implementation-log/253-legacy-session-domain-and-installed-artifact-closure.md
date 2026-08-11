# 第 253 阶段：历史会话兼容域与安装产物闭环

## 阶段目标

在不改变 CLI、Desktop、SDK、RPC、IM 的会话发现、读取、重命名、删除、迁移、恢复和 fork 行为的前提下，将真实历史 Coding Agent JSONL 兼容能力从运行时 Adapter 杂项中收口到独立 Session 子域，并用安装后的 `vetta` 可执行文件验证第 252 阶段的原生 setup seed 链路。

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

- 历史会话兼容是 Session 数据边界，不是 Greenfield 执行 Adapter；其正确所有者是 `packages/coding-agent/src/sessions/legacy`。
- `sessions/legacy` 只依赖 Session 合同、Session 投影、产品配置和中立的 `runtime-storage` 历史格式解析/迁移能力，不依赖 `AgentSession`、`SessionManager` 或执行后端。
- native setup 与历史导入必须共享相同的 Session entry 到 Conversation entry 投影策略，避免两套 custom 可见性、compaction summary 和扩展 AgentMessage 规则漂移。
- 兼容域允许保留历史数据修改能力，但必须显式冻结。目前只有重命名的 1 次 `appendFile` 与删除会话/锁文件的 2 次 `rm`，不能把它们误报为完全只读。

## 本阶段实施内容

### 1. 历史会话兼容域归位

- 将 catalog、document parser、header reader、history reader、lease、entry normalizer、migration 和模块出口从 `adapters/runtime-core` 迁移到 `sessions/legacy`。
- 将会话分支重建与 Runtime History 投影从 Adapter 移到 `sessions/projection/session-history.ts`，消除 `sessions/legacy -> adapters/runtime-core` 反向依赖。
- `adapters/runtime-core` 只保留兼容导出，不再拥有历史格式实现；HTML export、测试和内部消费者改为依赖新的 Session 所有权边界。
- 旧目录、旧 migration 文件和旧 normalizer 文件加入退役清单，恢复时质量门禁失败。

### 2. native/legacy 投影策略统一

- `session-document-entry.ts` 统一拥有扩展 AgentMessage 的 TypeBox 校验、Conversation context 投影、完整身份恢复、custom message 模型可见性和 compaction summary message 构造。
- 历史 entry normalizer 只负责识别历史 record 并调用统一投影，不再复制消息 schema 和投影算法。
- Bash SDK 与 RPC 直接使用稳定的 `CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE`，运行态代码不再依赖带 Legacy 名称的 normalizer。
- 新增 native 与 historical message/custom/compaction entry 的逐项等价测试。

### 3. 历史兼容统计门禁

- 兼容边界按 readers、migrations、host adapters、module entries 分类，任何新增 `sessions/legacy` 文件若未分类会失败。
- 统计基线由过去漏计后的 8 个文件纠正为 11 个：4 readers、3 migrations、3 host adapters、1 module entry；`unclassified=0`。
- 冻结历史 Session 数据修改调用：`appendFile=1`、`rm=2`，新增写 API、调用点或数量变化均失败。
- 继续维持 Legacy execution edge、native setup migration edge、format-to-old edge 全部为 0。

### 4. 安装后 vetta CLI 验收

- 扩展命令通过真实 `ctx.newSession({ setup })` 写入 session name 和 user message。
- 测试等待异步扩展命令完成，验证目标只含原生 `conversation.seed`，不含 `conversation.import.seed`，且没有生成旧格式 JSONL。
- 使用安装后 RPC 恢复 seeded session，验证 setup 消息可读；随后从 seeded message fork，并再次以独立可执行文件恢复 fork 目标。
- 既有安装产物测试继续覆盖真实历史 v1-v3 会话迁移、重启复用与不可表示格式的显式失败。

## 旧实现依赖变化

| 指标 | 本阶段前 | 本阶段后 | 说明 |
| --- | ---: | ---: | --- |
| `adapters/runtime-core` 内历史格式实现文件 | 9 | 0 | 实现所有权迁入 Session 子域 |
| 已分类历史兼容边界 | 8 | 11 | 修正此前漏计，不是新增兼容能力 |
| 未分类历史兼容文件 | 未统计 | 0 | 新增硬门禁 |
| 历史 Session 数据修改调用 | 未统计 | 3 | `appendFile=1`、`rm=2` |
| Legacy execution edge | 0 | 0 | 保持归零 |
| native setup migration edge | 0 | 0 | 保持归零 |
| format-to-old edge | 0 | 0 | 保持归零 |

## 行为兼容性验证

- Coding Agent 定向测试：5 个文件，42 项通过，2 项按环境跳过。
- Runtime Storage 历史文档投影测试：1 个文件，3 项通过。
- 质量门禁定向测试：2 个文件，69 项通过。
- 安装后独立 `vetta` 可执行文件定向测试：1 项通过，覆盖 Extension setup、native seed、进程重启、fork 与再次恢复。
- `bun run check:quick` 通过。
- `bun run check` 的全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫通过。

## 尚未完成的替换

- 历史 JSONL 兼容仍服务真实用户数据，不能为了目录或数字归零直接删除；未来删除必须先定义兼容期限、数据迁移策略和用户可恢复方案。
- 本阶段收口的是历史会话数据边界，不改变 Tool、MCP、Skill 等独立能力包的所有权，也不把它们重新搬入 `coding-agent`。
- 后续阶段应审计 `runtime-host` 对历史兼容类型的公开暴露是否还能进一步缩窄，并验证 Desktop 安装产物对历史会话目录的发现、重命名和删除行为。
