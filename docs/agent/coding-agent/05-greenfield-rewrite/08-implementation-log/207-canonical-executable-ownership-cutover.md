# 第 207 阶段：Canonical Executable Ownership Cutover

## 目标

本阶段只迁移可执行入口与发布产物的架构所有权，不删除仍作为测试基线的 Legacy Session、Runtime Backend 和 Knowledge 实现：

- `cli-app` 成为 `vetta`、`vetta-agent`、`vetta-agent-rpc` 的唯一所有者；
- `coding-agent` 回归能力内核与兼容适配包，不再发布可执行文件；
- 所有独立编译、全局链接和 SDK 默认 RPC 启动路径指向 Canonical CLI；
- Legacy CLI 不再通过 package export 或根导出公开；
- 真实 Legacy 行为只允许由测试专用入口调用，为下一阶段冻结差分合同保留参照。

## 实施前事实

第 206 阶段已经让 CLI、Desktop 和 Knowledge Processing 生产宿主无法激活 Legacy，但仍存在四个发布层缺口：

1. `@vetta/coding-agent` 仍声明 `vetta-agent -> dist/cli.js`；
2. `coding-agent/src/cli.ts` 仍直接调用 Legacy `main()`；
3. 独立二进制和全局 link 脚本仍以 `coding-agent/dist/cli.js` 为入口；
4. `RpcClient` 默认假定当前目录存在 `dist/cli.js`。

所以“生产宿主归零”尚不等于“所有可发布入口归零”。

## 实施内容

### 1. CLI App 获得 Agent 专用入口

新增 `packages/cli-app/src/agent-cli.ts`，它只调用现有 `runAgentCli()`。三个入口职责现在是：

| 命令 | 入口 | 职责 |
| --- | --- | --- |
| `vetta` | `dist/cli.js` | 综合 CLI，支持 agent/action/debug 路由 |
| `vetta-agent` | `dist/agent-cli.js` | Agent 专用 Canonical CLI |
| `vetta-agent-rpc` | `dist/agent-rpc-cli.js` | stdout 受保护的 JSONL RPC 入口 |

Agent 专用入口复用现有 intent 分类、control/print/RPC Host 和 requested/effective runtime 映射，没有复制 Agent 功能。

### 2. Coding Agent 撤销可执行与 Legacy CLI 公开面

`@vetta/coding-agent` 完成以下收缩：

- 删除 `bin.vetta-agent`；
- 删除 `src/cli.ts`；
- 删除 `public-api/legacy-cli.ts`；
- 删除 `./legacy/cli` package export；
- 根入口不再导出 `main`、`createLegacyAgentBootstrap`、`runLegacyAgentWithBootstrap`；
- `createAgentCliBootstrap` 改为直接从中立 Host Bootstrap 模块导出，不再通过 Legacy `main.ts`；
- 删除属于旧 CLI 产物的 `build:binary`、`copy-binary-assets` 和 `dist/cli.js` chmod。

Legacy `main.ts` 暂时保留为测试参照，但已不存在生产 import、package export、bin 或构建入口。

### 3. 独立产物和全局链接切换

统一 standalone compiler 新增 `--entry cli|agent`：

- 默认 `cli` 行为不变；
- `agent` 生成内嵌相同 HTML、Theme、Photon 资产的 Canonical Agent 单文件产物；
- `scripts/build-binaries.sh` 改为调用统一 compiler 的 `agent` 入口，不再直接编译旧 `dist/cli.js`；
- 依赖安装和 workspace 脚本调用统一使用 Bun；
- `scripts/link.sh` 通过 `build:cli` 构建并链接三个 CLI App 入口。

独立二进制原有输出目录与归档结构暂未改变，避免在架构切换阶段同时改变发行文件命名。

### 4. RpcClient 去除旧布局假设

`RpcClient` 的默认启动目标从相对路径 `dist/cli.js` 改为 PATH 中的 `vetta-agent-rpc`：

