# 第 275 轮：SDK Session Host 归属收口

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

本阶段处理第 274 轮识别出的 5 个 Adapter -> Composition 反向依赖中的 SDK Session Host 集群。
此前 `src/host/sdk-session` 只是外层门面，Session 合同、存储目标、Runtime 绑定、工厂、事件投影和
capability host 实际散落在 `src/adapters/runtime-core` 与 `src/composition`。这种结构让产品宿主所有权、
通用 Runtime 组合和边界适配无法区分。

本轮把 SDK Session 专属实现归入 `src/host/sdk-session`，同时保留通用 Runtime Composition 与活动会话
事务在 `src/composition`。这不是架空 `coding-agent`，而是让其内部按稳定 Session 合同、产品 Host 和
能力编排形成明确所有权。

## 实施内容

### 收口 SDK Session Host 所有权

将以下职责从 Adapter/Composition 迁入 `src/host/sdk-session`：

- SDK Runtime 合同与 Runtime Session 绑定；
- SDK Session 存储目标和创建工厂；
- 固定 Session 与活动 Session 门面；
- Session capability host 与活动 Session capability host；
- Runtime 观察事件到 SDK 事件的投影。

旧目录没有保留 forwarding module。生产代码、公开 Session 门面和相关测试都直接引用新的 Host 所有权
路径，9 个旧 SDK 文件路径及其引用被加入迁移残留门禁，禁止以后以兼容包装形式恢复。

### 拆分 Session Capability Host 内部职责

归位后的 `session-capability-host.ts` 触发现有 400 行 Host 模块门禁。没有放宽门禁，而是拆出：

- `session-capability-options.ts`：Host 配置与设置合同；
- `session-model-capabilities.ts`：模型选择、模型循环与思考级别策略；
- `session-capability-projections.ts`：Tool、消息和 Session 统计投影。

主体 Host 从 516 行降到 319 行，继续实现同一个 `GreenfieldSdkSessionCapabilityPort`，对外方法、类型、
异常和执行顺序不变。

本轮没有引入 TypeBox 或 Zod。变更没有新增不可信 JSON、配置文件或网络输入边界；现有值均已处于编译期
合同内，为内部委托再增加运行时 Schema 不会提高安全性。

### 收紧迁移残留门禁

`check-coding-agent-migration-residue.mjs` 的不可回退基线更新为：

- Adapter 中 `greenfield` 文件不超过 42；
- Composition 中 `greenfield` 文件不超过 30；
- Adapter -> Composition 反向依赖文件不超过 1；
- 旧 Tool Adapter 与 9 个旧 SDK Session 文件、模块引用必须保持为 0。

新增 SDK Session 旧路径回归测试，确保后续不能通过恢复旧文件或转发引用绕过所有权边界。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- Adapter 中 `greenfield` 文件：`47 -> 42`；
- Composition 中 `greenfield` 文件：`34 -> 30`；
- Adapter 反向引用 Composition 的文件：`5 -> 1`；
- 旧 SDK Session 实现文件：`9 -> 0`；
- 旧 SDK Session 模块引用：`0`，并新增永久禁止规则；
- 新生产代码没有调用旧 Coding Agent 实现，也没有增加兼容入口。

## 行为兼容性验证

SDK Session 定向基线在迁移前后保持一致：

```text
5 files passed
34 tests passed
```

覆盖固定/活动 Session、内存与文件存储、恢复、队列、重试、资源生命周期、失败回滚、动态 Skill、
Extension、自定义 Tool 和公开 SDK 入口。

Coding Agent 完整包测试：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

质量门禁测试：

```text
9 files passed
116 tests passed
```

`bun run check:quick` 与根级 `bun run check` 均通过；根级检查包含全仓 Biome、根 tsgo、CLI typecheck、
Desktop 独立 tsc、Admin tsc 和全部质量门禁。

跨宿主验收通过：

```text
GOFLAGS=-p=1 bun run verify:agent-hosts
ok (coding-agent, CLI, Desktop, IM)
```

默认并行 Go 包执行曾两次在 `TestTransport_QuotedReplyFormatting` 的 `t.TempDir` 自动清理阶段发生 Windows
目录非空竞争；该测试单独运行通过，使用 `-p=1` 串行 Go 包后，同一完整验收范围全部通过。本轮没有修改
IM 实现或测试来掩盖该独立基础设施问题。

## 尚未完成的替换

- Adapter -> Composition 反向依赖还剩 1 个文件：Extension Command actions adapter；下一阶段应判断其
  合同应归入 Extension Host 还是稳定 Runtime Session 控制合同；
- Adapter 中仍有 42 个、Composition 中仍有 30 个 `greenfield` 文件，需要按真实职责继续收口，而不是
  仅做批量改名；
- SDK Session 内部类型仍保留 `Greenfield` 名称以避免本阶段同时改变公共/内部类型表面；职责稳定后可按
  导出兼容性分批收敛命名；
- `session-capability-host` 仍调用三个 Runtime Adapter 层的消息投影、Turn 执行失败读取和重试控制器，
  需要后续分别判断它们是稳定 Runtime 支持能力还是产品 Host 策略；
- Windows 下 IM Go 多包并行测试的临时目录清理竞争应作为独立稳定性问题处理，不应混入架构迁移。

下一阶段优先处理最后 1 个 Adapter -> Composition 反向依赖。该边界归位后，再审计 SDK Session Host 对
Runtime Adapter 支持模块的依赖，避免以目录移动代替真实的依赖方向收敛。
