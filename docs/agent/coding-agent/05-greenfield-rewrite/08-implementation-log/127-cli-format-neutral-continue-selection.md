# 第 127 轮：CLI 格式中立 Continue 会话选择

## 目标

在第 126 轮拆开 Legacy 格式与执行兼容后，闭合显式 Greenfield CLI 的
`unsupported-session-selection` 中已经具备底层能力的部分：

- `--continue` 通过格式中立 Catalog 选择最近会话；
- 最近会话为 Greenfield 时直接恢复；
- 最近会话为 Legacy 时以 `legacy-session` 原因回退；
- 没有历史会话时创建 Greenfield 会话；
- `--resume`、Legacy Extension、默认 Runtime 和迁移策略保持不变。

## 审计结论

原实现把 `--continue` 和 `--resume` 合并为同一个 fallback，但两者语义不同：

- `--continue` 是无需交互的确定性选择；
- `--resume` 是交互式会话选择，而旧 CLI 的交互选择器也已经移除。

现有底层能力已经覆盖 `--continue`：

- `RuntimeSessionCatalog` 提供格式中立的会话列举合同；
- Legacy 和 Conversation Catalog 均支持指定 `cwd/sessionDir`；
- Greenfield Backend 已支持按 Conversation session ID 恢复；
- Composite Catalog 已能合并两种持久化格式。

因此缺口只在 CLI 选择策略和 Composition Root 接线，不需要修改 Runtime Kernel、Backend 或存储格式。

## 实施

### 1. 提取格式中立选择策略

新增 `greenfield-im-session-selection.ts`：

- 只依赖 `RuntimeSessionCatalog`；
- 显式 `--session` 优先，不访问 Catalog；
- 非 `--continue` 不访问 Catalog；
- `--continue` 从 Catalog 结果中按 `modifiedAt` 选择最近会话；
- 时间相同时用路径稳定排序；
- 不读取文件，不判断 Legacy 或 Conversation 格式。

### 2. 建立 CLI 格式兼容 Composition

新增 `cli-session-format-compatibility.ts`，显式组合：

```text
CompositeRuntimeSessionCatalog
├── LegacyRuntimeSessionCatalog
└── FileConversationRuntimeSessionCatalog
```

该模块只提供离线 Catalog，不创建 `AgentSession`，也不引用 Legacy Backend。CLI 入口把 Catalog 注入
Greenfield Host，Host 不再拥有具体格式实现。

### 3. 收缩 fallback

Greenfield Host 现在只对 `--resume` 返回 `unsupported-session-selection`。`--continue` 解析后的路径
继续复用原有会话路径分类：

| 输入 | 结果 |
| --- | --- |
| 最近为 `.conversation.jsonl` | Greenfield resume |
| 最近为 Legacy `.jsonl` | `legacy-session` fallback |
| 没有历史会话 | Greenfield create |
| `--resume` | `unsupported-session-selection` fallback |
| 存在旧 Extension | `legacy-extension` fallback |

这项变化只影响显式 `--agent-runtime=greenfield-im`。CLI 未指定 Runtime 时仍默认 Legacy。

### 4. 架构守卫

生产白名单新增唯一 CLI 格式兼容文件：

- 允许该文件使用 `LegacyRuntimeSessionCatalog`；
- 禁止该文件使用 `LegacyCodingAgentSessionBackend`；
- 其他 CLI 生产模块仍不能直接导入 Legacy Runtime Adapter。

CLI Vitest 配置补充既有 `@vetta/coding-agent/runtime-host` 公开子路径映射，使测试与生产 package
exports 一致。

### 5. Schema 选择

本轮没有引入 TypeBox 或 Zod。没有新增外部协议或不可信结构化输入；会话选择使用 TypeScript Port
和内部判别逻辑，文件合法性继续由 Legacy/Conversation Catalog 各自负责。

## 验证

针对性测试：

- 质量守卫：1 个文件，35 项测试通过；
- 会话选择策略与 Greenfield Host：2 个文件，7 项测试通过；
- 独立 Vetta CLI 进程：1 个文件，5 项测试通过；
- 合计：4 个文件，47 项测试通过。

真实 CLI 进程覆盖：

- Greenfield 新建、显式恢复和 `--continue` 恢复同一 session ID/path；
- 空目录 `--continue` 创建 Greenfield Conversation；
- Legacy 会话显式打开和 `--continue` 均回退旧执行；
- startup ownership conflict、owner lock 创建与释放保持原合同。

真实 `bun run verify:ui:runtime-diff`：

- Default 与显式 Greenfield：`blockingDifferences=[]`；
- 显式 Legacy 与显式 Greenfield：`blockingDifferences=[]`；
- 三路 Knowledge 成功、中止、Provider 失败及进程清理合同全部通过。

最终质量门：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有改变 CLI 未指定 Runtime 时的 Legacy 默认值；
- 没有实现或伪造 `--resume` 交互选择器；
- 没有改变 `legacy-extension` fallback；
- 没有迁移、改写或删除 Legacy 会话；
- 没有改变 Desktop、RPC、IM、Tool、Prompt、Skill、MCP、Knowledge 或模型调用行为；
- 没有把格式识别逻辑放入 CLI 选择策略或 `runtime-core`。

## 结果

`unsupported-session-selection` 不再作为 `--continue` 的笼统能力缺口。CLI 会话选择现在复用格式中立
Catalog，具体格式只存在于 Composition Adapter；Greenfield Host 只接收选择所需 Port。

## 下一步

第 128 轮应审计 `legacy-extension`：

1. 将旧 Extension 的 Tool、Prompt、Hook、命令和 UI 能力逐类映射到现有 Runtime/Plugin Port；
2. 区分可以直接适配的声明式能力与仍直接依赖旧 `AgentSession` 的命令式能力；
3. 先建立差分基线和缺口清单，再决定是否分批缩小 fallback；
4. 不通过禁用 Extension 或忽略回调来制造“兼容完成”。

`legacy-session` 的最终处理仍需要在继续旧执行、显式迁移和只读保留之间做产品决策。
