# 第 277 轮：Extension Host 所有权闭合

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

第 276 轮消除了 Adapter -> Composition 与 Composition -> public API 反向边，但 Extension 的 Action Host、
Event Host 仍位于 Adapter，Session Host 仍位于 Composition。它们负责会话状态、命令动作、Extension Runner
生命周期、事务回滚和资源释放，不执行外部协议转换，因此原目录不能表达真实所有权。

本轮把三类 Host 统一归入 `src/host/extensions`，同时将 Extension Session Host 使用的纯会话切换生命周期
合同归入 `src/host/session-transition`。Composition 只保留 Active/Process Session 的产品装配，Adapter 只保留
Runtime 与 Extension 协议之间的转换。

## 实施内容

### 收口 Extension Host

新增并归位以下实现：

- `host/extensions/action-host.ts`：Extension actions、异步动作收敛和错误上报；
- `host/extensions/event-host.ts`：Runner、执行上下文、资源发现、事件订阅和清理生命周期；
- `host/extensions/session-host.ts`：活动 Extension Session、命令绑定、切换事务与 reload 回滚；
- `host/extensions/contracts.ts`：对外只提供稳定 Event/Session Host 合同和工厂所需类型。

具体 Event/Session Host 实现类不再作为公共构造器暴露。`public-api/runtime/extensions.ts` 通过稳定类型与工厂
提供宿主能力，CLI 改为使用 Runtime API 创建 Extension Session Host，不再从 Composition 获取该实现。

### 上移 Session Transition 生命周期合同

`CodingAgentSessionTransition`、prepared binding、decision 和 lifecycle 迁入
`host/session-transition/contracts.ts`。Active Session Composition 继续持有 backend、catalog、session options 等
产品装配选项，但 Extension Host 和 SDK Extension transition 不再依赖 Composition 内部合同。

### 保留真实 Adapter

本轮明确保留：

- Extension Event Bridge：把 Extension hook 接入 Runtime prompt/tool/model-call 准备端口；
- Extension Observation Adapter：把 Runtime 执行观察事件投影为 Extension 事件；
- Extension Tool Runtime/Wrapper：把 Extension Tool 定义适配为 Runtime Tool；
- Agent Message Context Projector：把持久化会话文档投影为产品 `AgentMessage`。

这些文件连接两个不同协议，属于真实 Adapter。减少文件数量不是删除它们的理由。

### 删除迁移期路径并收紧门禁

以下旧路径已经删除，没有 forwarding module：

- `adapters/runtime-core/greenfield-extension-action-host.ts`；
- `adapters/runtime-core/greenfield-extension-event-host.ts`；
- `adapters/runtime-core/greenfield-extension-contract.ts`；
- `composition/session-host/extension-session-host.ts`。

纯类型转发文件删除后，Branch Navigation、Event Bridge 与 Extension Tool Runtime 直接依赖稳定
`runtime-contracts`。Extension 输入来源 metadata key 也从 Prompt Adapter 移到中立 Runtime 合同，消除 Host 对
具体 Prompt Adapter 常量的依赖。

迁移门禁新增 Extension Host -> Composition 必须为 0 的检查，并永久禁止上述四个旧路径及模块引用恢复。
Composition 的合法公共导出基线同步删除 Extension Session Host。

本轮没有引入 TypeBox 或 Zod。变更没有新增不可信 JSON、网络响应或持久化反序列化边界；现有 Tool Schema
仍沿用原 TypeBox 合同，内部 Host 迁移不需要额外运行时校验。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- Adapter 中 `greenfield` 文件：`38 -> 35`；
- Composition 中 `greenfield` 文件：保持 `30`；
- Adapter -> Composition 反向依赖文件：保持 `0`；
- Composition -> public API 内部依赖文件：保持 `0`；
- Extension Host -> Composition 依赖文件：保持 `0`，并新增永久门禁；
- Composition 公共导出：`19 -> 18`；
- 本轮四个旧实现/转发路径：`4 -> 0`；
- 新生产代码没有调用旧 Coding Agent 实现，也没有增加兼容入口。

## 行为兼容性验证

迁移前 Extension 定向基线：

```text
4 files passed
10 tests passed
```

迁移后相关行为测试扩展为：

```text
5 files passed
12 tests passed
```

覆盖 Action 映射与顺序、Event Bridge、Observation 投影、Runtime Extension controls，以及 Session reload
失败时的逆序回滚和主错误保留。

Coding Agent 完整包测试：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

质量门禁测试：

```text
9 files passed
118 tests passed
```

根级 `bun run check` 通过，包含全仓 Biome、根 tsgo、CLI typecheck、Desktop 独立 tsc、Admin tsc 和全部
质量门禁。

跨宿主验收通过：

```text
GOFLAGS="-p=1 -parallel=1" bun run verify:agent-hosts
ok (coding-agent, CLI, Desktop, IM)
```

## 尚未完成的替换

- Adapter 中仍有 35 个、Composition 中仍有 30 个 `greenfield` 文件；后续仍按协议边界和真实所有权审计；
- `CodingAgentSdkExtensionTransitionAdapter` 与 CLI Extension Session Host 存在部分生命周期逻辑重复，但 SDK
  在 Session 初始化阶段预创建并拥有 Event Host，CLI 在 transition prepare 阶段创建，两者的资源所有权和
  `session_start/session_shutdown` 时序不同，本轮没有冒险合并；
- `adapters/runtime-core/greenfield.ts` 仍是较大的迁移期聚合入口，Composition 通过它取得多项具体实现，后续
  应先改为明确依赖，再判断每项能力的最终归属；
- SDK Session Host 仍存在部分对 Composition 和公开 SDK 合同的内部依赖，需要按“产品组合根”与“公开门面”
  分别审计，不能只做路径替换；
- Event Bridge、Observation Adapter 和消息投影已确认是真实协议边界，除非目标协议发生变化，否则不应删除。

下一阶段优先拆除 `adapters/runtime-core/greenfield.ts` 对内部依赖图的遮蔽：让 Composition 和 Host 直接依赖
具体稳定能力，再据此识别仍被错误归类为 Adapter 的内部策略。该阶段应保持公开 Runtime API 和四宿主行为
不变，不以批量改名替代所有权判断。
