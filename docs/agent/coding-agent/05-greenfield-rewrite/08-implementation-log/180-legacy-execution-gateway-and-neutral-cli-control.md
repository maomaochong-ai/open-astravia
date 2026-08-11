# 第 180 轮：Legacy 执行 Gateway 与中性 CLI 控制入口

## 目标

第 179 轮已经将 Print、RPC、IM 和 Desktop 的默认生产路径切换到 Greenfield，但 CLI Runtime Selector
仍直接导入并调用 Legacy CLI；帮助、版本、模型列表、HTML 导出和包管理等不需要 Session Runtime 的控制
命令也继续通过旧 `main()` 进入。该结构无法准确回答“为什么启动了 Legacy Agent”，也使旧执行实现难以独立移除。

本轮目标是：

1. 建立唯一的 CLI Legacy 执行 Gateway，并为每次执行提供穷尽原因。
2. 将控制命令从 Legacy Agent 执行中分离，但保持原参数、输出、退出码和资源加载行为。
3. 保留显式 Legacy、Extension 能力回退和旧会话迁移回退。
4. 用静态守卫、纯 Gateway 测试和正式单文件产物共同证明边界。

## 审计结论

### 1. 剩余 Legacy 执行只有三类真实原因

| 执行原因 | 入口 | 证据 |
| --- | --- | --- |
| `explicit-selection` | `--agent-runtime legacy` | 用户显式选择 |
| `extension-compatibility-gap` | Greenfield Extension 准备结果 | `legacy-extension` 及具体 event/capability 缺口 |
| `session-migration-gap` | 旧会话迁移结果 | `legacy-session` 及 `locked`、`not-representable`、`failed` 状态 |

帮助、版本、模型列表、导出和包管理不是 Agent 执行原因。它们不创建 `AgentSession`，因此不应继续被统计为
Legacy Runtime。

### 2. 控制命令可以中性化，但本轮不应顺便优化功能

- `--help`、`--version` 只输出已有元数据。
- `--list-models` 使用共享 Model Registry。
- `--export` 使用既有 Legacy JSONL 格式读取与 HTML 导出能力。
- `install`、`remove`、`update`、`list` 使用既有 Package Manager 和 Settings。

为避免架构重构引起功能变化，本轮控制入口仍复用原共享 Bootstrap。尤其模型列表仍保持模型目录和动态资源
加载时序；本轮只消除 Session Runtime/Legacy Agent 依赖，不改变控制命令启动优化策略。

## 实施内容

### 1. 提取共享 CLI Bootstrap

新增 `coding-agent-cli-bootstrap.ts`，承载原 `main.ts` 中的 `createAgentCliBootstrap()`：

- 保持 Settings 和 Extension 错误输出不变。
- 继续返回同一个 `CodingAgentHostBootstrap` 合同。
- `@vetta/coding-agent/bootstrap` 改为直接导出该中性实现。
- 旧根 API 和 `main.ts` 仍转发同一函数引用，保持公开兼容。

### 2. 建立中性 CLI Control Host

新增 `coding-agent-cli-control.ts` 和公开子路径 `@vetta/coding-agent/cli-control`：

- `runCodingAgentCliControl(args)` 负责识别并执行全部控制命令。
- `runCodingAgentCliControlWithBootstrap(bootstrap)` 让旧公开 Legacy 入口继续兼容已经构造好的 Bootstrap。
- Package Command 的解析、帮助、进度、Settings 更新和错误处理从 `main.ts` 原样迁移。
- Help、Version、Model List、Export 的输出和 `process.exit` 语义保持不变。
- Export 继续读取旧格式，但旧格式兼容不再等同于启动旧 Agent。

`main.ts` 现在只负责“先尝试控制命令，否则启动 Legacy Agent”的兼容组合，不再拥有控制命令实现。

### 3. 建立唯一 Legacy 执行 Gateway

CLI App 新增 `legacy-runtime-gateway.ts`，成为唯一允许导入
`@vetta/coding-agent/legacy/cli` 的生产模块。Gateway 接受穷尽联合：

- `explicit-selection`
- `extension-compatibility-gap`
- `session-migration-gap`

两类自动回退会校验执行原因与既有 fallback evidence 是否一致；原
`assertAllowedAutomaticLegacyRuntimeFallback()` 仍在 Runtime Selector 中负责证据完整性和允许状态集合。由此形成：

```text
Runtime Selector
  -> 自动回退证据策略
  -> 结构化 Legacy 执行原因
  -> Legacy Runtime Gateway
  -> 旧 CLI / AgentSession
```

