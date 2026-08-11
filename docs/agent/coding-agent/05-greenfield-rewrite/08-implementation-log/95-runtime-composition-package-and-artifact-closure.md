# 第 95 轮：Runtime Composition 独立包与产物闭包

## 1. 目标

第 94 轮已证明 Desktop 的交互、Scheduler 与 Batch 消费者能够共享同一个 Greenfield Runtime，
但生产接线仍存在一个架构倒置：

```text
desktop-app -> cli-app/src/greenfield-runtime-composition.ts
```

这使 Desktop 依赖另一个宿主应用的源码路径，也让 Composition Root 的产物完整性依赖开发态 TS
解析。本轮只调整代码所有权和构建边界，不修改 Tool、Prompt、Skill、MCP、Memory、Todo、Subagent
或会话行为。

## 2. 依赖分析

Composition 不能直接移入 `coding-agent`。当前依赖方向为：

```text
coding-agent
  <- runtime-tools
  <- runtime-storage
  <- runtime-mcp

Greenfield Composition
  -> coding-agent
  -> runtime-core
  -> runtime-tools
  -> runtime-storage
  -> runtime-mcp
  -> runtime-subagents
```

若 `coding-agent` 直接拥有 Composition，就会形成 `coding-agent <-> runtime-*` 环。因此新增薄包
`@vetta/runtime-composition`，它位于完整 Runtime 栈之上、CLI/Desktop 宿主之下，只负责生产组合
和宿主无关的 Session 外围装配。

## 3. 代码归位

以下实现从 `packages/cli-app/src` 迁入 `packages/runtime-composition/src`：

- Greenfield Runtime Composition；
- RuntimeHost Session Backend；
- Conversation Ownership Binding；
- Session-local Execution Runtime；
- Session Configuration 与 Background Work Controller；
- Subagent Child、Runtime 与状态持久化；
- Coding Tools Runtime Composition；
- Greenfield Conversation Path 解析。

公共会话配置新增宿主无关名称 `GreenfieldRuntimeSessionOptions`。原
`GreenfieldCliSessionOptions` 保留为兼容类型别名，没有删除现有 API。

CLI 原路径现在只有窄 re-export：

```text
cli-app/src/* -> @vetta/runtime-composition
```

这样现有 CLI 内部导入、测试和外部导出保持兼容；新的 Desktop 生产接线则直接依赖
`@vetta/runtime-composition`，不再经过 `cli-app/src`。

## 4. Workspace 与构建图

新增包已接入：

- 根 workspace；
- 根 `tsconfig.json` path map 与 include；
- Desktop 独立 `tsconfig.json` path map；
- CLI 与 Desktop 的显式 workspace dependency；
- 根 `scripts/build.sh` 的 Runtime 完整栈后置层；
- Desktop workspace prerequisite graph。

Desktop 前置构建图同时补入原先遗漏的 `runtime-subagents`。当前相关顺序为：

```text
runtime-core
  -> coding-agent
  -> runtime-tools / runtime-storage / runtime-mcp
  -> runtime-composition
  -> cli-app
  -> desktop-app
```

构建顺序守卫确认所有生产 workspace dependency 都先于消费者构建。

## 5. 独立 `dist` 产物闭包

`@vetta/runtime-composition` 发布一个机器可读清单：

```ts
{
  packageName: "@vetta/runtime-composition",
  entrypoints: ["index.js"],
  typeEntrypoints: ["index.d.ts"],
  runtimeAssets: []
}
```

包级 `verify:artifact` 在编译后验证：

1. `dist` 中每个相对 JS / declaration import 都仍位于 `dist` 内；
2. 每个相对 import 的目标文件真实存在；
3. 产物不依赖 `@vetta/cli-app`；
4. manifest 中的入口、类型入口和资源全部存在；
5. Node 能够直接导入 `dist/index.js` 并读取 manifest。