- 未传 `cliPath` 时直接启动 Canonical RPC 命令；
- 显式传入 JavaScript `cliPath` 时继续通过 Node 启动，保持既有测试和自定义入口兼容；
- 示例不再依赖 `coding-agent/dist/cli.js`；
- 源码集成测试的显式路径改为 `cli-app/dist/agent-rpc-cli.js`。

这样避免了 `coding-agent -> cli-app` 的反向包依赖和依赖环。

### 5. 测试专用 Legacy 基线

Print 和 RPC 差分测试不再导入已删除的 `@vetta/coding-agent/legacy/cli`。测试目录中的专用入口直接调用内部 `main.ts`：

- 不参与 `coding-agent` package exports；
- 不进入 `cli-app` build；
- 不进入独立安装产物；
- 只用于下一阶段删除 Legacy 实现前的行为比较。

### 6. 退役门禁收紧

Legacy retirement gate 现在同时约束：

- `coding-agent` 不得发布任何 bin；
- `cli-app` 的 `vetta-agent` 必须指向 `dist/agent-cli.js`；
- 已删除的两个 Legacy CLI 源文件不得恢复；
- `./legacy/cli` 不得恢复；
- standalone Agent 产物必须经过统一 compiler，禁止直接编译源入口。

Legacy 执行边从 10 条降到 7 条：

```text
[legacy-execution] ok (7 execution edge(s), 8 retained format boundary(s), 98 Greenfield shared-core import(s))
```

剩余 7 条分别是 2 条 Legacy Session 公开面、4 条 Runtime Backend/Composition、1 条 Knowledge Factory。

## 类型校验选择

本阶段没有新增外部 JSON/JSONL 协议。standalone compiler 参数是封闭枚举，package manifest 是仓库内可信配置，因此使用 TypeScript、显式枚举判断和测试即可；没有为内部构建参数引入 TypeBox 或 Zod。

## 验证记录

- Canonical package entrypoint：1 个测试通过；
- Coding Agent 公开 subpath 与 RpcClient launch：4 个测试通过；
- Canonical `vetta-agent` 独立 Print/control 产物：18 个测试通过；
- 默认 `vetta` installed artifact：13 个测试通过；
- Quality gates 与 Legacy retirement：58 个测试通过；
- Legacy retirement guard：7 条执行边、8 条格式边界、98 条 Greenfield shared-core imports，检查通过；
- standalone compiler guard：检查通过。
- 根目录 `bun run check`：Biome、monorepo tsgo、CLI 独立类型检查、Desktop 独立类型检查、Admin project build 与全部 guards 通过。

## 兼容性结论

- 用户已有 `vetta-agent` 命令名保留，但实现所有权迁移到 `cli-app`；
- `vetta` 和 `vetta-agent-rpc` 行为未改变；
- `--agent-runtime legacy` 仍可解析，但实际执行 Greenfield；
- Legacy 会话读取、迁移和显式不兼容错误未改变；
- 被移除的 `@vetta/coding-agent/legacy/cli`、根 Legacy main 导出和 coding-agent bin 属于公开破坏性变化，发布时应按 minor release 处理。

## 下一阶段建议

第 208 阶段应把“差分基线冻结”和“Legacy 内部执行删除”作为一个完整阶段：

1. 将 Provider Frame、事件顺序、工具调用、Print、会话迁移等真实 Legacy 观察结果冻结为不可变合同 fixture；
2. 将当前测试专用 Legacy CLI/RPC 入口改为读取合同 fixture；
3. 删除 Legacy `main`、AgentSession Runtime Backend、Session Ports 和 Knowledge Factory；
4. 将仍有价值的工具、Prompt、Skill、Session Format 能力移到中立公开面，而不是随 Legacy 标签误删；
5. 清理 `legacy/session`、`legacy/tools`、`legacy/host-services` 和 Runtime Host 旧导出；
6. 将 Legacy 执行边从 7 条降为 0，同时保持 8 条格式/迁移边界。