控制命令直接进入 Control Host，不经过 Gateway。显式 `--agent-runtime legacy --help` 也只显示帮助，不启动
Legacy Agent。

### 4. 收紧静态质量守卫

`check-package-boundaries.mjs` 现在要求：

- `@vetta/coding-agent/legacy/cli` 只能由 `legacy-runtime-gateway.ts` 导入。
- CLI App 其他生产模块不能使用 `runLegacyAgent` 或 `runLegacyAgentWithBootstrap`。
- Greenfield 产品模块继续使用原有更严格的 Legacy startup symbol 守卫，避免重复诊断。
- Legacy Session Format Adapter 白名单保持不变，格式兼容和执行兼容仍是两个边界。

### 5. 类型检查闭包

新增的 `@vetta/coding-agent/cli-control` 子路径同时接入：

- Coding Agent `package.json` exports。
- 根 `tsconfig.json` 源码 path map。
- CLI App Vitest alias。
- Desktop 独立 `tsconfig.json` path map。

Desktop path map 是必要项：Desktop 自己覆盖了根 paths，并会类型检查 CLI App 源码；只修改根 tsconfig 会造成
根/CLI 检查通过而 Desktop 报找不到新子路径。

## 测试调整

### Gateway 测试

新增 3 项纯测试：

1. 显式选择只调用旧 `main(args)`。
2. Extension 缺口使用已构造 Bootstrap 和 Runtime Decision 启动旧执行。
3. 执行原因与 fallback evidence 不一致时 fail-closed，不调用旧执行。

### 正式单文件产物

Print 套件扩展控制命令场景，并直接运行正式 `compile-standalone.mjs` 产物：

- 即使携带 `--agent-runtime legacy`，Help 也不进入 Session Runtime。
- Version 保持版本输出。
- Model List 继续找到 fixture 模型。
- Legacy JSONL HTML Export 继续成功生成正式 HTML 产物。
- 四类控制命令均不输出 Runtime decision。

既有 17 项 Print/Legacy 差分、Provider、Tool、Extension 和旧会话场景保持通过。

### Package Command 基线修正

移动 Package Command 后运行其既有测试，发现 3 个断言仍写死历史命令名 `pi`，而生产事实源早已是
`APP_NAME=vetta`。测试改为引用 `APP_NAME`，没有修改 Package Manager 行为；安装、删除、帮助、未知参数和
缺少 source 共 5 项均通过。

## TypeBox / Zod 判断

本轮新增的是进程内 TypeScript 联合、Bootstrap 对象和函数调用，没有新增 JSONL、配置、持久化或跨进程
wire。执行原因使用穷尽联合与运行时原因一致性断言即可；引入 TypeBox/Zod 会重复内部类型检查，因此未引入。

## 验证结果

- Legacy Runtime Gateway：3 项通过。
- Coding Agent 公开子路径：2 项通过。
- Package Command：5 项通过。
- 质量守卫：35 项通过。
- 真实 RPC Runtime 选择：10 项通过。
- 正式单文件 Print/Control：18 项通过。
- `bun run check:quick`：通过。
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和全部质量守卫通过。

## 明确未修改

- 没有删除 Legacy Agent、Legacy CLI 或 `--agent-runtime legacy`。
- 没有改变 Extension 和旧会话自动回退的允许集合。
- 没有改变 Tool、Prompt、Skill、MCP、Knowledge、Memory 或模型调用。
- 没有改变旧会话格式、迁移算法或 HTML 导出算法。
- 没有以缩小单文件产物为目标；只要兼容执行入口存在，产物仍需包含 Legacy 实现。
- 没有更新之前的过程文档，只新增本轮实施记录。

## 结果

CLI 生产代码现在只有一个 Legacy 执行入口，并且每次进入都能归因于显式选择、Extension 能力缺口或旧会话
迁移缺口。控制命令已成为中性宿主能力，Legacy 格式读取也不再被错误等同于旧 Agent 执行。

## 下一步

下一阶段应建立“Legacy 回退缺口消减矩阵”，而不是立即删除旧实现：

1. 按 Extension event/capability 列出现存真实缺口及调用基线，逐项判断可无损迁移、只适用于特定宿主或应版本拒绝。
2. 将旧会话 `locked`、`not-representable`、`failed` 分开处理：锁冲突应优先形成等待/明确失败策略，格式问题需要修复或只读保留，目标冲突需要确定性恢复策略。
3. 每关闭一个缺口，就移除对应自动回退成员并增加“不再进入 Gateway”的真实进程门禁。
4. 最后单独评估显式 Legacy 选项的移除时机；该步骤属于产品兼容决策，不能和技术回退缺口混为一谈。
