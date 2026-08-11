# 第 205 阶段：Legacy Execution Retirement Gate

## 阶段目标

在不删除 Legacy 代码、不改变 CLI、Desktop 和 Knowledge 现有行为的前提下，建立可执行的 Legacy 执行退役基线，区分以下三类边界：

1. 最终切换后可以删除的 Legacy Agent 执行入口、适配器和公开暴露；
2. 仍需保留的旧会话格式读取、识别和迁移能力；
3. Greenfield 仍在复用、不能因为位于 `core/*` 就被误删的共享基础能力。

本阶段只冻结当前依赖图并给出删除条件，不执行最终切换，也不修改运行时选择语义。

## 实施前分析

当前 CLI 与 Desktop 的默认 Agent Runtime 已经是 Greenfield，但 Legacy 执行仍然可以通过显式兼容入口被激活：

- CLI 的 Legacy selector 通过 `legacy-runtime-gateway.ts` 调用 `@vetta/coding-agent/legacy/cli`；
- Desktop Runtime Composition 通过 `desktop-legacy-execution-compatibility.ts` 创建 Legacy Session Backend；
- Desktop Knowledge Processing Factory 仍保留 Legacy Knowledge Session 分支；
- `@vetta/coding-agent` 仍公开根入口和四个 `./legacy/*` package exports；
- 独立 `coding-agent` CLI 仍由 `src/cli.ts` 进入 `src/main.ts`。

同时，旧会话读取与迁移并不等于旧 Agent 执行。Greenfield 恢复历史会话仍需要格式识别、历史读取、租约和迁移适配器，因此不能按文件名中的 `legacy` 进行整体删除。

静态审计还发现 Greenfield 生产代码存在 98 条对共享 `core/*` 的直接导入。这些依赖包括工具、提示词、扩展、Memory、MCP、上下文压缩、模型注册、资源加载和会话数据类型；它们属于仍在使用的基础能力，不是本阶段的 Legacy 执行删除对象。

## 实施内容

### 1. 新增可执行退役守卫

新增 `scripts/quality/check-legacy-execution-retirement.mjs`，使用 TypeScript AST 扫描 `coding-agent`、`cli-app` 和 `desktop-app` 的生产源码，并冻结当前 15 条 Legacy 执行或暴露边：

- Legacy CLI 入口与 CLI selector 激活边；
- Legacy Session Backend 与 Host Composition 边；
- Legacy Knowledge Processing 执行边；
- Desktop Legacy Execution Compatibility 激活边；
- `coding-agent` 根入口和 Legacy Public API 暴露边。

守卫拒绝新增任何不在基线中的 Legacy 执行消费者。基线中的边消失时也会失败，要求最终删除阶段显式更新基线，而不是让删除范围在普通重构中悄然漂移。

### 2. 冻结必须保留的格式边界

守卫将以下 8 个文件定义为当前必须存在的旧格式兼容边界：

- `packages/coding-agent/src/adapters/runtime-core/legacy-session-format/catalog.ts`
- `packages/coding-agent/src/adapters/runtime-core/legacy-session-format/header-reader.ts`
- `packages/coding-agent/src/adapters/runtime-core/legacy-session-format/history-reader.ts`
- `packages/coding-agent/src/adapters/runtime-core/legacy-session-format/index.ts`
- `packages/coding-agent/src/adapters/runtime-core/legacy-session-format/lease.ts`
- `packages/cli-app/src/rpc/cli-session-format-compatibility.ts`
- `packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-format-compatibility.ts`
- `packages/desktop-app/src/main/greenfield-runtime/desktop-legacy-session-migration-backend.ts`

`legacy-session-format/*` 还被禁止反向依赖 AgentSession、Legacy Session Backend 或 SDK 执行层，确保历史数据能力可以独立于旧执行内核继续存在。

以下迁移辅助能力也应保留，但后续可以继续收敛到明确的格式/迁移边界：

- `coding-agent-legacy-session-migration.ts`
- `legacy-session-import-normalizer.ts`
- `legacy-session-setup-seed-importer.ts`
- `greenfield-im-legacy-session-migration.ts`

### 3. 冻结 Legacy package exports

当前四个公开 Legacy exports 被纳入退役基线：

- `./legacy/cli`
- `./legacy/host-services`
- `./legacy/session`
- `./legacy/tools`

它们当前不是可直接删除项。最终切换必须先清理仓库内消费者、确认外部兼容策略，再同步更新 package exports 和守卫基线。

### 4. 纳入质量门禁