该校验已接到包的正式 build script，因此 Desktop 前置构建在生成 Composition 产物时会自动执行，
而不是依赖人工检查。

额外扫描编译后的 Desktop Main、CLI 与 Runtime Composition，未发现 `cli-app/src`、
`runtime-composition/src` 或其他指向该 Composition 源码目录的路径。

## 6. 持续边界门禁

包边界质量门新增两项约束：

- `runtime-composition` 被视为宿主无关 library，禁止反向依赖 CLI/Desktop 等应用包；
- Desktop 生产源码禁止直接导入 `cli-app/src`，必须消费正式 package export。

对应质量测试同时验证违规相对源码导入会失败，而 `@vetta/runtime-composition` 合法。

## 7. 行为兼容验证

迁移后复跑 CLI 的 Composition、Tool、MCP、Prompt、Hook、Plugin、Todo、Memory、Subagent、
Session Backend 与 RPC 相关测试：

```text
16 files passed
56 tests passed
```

首次合并运行暴露出两个既有测试隔离问题：Memory/Todo 用例断言“只有本能力工具”，却没有关闭默认
启用的 Subagent，因此会观察到 7 个既有 Subagent 工具。修复仅在这些非 Subagent 测试的
Composition options 中显式设置 `enableSubagents: false`；没有修改生产默认值或工具集合。

新增包合同测试：

```text
1 file passed
2 tests passed
```

质量门测试：

```text
1 file passed
27 tests passed
```

Desktop Backend Pool、RuntimeHost 能力、Legacy/Greenfield 差分和现有 CLI Canary 测试：

```text
4 files passed
12 tests passed
```

## 8. 真实进程验证

通过仓库规定的 Desktop 验证入口执行：

```powershell
bun run verify:ui:start -- --runtime-canary greenfield
bun run verify:ui:debug -- runtime-canary
```

验证结果：

- Desktop prerequisite graph 实际构建了 `runtime-composition`；
- 构建过程中的 `[runtime-composition-artifact] ok` 通过；
- 真实 Desktop Main 从正式包接线启动 Greenfield Runtime；
- 交互、Scheduler、Batch 三类消费者均成功创建独立会话；
- CLI 完成会话创建、继续和持久化闭环；
- Batch 排队任务没有越过并发边界；
- 退出后 Session 锁释放、RPC endpoint 删除、Provider 停止；
- Desktop 退出码为 `0`。
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包含 Biome、monorepo `tsgo`、CLI 独立类型检查、
  Desktop 独立 `tsc`、Admin project build 和全部质量守卫。

## 9. 明确未修改

- 没有改变任何 Tool 名称、描述、参数 Schema、执行器或启用规则。
- 没有改变 Prompt、Skill、MCP、Knowledge 或 Plugin 的动态刷新语义。
- 没有改变 Memory、Todo、Subagent、Hook 或 Continuation 行为。
- 没有改变 Conversation 文件格式、Session ID 编码或恢复语义。
- 没有切换 Desktop 的默认 Runtime。
- 没有删除 CLI 既有导出；旧的 `GreenfieldCliSessionOptions` 仍兼容。
- 没有把 Composition 下沉进 `coding-agent` 并制造反向依赖环。

## 10. 下一步

下一阶段应在当前独立 Composition 产物基础上验证“发布/安装后的完整应用闭包”，而不再调整运行时
业务：

1. 对打包后的 Desktop Main 与独立 CLI 产物执行相同的真实 Provider / Tool Loop Canary；
2. 在隔离安装目录验证 workspace symlink、源码 path map 和仓库根目录均不可见时仍可启动；
3. 校验 Coding Agent 的 Tool 描述、Prompt 资源、Skill 与 MCP 配置分别由正确的包或宿主携带；
4. 增加真实进程重启后的 Session Catalog、未完成会话恢复和所有权重获测试；
5. 闭包稳定后再评估 Greenfield 默认启用范围，本阶段仍不切换默认值。
