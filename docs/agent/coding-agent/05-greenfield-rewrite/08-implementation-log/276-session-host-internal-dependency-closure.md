# 第 276 轮：Session Host 内部依赖闭合

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

第 275 轮后仍存在最后 1 个 Adapter -> Composition 反向依赖，同时 Session Host 内部通过公开 API
取得 Turn 执行与 Extension 命令能力。公开 API 应当是包外消费者的稳定门面，不应成为包内依赖中介；
Adapter 也不应反向拥有 Composition 策略。

本轮把这些职责归入 `src/host` 下的明确领域：

- `host/session-transition`：Session seed 与新会话切换合同；
- `host/session-execution`：Turn 执行、失败读取与重试控制；
- `host/extensions`：Extension 命令合同、命令动作转换与命令 Host。

Composition 只编排这些 Host 能力，公开 API 只向外重导出稳定合同和工厂。该调整消除了最后一条
Adapter -> Composition 反向边，也消除了 Composition -> public API 的内部倒置，没有改变 Tool、Extension、
重试或会话切换行为。

## 实施内容

### 建立稳定的 Session Host 内部合同

Session seed、新会话选项、Turn executor、retry controller、Extension command/event host 等合同迁入对应
`src/host` 领域。`active-session-transition-host`、`process-session-host`、`extension-session-host`、SDK Session
Host 与 RPC capability 直接依赖这些内部合同，不再通过 `public-api/runtime` 反向取得实现。

`public-api/runtime/turn.ts` 与 `public-api/runtime/extensions.ts` 保持既有公开能力，但职责收窄为向外暴露稳定
类型与工厂。包内实现不再依赖公开门面。

### 删除迁移期 Adapter 实现

以下旧 Adapter 文件已经删除，且没有保留 forwarding module：

- `greenfield-extension-command-actions-adapter.ts`；
- `greenfield-extension-command-host.ts`；
- `greenfield-turn-executor.ts`；
- `greenfield-turn-retry-controller.ts`。

原有命令动作转换、命令调用、失败读取、退避重试、取消、事件发布和执行顺序均由新的 Host 领域实现承接。
测试改为通过稳定公开门面或 Host 合同验证行为，不再耦合旧 Adapter 路径。

### 收紧迁移残留门禁

迁移审查脚本新增并固定以下约束：

- Adapter 中 `greenfield` 文件不超过 38；
- Composition 中 `greenfield` 文件不超过 30；
- Adapter -> Composition 反向依赖文件必须为 0；
- Composition -> public API 内部依赖文件必须为 0；
- 本轮删除的 4 个 Adapter 文件及模块引用必须保持为 0。

门禁测试补充旧 Session Host 路径恢复和 Composition -> public API 边增长场景，防止后续通过转发文件或
内部公开门面依赖恢复迁移结构。

本轮没有引入 TypeBox 或 Zod。变更只移动已经处于 TypeScript 合同内的内部对象，没有新增不可信 JSON、
网络响应或配置反序列化边界；运行时 Schema 校验在这里不会增加有效保障。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- Adapter 中 `greenfield` 文件：`42 -> 38`；
- Composition 中 `greenfield` 文件：保持 `30`；
- Adapter -> Composition 反向依赖文件：`1 -> 0`；
- Composition -> public API 内部依赖文件：`2 -> 0`；
- 本轮 4 个旧 Adapter 实现文件：`4 -> 0`；
- 本轮 4 个旧模块路径引用：`0`，并新增永久禁止规则；
- 新生产代码没有调用旧 Coding Agent 实现，也没有增加兼容入口。

## 行为兼容性验证

本轮相关行为定向测试：

```text
6 files passed
24 tests passed
```

覆盖 Extension 命令动作、Extension 命令 Host、Turn executor、Session seed 初始化、RPC capability 与 SDK
Session 集成。

Coding Agent 完整包测试：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

质量门禁测试：

```text
9 files passed
117 tests passed
```

`bun run check:quick` 与根级 `bun run check` 均通过；根级检查包含全仓 Biome、根 tsgo、CLI typecheck、
Desktop 独立 tsc、Admin tsc 和全部质量门禁。

跨宿主验收在保持全部测试范围、仅串行化 Go 包和用例后通过：

```text
GOFLAGS="-p=1 -parallel=1" bun run verify:agent-hosts
ok (coding-agent, CLI, Desktop, IM)
```

默认包内并发下，两次验收分别在不同微信传输测试的 `t.TempDir` 自动清理阶段发生 Windows 目录非空竞争；
其中一个失败用例单独运行通过。该现象没有业务断言失败，串行化后同一完整验收范围通过。本轮没有修改 IM
实现或测试来掩盖这项既有基础设施风险。

## 尚未完成的替换

- Adapter 中仍有 38 个、Composition 中仍有 30 个 `greenfield` 文件；应继续按真实所有权审计，而不是
  仅为减少数量批量改名；
- SDK Session capability 对 Adapter 层的 Turn 失败读取与重试依赖已经移除，但仍使用消息投影 Adapter；
  下一阶段应判断该投影是否是真实外部协议边界；
- Extension Event/Action Host 仍位于 Adapter 层，需要区分外部 Extension 协议转换与包内 Host 策略，
  只迁移不属于边界适配的部分；
- 部分测试文件与内部类型仍保留 `Greenfield` 名称。命名清理不能先于职责审计，也不能改变公开兼容性；
- Windows 下 IM Go 测试的临时目录清理竞争仍是独立稳定性问题，不属于本轮 Coding Agent 架构迁移范围。

下一阶段应从剩余 Adapter 清单开始，逐个证明其是否连接真实外部协议/宿主边界。真正的 Adapter 保留，
包内策略迁入对应 Host 或能力领域；同时保持公开 API、CLI、Desktop、IM 行为基线与迁移残留门禁。