退役守卫已接入 `check:guards`，并新增三类回归测试：

- 新增 Desktop Legacy Backend 消费者必须被拒绝；
- 旧格式边界反向导入执行层必须被拒绝；
- Greenfield 对共享 `core/*` 的使用只做独立盘点，不误判为 Legacy 执行。

根 `test:quality` 已包含新测试，避免该守卫只能由人工单独运行。

## 最终删除清单与条件

### A. 最终切换时先移除的激活层

以下对象负责让宿主仍能选择 Legacy 执行。只有在产品明确停止 Legacy Runtime 选择后才能删除：

- CLI 的 `legacy-runtime-gateway.ts` 及 `agent-runtime-selection.ts` 中的 Legacy 分支；
- Desktop 的 `desktop-legacy-execution-compatibility.ts`；
- Desktop Runtime Composition、Selector 和 Decision 中的 Legacy 分支；
- Desktop Knowledge Processing Factory 中的 Legacy 分支。

### B. 激活层清零后可删除的旧执行实现

消费者清零并通过验收后，才可以删除或收窄：

- `src/main.ts` 与 `src/cli.ts` 中的 Legacy Agent 执行部分；
- `legacy-session-backend.ts` 和 `legacy-session-ports.ts`；
- `adapters/runtime-core/composition.ts` 中的 Legacy Host Composition；
- `composition/legacy-knowledge-processing-session.ts`；
- `public-api/legacy-cli.ts`；
- `public-api/legacy-session.ts` 中暴露旧 AgentSession/SessionManager 的部分；
- 对应的 root、adapter、composition re-export 和四个 `./legacy/*` package exports。

`src/cli.ts` 不能直接删除：独立可执行产物、控制命令和 package command 必须先重新接到新的 Runtime Composition Root，并通过安装产物验收。

### C. 最终切换后仍保留的兼容层

即使 Legacy Agent 执行完全退役，以下能力仍应保留：

- 旧会话 catalog、header、history 和 lease 读取；
- CLI/Desktop 旧格式识别；
- Desktop 与 IM 的旧会话迁移；
- import normalizer 和 setup seed importer；
- Greenfield 正在使用的共享 `core/*` 基础能力。

如需进一步清理目录命名，应先迁移模块归属并保持合同与测试不变，不能把“移动共享核心”与“删除旧执行内核”混成一次操作。

## 最终切换的阻塞条件

目前距离删除 Legacy 执行仍有六个明确阻塞项：

1. 独立 `@vetta/coding-agent` binary 仍进入 `dist/cli.js` 对应的 Legacy main；
2. CLI 仍支持显式 Legacy Agent Runtime 选择；
3. Desktop 仍支持通过运行时配置选择 Legacy；
4. Desktop Knowledge Processing 仍保留 Legacy Session Factory；
5. 根 Public API 与四个 Legacy package exports 仍公开旧能力；
6. 共享 `core/*` 仍有 98 条 Greenfield 生产依赖，不能随旧执行目录一起删除。

这些条件全部清零之前，任何大规模物理删除都会同时改变功能或破坏历史会话兼容性。

## 功能验收

本阶段使用真实宿主入口和针对性测试确认未发生功能重构：

```text
CLI runtime selection、Greenfield host session backend、IM legacy migration
  3 files passed, 20 tests passed

Desktop runtime selector、composition boundary、legacy migration、knowledge factory
  4 files passed, 12 tests passed

Vetta CLI print mode
  1 file passed, 18 tests passed

Quality guards
  2 files passed, 55 tests passed
```

验收覆盖默认 Greenfield 路径、显式兼容路径、fresh/resume/continue、旧会话迁移、错误传播、工具调用和 print/JSONL 行为。

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。新增内容是静态源码依赖审计、固定路径基线和 package export 清单，不处理外部 JSON、网络消息或不可信运行时输入；使用运行时 schema 不会增加有效保障。

## 阶段结论

Legacy 执行退役现在具备可执行边界：

- 15 条现有执行/暴露边被显式冻结，不能继续扩散；
- 8 个旧格式边界被明确保留并与执行层隔离；
- 98 条 Greenfield 共享核心依赖被独立记录，避免误删；
- CLI、Desktop 和 Knowledge 的当前功能均保持不变。

下一阶段应先设计并实施最终 Runtime Cutover：把独立 binary、CLI 显式 Legacy 选择和 Desktop Legacy 选择统一切到新的 Runtime Composition Root，再清理执行消费者。只有消费者归零且完整验收通过后，才进入 Legacy 执行实现的物理删除阶段。
