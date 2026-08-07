# 第 295 轮：生产兼容边界收口

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

本轮一次性完成与旧架构相关的生产兼容代码复查和收口，不把已识别的清理项留到下一阶段。生产执行路径中不再保留源代码级兼容垫片或 `Greenfield` 迁移身份；保留下来的兼容能力均有独立产品合同，不依赖旧执行架构。

## 兼容边界分类

### 已删除

- 删除 `ExtensionSessionWriter.isPersisted()`。该方法只服务迁移期调用方式，正式 Session Setup 合同只暴露 `appendMessage()`；
- 删除 `ExtensionSessionSetup` 的 bivariant source-compatibility 类型技巧，恢复普通、可读的函数合同；
- 清除 Runtime Core、Runtime Storage 和 Coding Agent 生产源码中的非协议 `Greenfield` 注释、诊断和错误措辞；
- 将 Coding Agent 中剩余 7 个 `greenfield-*.test.ts` 文件按实际职责重命名，不再用迁移身份组织生产行为测试。

### 刻意保留

- `host/extensions/compatibility/*`：它实现当前 Extension Profile 与 Runtime capability 的协商和显式拒绝，不是旧架构 fallback；
- `sessions/legacy/*`、Runtime Storage 的旧格式 reader/migration 及 CLI session format compatibility：它们只在持久化边界读取用户历史会话，不参与新会话执行；
- CLI Runtime Host 的 `"greenfield"` / `"greenfield-print"`、RPC Profile 的 `"greenfield"` / `"greenfield-im"`、历史迁移结果和 SDK 错误码中的同名值：它们是已发布 wire/data contract，修改需要独立协议版本迁移；
- 历史行为 fixture 与兼容性测试：只验证用户可观察语义，不允许生产代码调用旧实现。

## 实施内容

### Session Setup 合同

- `ExtensionSessionWriter` 收敛为只写入消息的最小端口；
- Session Setup Writer 和相关测试同步移除持久化状态探测；
- Changelog 将此项记录为内部扩展 API 的 Breaking Change。

### 生产身份与诊断

- 生产注释和诊断统一采用 `Runtime`、`CodingAgent`、`native conversation` 等正式职责名称；
- 保持既有错误类型、事件结构、会话格式和退出语义；
- 修复清理过程中发现的一处 disposed 错误文本大小写回归，恢复冻结的 CLI 可观察错误文本。

### 测试稳定性

- CLI 进程级锁冲突测试原本使用 Vitest 默认 5 秒上限，在全量并行执行时会出现假超时；
- 为该既有集成测试设置与同文件其他进程级测试一致的 30 秒上限，不改变断言或生产行为。

### 类型校验判断

本轮没有新增外部不可信结构化输入，也没有改变 JSON、RPC、Provider、Tool 或持久化 Schema，因此不引入 TypeBox 或 Zod。静态合同继续由 TypeScript 表达，现有外部数据边界继续使用原有解析器。

## 防回退门禁

`check-coding-agent-migration-residue.mjs` 新增并锁定以下零基线：

- `codingAgentGreenfieldTestFiles=0`：Coding Agent 生产行为测试不得重新使用 Greenfield 迁移文件名；
- `unclassifiedProductionGreenfieldOccurrences=0`：产品生产源码只允许白名单中的冻结协议值，其他 Greenfield 迁移措辞全部拒绝；
- `sourceCompatibilityShimReferences=0`：不得重新引入 `isPersisted` 或 bivariant source-compatibility 垫片。

冻结协议值按“精确字面量 + 所属文件”列入白名单，不使用宽泛忽略规则。门禁测试覆盖违规引用、违规文件名、非白名单迁移措辞以及白名单协议值的正反例。

## 旧实现依赖变化

- 生产执行路径中的旧实现调用：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- Runtime Core 迁移文件：保持 `0`；
- 产品 Runtime 迁移类型标识符：保持 `0`；
- Coding Agent Greenfield 测试文件：`7 -> 0`；
- 未分类生产 Greenfield 引用：收敛为 `0`；
- 源代码兼容垫片引用：收敛为 `0`；
- 用户可见协议和功能变化：`0`。

## 行为兼容性验证

- 迁移残留门禁测试：27 项通过，全部架构残留指标为 `0`；
- Runtime Core 全量测试：29 个文件、139 项通过；
- Runtime Storage 全量测试：19 个文件、94 项通过；
- Coding Agent 全量测试：137 个文件、935 项通过，另有 1 个文件、17 项按既有条件跳过；
- CLI 全量测试：34 个文件、183 项通过；
- Desktop 相关定向测试：2 个文件、5 项通过；
- `bun run check:quick` 通过；
- 根级 `bun run check` 通过，包括 Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫；
- 本轮未发送外部真实模型请求；协议、工具、会话迁移和宿主行为由本地合同、进程级集成测试和独立可执行产物测试验证。

## 尚未完成的替换

本轮没有把已识别的旧架构兼容清理项延期。仍保留的 Legacy reader/migration、Extension capability compatibility 和冻结 wire 值分别属于用户数据、能力协商和外部协议边界；它们不是旧执行架构残留，也不能在没有版本迁移方案时删除。
