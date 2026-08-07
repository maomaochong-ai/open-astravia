# 第 278 轮：Runtime Core 迁移聚合入口退役

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

第 277 轮完成 Extension Host 所有权闭合后，`adapters/runtime-core/greenfield.ts` 和同目录 `index.ts`
仍把 Model、Prompt、Memory、MCP、Plugin、Tool、Compaction 与 Session Host 等不同职责重新聚合为两个内部入口。
它们没有独立协议转换行为，也不是包级公共 API，却遮蔽了 Composition、Host 和测试的真实依赖图。

本轮不移动或重写任何功能实现，只让每个调用方直接依赖符号的真实所有者，并永久删除两个迁移期 barrel。
这样后续所有权审计能看到真实边，而不会把一个聚合文件误判成稳定 Adapter 合同。

## 实施内容

### 删除迁移聚合入口

永久删除且不保留 forwarding module：

- `adapters/runtime-core/greenfield.ts`；
- `adapters/runtime-core/index.ts`。

二者均未出现在 `package.json` exports 中，因此本轮没有修改公共包入口或公开 API。

### 恢复真实依赖图

生产代码 14 个调用方和测试 22 个调用方改为直接依赖职责所有者：

- Hook Runtime 直接依赖 `@vetta/ecosystem-adapter`；
- Memory Rollover 与 Memory Feature 直接依赖 `memory` 域；
- Context Runtime 直接依赖 `context-runtime`；
- Model、Prompt、MCP、Plugin、Todo、Subagent、Extension Bridge 和 Sandbox Tool 分别依赖各自实现模块；
- SDK Session Host 的 MCP、Compaction、Plugin MCP、Branch Navigation 与 Resource Reload 依赖不再经过聚合入口。

测试仅调整 import，原有断言、fixture 和行为场景均未改变。没有新增替代 barrel，也没有把这些实现移动到
`coding-agent` 包之外。

### 收紧迁移门禁

`check-coding-agent-migration-residue.mjs` 新增以下约束：

- 两个已删除文件永久列入 retired files；
- 生产代码和测试中的两个旧模块引用必须为 `0`；
- 门禁扫描范围从 `src` 扩展到 `src + test`，但架构数量和层级边统计仍只针对生产源码；
- Adapter 中 `greenfield-*` 文件上限由 `35` 收紧为 `34`。

新增回归测试同时证明生产代码和测试恢复旧 barrel 引用都会失败。

本轮没有引入 TypeBox 或 Zod。变更没有新增外部输入、持久化反序列化或网络响应边界，只调整静态模块依赖，
运行时 Schema 校验不适用。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- `runtime-core` 迁移聚合入口：`2 -> 0`；
- 生产代码对两个聚合入口的引用：`14 -> 0`；
- 测试对两个聚合入口的引用：`22 -> 0`；
- Adapter 中 `greenfield` 文件：`35 -> 34`；
- Composition 中 `greenfield` 文件：保持 `30`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition 反向边：均保持 `0`；
- 新生产代码没有调用旧 Coding Agent 实现，也没有新增兼容入口。

## 行为兼容性验证

迁移前、迁移后运行同一组直接依赖 barrel 的行为测试：

```text
22 files passed
74 tests passed
```

新增迁移门禁定向测试：

```text
1 file passed
7 tests passed
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

其中 Desktop 验收为 119 个测试文件通过、501 个测试通过、1 个跳过；独立 Vetta CLI 可执行文件编译和 IM
Gateway Go 测试同时通过。

## 尚未完成的替换

- Adapter 中仍有 34 个、Composition 中仍有 30 个 `greenfield` 文件；名称本身不是删除依据，下一阶段应依据
  是否存在真实协议转换和最终所有权逐项审计；
- 已确认 Extension Event Bridge、Observation Adapter、Tool Runtime/Wrapper 和 Agent Message Context Projector
  属于真实协议边界，不应为了降低文件数而删除；
- Composition 现在暴露了真实的具体依赖，下一阶段可以审计其中哪些属于产品组合策略、哪些仍被错误放在
  Adapter；
- SDK Extension Transition 与 CLI Extension Session Host 的生命周期差异仍需以资源所有权和事件时序为准，
  不能仅因代码相似而合并。

下一阶段应基于本轮恢复的真实依赖图，优先审计 Composition 对 runtime-core Adapter 的具体依赖：保留真正的
协议适配，迁出或内聚仅属于产品策略的实现。实施时继续保持公共 Runtime API、会话格式和四宿主行为不变。
