# 第 175 轮：非 RPC CLI 意图与 Print Host 边界

## 目标

第 174 轮收紧了普通 RPC 的自动 Legacy 回退，但非 RPC CLI 仍被统一视为 Legacy：帮助、版本、包管理、模型列表、会话导出、文本输出、JSON 输出和管道输入共用同一 Runtime 选择入口；`runPrintMode()` 又直接依赖具体 `AgentSession`，导致控制命令与会话执行、输出协议与旧会话实现边界混在一起。

本轮目标是：

1. 先区分 control、print、rpc 三类 CLI 意图，不把所有非 RPC 调用等同为会话 Runtime。
2. 让 Print Host 依赖最小能力合同，不再直接认识 `AgentSession`。
3. 用 Legacy 适配器保留现有 Print 行为，本轮不切换 Greenfield。
4. 通过标准 `vetta` CLI 进程验证 text、JSON、管道 stdin 和 help 行为。

## 审计结论

### 1. 非 RPC CLI 不是一个执行域

现有入口实际包含三类职责：

| 意图 | 典型入口 | 是否需要会话 Turn |
| --- | --- | --- |
| control | `--help`、`--version`、`--list-models`、`--export`、包管理命令 | 不一定；至少不能等同于 Runtime backend 选择 |
| print | `--print`、`--mode text/json`、带 stdin 的 `vetta agent` | 是 |
| rpc | `--mode rpc` | 是，并已默认 Greenfield |

因此“非 RPC 默认 Legacy”只能是当前会话执行兼容策略，不能继续充当 CLI 意图模型。

### 2. 空参数不能在静态分类阶段判为 control

是否存在管道输入只有进程读取 stdin 后才能知道；`vetta agent` 的空 Agent 参数既可能没有输入，也可能承载 piped prompt。静态分类若把空参数当作 control，会提前绕过 Print 路径并破坏管道功能。因此无显式 control/RPC 标记时保持 print-compatible。

### 3. Print 模式只需要五项能力

`runPrintMode()` 的真实需求是：读取 JSON header、初始化 Extension、订阅事件、提交 prompt、读取最终消息。Extension 的 session 切换/树导航等具体动作是 Legacy 适配责任，不应让 Print Host 依赖 `AgentSession`、`SessionManager` 或底层 Agent。

## 实施内容

### CLI 意图分类

新增 `AgentCliIntent` 与 `classifyAgentCliIntent()`：

- help/version/model listing/export/package commands 分类为 `control`。
- `--mode rpc` 和 `--mode=rpc` 分类为 `rpc`。
- 其余调用分类为 `print`，保留隐式 stdin 能力。

Runtime 默认 backend 现在消费该分类：只有 RPC 默认进入 Greenfield；Print 仍默认 Legacy。Control 命令直接进入既有 CLI 控制逻辑，不再产生会话 Runtime decision，也不安装 RPC stdout guard。

### 中立 Print Session 合同

新增 `PrintSessionCapabilities`，只暴露：

- `readHeader()`
- `initializeExtensions()`
- `subscribe()`
- `prompt()`
- `readMessages()`

`runPrintMode()` 改为仅消费该合同。输出顺序、Extension 错误文案、初始图片、顺序 prompt、最终 assistant text 和错误退出逻辑均未改变。

### Legacy 适配器

新增 `LegacyPrintSessionAdapter`，集中承接旧 `AgentSession`：

- 从旧 SessionManager 读取 header。
- 原样保留 Print Extension 的 wait/new/fork/navigate/switch/reload 动作接线。
- 转发事件订阅、prompt 和最终消息读取。

CLI 组合仍创建原有 `AgentSession`，随后包装为适配器交给 Print Host。也就是说，本轮只反转依赖，没有切换执行内核。

## 测试

### 纯合同测试

使用不引用 `AgentSession` 的 fake capabilities 驱动 `runPrintMode()`，验证：

- JSON header 先输出。
- Extension 在 prompt 前初始化，错误仍写 stderr。
- 初始图片只随首个 prompt 传递。
- 多条 prompt 保持顺序。
- 订阅事件继续按 JSON 输出。

### 标准 CLI 进程测试

从 `packages/cli-app/src/cli.ts` 构建标准 `vetta` 测试入口，连接本地 OpenAI Responses fixture，验证：

- `--print` 仍通过 Legacy Session 返回最终文本。
- `--mode json` 仍产生 JSON 事件和模型响应。
- `vetta agent` 的 piped stdin 在没有显式 mode 时仍进入 Print。
- `vetta agent --help` 正常输出帮助，且不产生 `[agent-runtime]` 会话决策。
- 既有普通 RPC Runtime 选择回归继续通过。

测试同时发现既有 JSON Print stdout 会出现 `[skills] loaded` 诊断文本。该现象不是本轮引入；为遵守“架构重构不改变功能”，本轮没有顺手迁移日志通道，测试只提取并验证 JSON 事件。若要保证严格 JSONL，需要作为独立兼容修复评估全部 stdout 日志来源。

## TypeBox / Zod 判断

本轮新增的是进程内 TypeScript 能力合同和 argv 意图分类，没有新增外部 JSON、持久化格式或网络协议输入。TypeBox/Zod 不会提高这一边界的安全性，反而会把内部依赖倒置误写成数据协议，因此未引入。

## 兼容性判断

- Print 仍使用旧 `createAgentSession()` 创建的完整 `AgentSession`。
- text、JSON、stdin、图片、Extension 初始化和会话持久化算法未修改。
- RPC 默认 Greenfield、显式 backend 与自动 Legacy 回退策略未修改。
- 公共 SDK `createAgentSession` 未修改。
- Tool、Prompt、Skill、MCP、Knowledge、Memory 和模型请求内容未重构。
- Control 命令不再输出没有实际会话执行意义的 Runtime decision；命令本身仍由原有实现处理。

## 验证结果

- Print Host 纯合同：1 项通过。
- CLI intent 分类：15 项通过。
- 标准 Vetta 非 RPC CLI：4 项通过。
- 既有 Runtime 选择回归：10 项通过。
- 定向测试合计：4 个文件、30 项通过。
- `bun run check:quick` 通过，包含 package boundary 和 standalone CLI build guard。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。
- `git diff --check` 通过。

## 下一步

下一阶段应实现 `GreenfieldPrintSessionAdapter` 候选组合，但仍不切默认：先把 Runtime Session 的 header、事件、prompt、最终消息和 Extension 初始化映射到同一 `PrintSessionCapabilities`，再建立 Legacy/Greenfield 的标准 CLI 差分门禁，覆盖 text、JSON、stdin、图片、Provider 错误、Extension 错误、会话落盘与恢复。

只有差分门禁证明这些行为等价后，才能让 Print 默认进入 Greenfield。严格 JSONL 的 stdout 诊断污染应独立处理，避免把日志通道修复与 Runtime 切换混成一次功能变更。
