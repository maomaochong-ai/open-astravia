# 第 125 轮：Legacy 职责白名单与中性模型控制器

## 目标

在第 124 轮隔离 Desktop Legacy 组合后，进一步区分“真正依赖旧实现的职责”和“只是名称或组合位置带有
Legacy 的共享能力”：

- 将共享模型控制从 Legacy 会话服务中抽离；
- Desktop 不再调用返回完整 `RuntimeHostOptions` 的 Legacy 组合工厂；
- Desktop Legacy 兼容接口只保留 Backend、Catalog、History Reader；
- 用仓库级质量守卫限制生产 Legacy 入口，防止兼容代码重新扩散；
- 保留所有旧入口和旧会话行为，不进行功能重构。

## 审计结论

第 124 轮的 Desktop Legacy 兼容对象包含四项服务。逐项检查实现后，只有三项真正依赖旧会话：

| 服务 | 实际职责 | 分类 |
| --- | --- | --- |
| `LegacyCodingAgentSessionBackend` | 创建或恢复旧 `AgentSession` 并交付 Runtime Ports | Legacy 执行 |
| `LegacyRuntimeSessionCatalog` | 识别、列举、重命名和删除旧 JSONL 会话 | Legacy 格式兼容 |
| `LegacyRuntimeSessionFileHistoryReader` | 将旧 JSONL 分支投影为统一 History | Legacy 格式兼容 |
| `LegacyRuntimeSharedModelController` | 向 `ModelRegistry` 设置 Token、刷新远程模型 | 共享宿主适配 |

共享模型控制器不读取 Legacy 会话、不依赖 `AgentSession`，也不参与持久化格式判断，因此继续以 Legacy
命名会把通用宿主能力错误归入旧实现。

同时确认 Desktop 无需通过 `createLegacyRuntimeHostOptions` 取得执行模式、沙箱路径、Skill、Server URL
或提问能力。这些配置由外层 `RuntimeHost` 在创建会话时写入统一 `RuntimeSessionCreateRequest`，
`LegacyCodingAgentSessionBackend` 会从该请求建立旧会话选项。

## 实施

### 1. 提取中性共享模型控制器

新增 `ModelRegistryRuntimeSharedModelController`：

- 实现现有 `RuntimeSharedModelController` Port；
- `refreshAuth` 保持先设置 Server Token、再等待远程模型刷新；
- `refreshInBackground` 保持后台刷新语义；
- 从稳定 `@vetta/coding-agent/runtime-host` 子路径导出。

原 `LegacyRuntimeSharedModelController` 保留为带弃用标记的兼容子类，旧构造方式和
`instanceof ModelRegistryRuntimeSharedModelController` 均成立。

`createLegacyRuntimeHostOptions` 继续保留，但其 `sharedModelController` 已改用中性实现。

### 2. 将 Desktop Legacy 边界压缩为三个服务

`desktop-legacy-runtime-compatibility.ts` 不再调用 `createLegacyRuntimeHostOptions`，而是显式构造：

```text
DesktopLegacyRuntimeCompatibility
├── LegacyCodingAgentSessionBackend
├── LegacyRuntimeSessionCatalog
└── LegacyRuntimeSessionFileHistoryReader
```

兼容工厂输入从完整 RuntimeHost 配置收缩为唯一的 `modelRegistry`。共享模型控制器由 Desktop 主
Composition Root 直接使用中性实现构造，不再通过 Legacy 对象转交。

### 3. 建立生产 Legacy 白名单

扩展 `check-package-boundaries.mjs`：

- 将 `packages/cli-app` 纳入实际扫描范围；
- `@vetta/coding-agent/legacy/cli` 只允许出现在 CLI Runtime 选择入口；
- `@vetta/coding-agent/legacy/*` 的其他生产导入会失败；
- Legacy Runtime Adapter 符号只允许存在于 Coding Agent Adapter 目录和 Desktop 单一兼容模块；
- 新生产模块使用 catch-all Legacy 工厂或直接引入旧 Backend/Catalog/History 会被阻断。

测试代码仍可直接使用 Legacy 实现建立差分基线，守卫不会禁止测试。

### 4. 校验策略

本轮没有新增外部 JSON、环境变量或跨进程协议，因此不需要 TypeBox 或 Zod。边界由 TypeScript Port、
构造参数和 AST 级质量守卫保证。

## 验证

针对性测试：

- 质量守卫：1 个文件，35 项测试通过；
- Runtime 服务：1 个文件，4 项测试通过；
- Coding Agent 公开子路径：1 个文件，2 项测试通过；
- Desktop 结构、宿主和 Model Call Frame 差分：3 个文件，18 项测试通过；
- 合计：6 个文件，59 项测试通过。

真实 `bun run verify:ui:runtime-diff`：

- 未配置 Default 与显式 Greenfield：`blockingDifferences=[]`；
- 显式 Legacy 与显式 Greenfield：`blockingDifferences=[]`；
- 三路均通过 Knowledge 成功、中止和 Provider 失败；
- 三路均完成 Desktop 重启、锁释放、endpoint 删除、Provider 停止和正常退出。

最终质量门禁：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有删除 Legacy Backend、Catalog、History Reader、CLI 或公开兼容入口；
- 没有改变 Desktop、CLI、RPC、IM 的 Runtime 默认值或回退规则；
- 没有迁移、改写或重命名旧会话；
- 没有改变 Legacy JSONL 的识别、历史投影、重命名或删除行为；
- 没有改变 Tool、Prompt、Skill、MCP、模型调用和 Knowledge 行为；
- 没有把旧格式解析器错误地下沉到不拥有该格式语义的 Runtime Core。

## 结果

Desktop 生产组合中的 Legacy 依赖现在是可枚举且可执行守卫的：

1. 一个旧执行 Backend；
2. 一个旧格式 Catalog；
3. 一个旧格式 History Reader。

共享模型控制已经回到中性宿主适配边界，完整 Legacy options 工厂不再被 Desktop 消费。新增生产依赖
无法绕过 `check:guards` 静默扩散。

## 下一步

第 126 轮应拆开“旧格式兼容”和“旧 Agent 执行”，但仍不直接删除代码：

1. 为 Legacy Catalog/History 建立独立格式兼容合同，证明读取、列举、重命名和删除不依赖启动旧
   `AgentSession`；
2. 为 Legacy Backend 建立单独执行职责清单，区分 Desktop 显式回退、旧会话恢复和 CLI 默认入口；
3. 明确旧会话未来采用继续 Legacy 恢复、一次性迁移还是只读保留，涉及产品选择时停止并请求确认；
4. 保持 CLI 的 `legacy-session`、`legacy-extension`、`unsupported-session-selection` 三个回退原因，
   后续分别闭合，不能通过删除 fallback 掩盖能力缺口。
