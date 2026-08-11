# 第 257 阶段：Composition 所有权收口与转发层退役

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

本阶段把产品 Composition Root 的所有权明确收回 `@vetta/coding-agent/composition`。删除只做转发的 `@vetta/runtime-composition` workspace 包，以及 CLI 内 10 个无独立职责的 Composition 转发模块；CLI 和 Desktop 直接依赖真正的合同所有者。这里不是架空 `coding-agent`，而是让它保留产品组合与能力编排职责，同时让 CLI 只承担宿主和协议适配。

第 256 阶段记录中提到的 `packages/coding-agent/src/runtime-host/` 实体目录并不存在；本阶段以实际仓库为准，没有继续迁移一个不存在的目录，也没有修改历史记录。

## 实施内容

- 删除 `packages/runtime-composition` 的 package、构建、测试与 artifact 校验配置，并从 workspace、TypeScript path、Desktop prerequisite graph 和 lockfile 中移除。
- 删除 CLI 的 10 个 Composition 转发模块和对应聚合导出。
- CLI Agent Session Host、Extension Session Host、RPC Session Adapter、IM Runtime Host 改为直接从 `@vetta/coding-agent/composition` 取合同和组合实现。
- Desktop Greenfield candidate 与 backend pool 测试直接依赖 Coding Agent Composition 合同，不再经 CLI 取得类型。
- 将 4 组 Composition 内部实现测试从 CLI 移到 `packages/coding-agent/test/runtime-core`；保留原行为场景，只纠正测试所有权。
- 缩小 `@vetta/coding-agent/composition` 公共导出，仅保留当前产品消费者需要的组合合同和入口；内部 Session peripheral、execution、ownership 与 Subagent 组装实现不再作为公共 API 暴露。
- 未引入 TypeBox 或 Zod：本阶段只调整静态模块所有权，没有新增不可信运行时输入或序列化边界。

## 旧实现依赖变化

- `@vetta/runtime-composition` 文件：`7 -> 0`。
- `@vetta/runtime-composition` 生产与配置引用：`0`。
- CLI Composition 转发模块：`10 -> 0`。
- CLI 公共 Composition 转发边：`1 -> 0`。
- Desktop 经 `@vetta/cli-app` 获取 Composition 合同的边：`1 -> 0`。
- Coding Agent 旧实现文件、旧实现依赖、Runtime 反向依赖仍均为 `0`。

`check-coding-agent-rewrite-progress.mjs` 已将以上五项加入固定零目标；`check-package-boundaries.mjs` 同时拒绝恢复包、依赖声明、CLI 转发文件、CLI 公共转发和 Desktop 绕行依赖。它们不能通过更新 baseline 合法化。

## 行为兼容性验证

- `bun run check:quick`：通过；包含 package boundaries、rewrite progress、build order 和 standalone CLI build 守卫。
- `bun run test:quality`：通过，4 个测试文件、89 个测试。
- `packages/cli-app` 执行 `bun run test`：通过，36 个测试文件、195 个测试。
- `packages/coding-agent` 执行迁移后的 4 个测试文件：通过，12 个测试。
- Coding Agent 全包测试执行过但未全绿：897 个测试中 868 通过、17 跳过、12 失败。10 个失败来自既有 Windows shell/API key 测试；另 2 个来自本阶段未修改的 Session initialization profile 和 Subagent assembly 断言。上述失败不涉及本阶段删除的包、转发层或迁移测试，未在架构阶段顺带修改。

## 尚未完成的替换

- `@vetta/coding-agent/composition` 仍是较宽的产品级公共面；后续应按真实外部消费者审计，继续区分稳定合同与仅供 CLI 宿主使用的装配入口，但不能重建 CLI 转发层。
- CLI 的 RPC/IM Host 仍承担较多宿主编排，下一阶段应审计其中可下沉到 Coding Agent Composition 的产品装配与必须留在 CLI 的传输协议职责。
- Coding Agent 全包测试的 12 个既有失败需要作为独立测试稳定性工作处理，不能与本阶段的架构迁移混改。
