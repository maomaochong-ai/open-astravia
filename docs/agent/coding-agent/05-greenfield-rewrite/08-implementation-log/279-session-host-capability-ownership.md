# 第 279 轮：Session Host 能力所有权归位

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

第 278 轮删除 `runtime-core` 聚合入口后，真实依赖图显示四个实现仍错误集中在
`adapters/runtime-core`：分支导航与资源重载承担产品生命周期和会话操作编排，并不执行协议转换；只读会话投影
与桌面命令执行则确实把 Runtime 数据或宿主进程能力适配为目标 Port。

本轮依据职责而不是文件数量处理这些实现：前两者归入产品 Host，后两者保留为 Adapter 并移动到其目标协议域。
迁移不改变运行顺序、错误映射、会话投影、Extension 事件、公开 Runtime API 或任何宿主功能。

## 实施内容

### Session Host 归位

- 分支导航移动到 `host/session-history/branch-navigation-host.ts`，内部类型改为稳定的
  `CodingAgentBranchNavigation*` 命名；
- 资源重载移动到 `host/resources/resource-reload-host.ts`，内部类型改为稳定的
  `CodingAgentResourceReloadHost*` 命名；
- SDK Session 能力装配直接依赖两个真实 Host，不再把产品编排行为描述为 Runtime Core Adapter；
- 对应测试移动到 `test/host/session-history` 和 `test/host/resources`，保留原有断言与 fixture 行为。

### 真实 Adapter 按目标协议归位

- Runtime Conversation 到 Extension 会话只读视图的投影移动到
  `adapters/extensions/runtime-session-view-adapter.ts`，工厂命名为
  `createCodingAgentExtensionSessionView`；
- Coding Agent 命令进程到 `DesktopCommandPort` 的转换移动到
  `adapters/runtime-tools/desktop-command-port-adapter.ts`，工厂命名为
  `createCodingAgentDesktopCommandPort`；
- Extension Event Host、SDK Active Session Host 与产品工具装配改为直接依赖对应 Adapter；
- 桌面配置解析继续使用既有 TypeBox Schema 与 `Value.Check`，没有改变外部配置校验或可执行文件查找行为。

### 保持公共合同稳定

`@vetta/coding-agent/runtime` 的下列公共名称和结构保持不变：

- `createCodingAgentRuntimeBranchNavigationHost`；
- `createCodingAgentRuntimeResourceReloadHost`；
- `CodingAgentRuntimeBranchNavigationOptions`；
- `CodingAgentRuntimeBranchNavigationHostOptions`；
- `CodingAgentRuntimeResourceReloadHostOptions`。

公共工厂只改为构造归位后的内部 Host，没有新增兼容转发文件，也没有要求 CLI、Desktop、IM 或 SDK 调整调用方式。

### 收紧迁移门禁

`check-coding-agent-migration-residue.mjs` 将四个旧文件永久列入 retired files，并禁止生产代码或测试恢复旧路径引用：

- `greenfield-branch-navigation-host.ts`；
- `greenfield-resource-reload-host.ts`；
- `greenfield-readonly-session-manager.ts`；
- `greenfield-desktop-command-host.ts`。

Adapter 中 `greenfield-*` 文件上限由 `34` 收紧为 `30`。Package Boundary 的分支导航中立合同检查同步移动到
新的 Host 所有权路径，并新增门禁 fixture 验证旧 Session Host 和旧协议 Adapter 路径会被拒绝。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 错误放置在 `adapters/runtime-core` 的目标文件：`4 -> 0`；
- 生产代码和测试对四个旧路径的引用：归零；
- Adapter 中 `greenfield` 文件：`34 -> 30`；
- Composition 中 `greenfield` 文件：保持 `30`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition 反向边：均保持 `0`；
- 新生产代码没有调用旧 Coding Agent 实现，也没有新增迁移期兼容入口。

## 行为兼容性验证

迁移前、迁移后运行同一组直接行为测试：

```text
6 files passed
23 tests passed
```

迁移门禁与 Package Boundary 定向测试：

```text
2 files passed
71 tests passed
```

Coding Agent 完整包测试：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

根级 `bun run check` 通过，包含全仓 Biome、根 tsgo、CLI typecheck、Desktop 独立 tsc、Admin tsc 和全部
质量门禁。

跨宿主验收通过：

```text
GOFLAGS="-p=1 -parallel=1" bun run verify:agent-hosts
ok (coding-agent, CLI, Desktop, IM)
```

其中独立 Vetta CLI 可执行文件编译成功，IM Gateway Go 测试通过，Desktop 验收为 119 个测试文件通过、501 个
测试通过、1 个跳过。本轮是内部所有权迁移，没有发送外部真实模型请求。

## 尚未完成的替换

- Adapter 中仍有 30 个、Composition 中仍有 30 个 `greenfield` 文件，下一阶段仍应逐个依据真实职责审计，不能
  仅为降低数量迁移或删除；
- `adapters/runtime-core` 中剩余文件需要区分真正的 Runtime 协议投影、宿主基础设施 Adapter 与仍然错放的产品
  Host；
- Composition 内部仍保留较多迁移命名，应先确认其是否持有产品装配策略、Session 生命周期或协议转换，再决定
  稳定命名和最终目录；
- CLI、Desktop、IM 的公共组合入口已通过验收，后续调整必须继续保持这些宿主只依赖稳定公共合同，不能恢复内部
  深路径导入。

下一阶段应审计 `adapters/runtime-core` 剩余生产文件的目标 Port 与调用方向，优先处理没有协议转换职责、却仍被
命名为 Adapter 的实现；每次归位同时收紧旧路径门禁，并继续使用四宿主验收证明功能兼容。
