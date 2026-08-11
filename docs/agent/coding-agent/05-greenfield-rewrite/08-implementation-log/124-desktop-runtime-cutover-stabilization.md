# 第 124 轮：Desktop Runtime 切换收口与 Legacy 组合隔离

## 目标

在第 123 轮把 Desktop 默认 Runtime 切换到 Greenfield 后，收紧生产组合边界并补齐诊断：

- RuntimeHost 与 Knowledge Poller 消费同一个不可变进程决策；
- 同时记录用户请求的 Runtime、实际生效的 Runtime 和配置来源；
- 观察每次会话究竟由默认后端、Legacy Catalog 还是 Conversation V2 Catalog 路由；
- 将 Desktop 的 Runtime 组合从生命周期入口中拆出；
- 把旧 `createLegacyRuntimeHostOptions` 限制在单一兼容模块；
- 为 Desktop 仍需使用的 Coding Agent 宿主服务提供稳定公开子路径。

本轮只调整架构、诊断和组合位置，不改变任何 Agent 产品功能。

## 架构结论

Desktop 存在两个不同层级的选择，不能混为一个“当前 Runtime”变量：

```text
进程启动决策
requestedBackend + effectiveBackend + source
                 |
                 +-> 新会话默认后端
                 +-> Knowledge processing 后端
                 |
                 v
会话恢复路由
default | legacy-catalog | conversation-v2-catalog
```

进程启动决策在模块首次加载时冻结，保证同一 Desktop 进程中的 RuntimeHost 与 Knowledge Poller
不可能因为读取环境变量的时机不同而分叉。它只决定新会话的默认值；已有会话仍由持久化格式目录路由，
因此显式或默认 Greenfield 不会覆盖 Legacy 会话身份。

这里没有引入自动 fallback。无效环境变量继续在启动时抛错，未知的持久化会话格式继续由 Catalog Router
拒绝，避免将配置或数据问题伪装成 Legacy 回退。

## 实施

### 1. 建立不可变进程决策

Desktop selector 新增结构化决策：

- `requestedBackend`：`default | legacy | greenfield`；
- `effectiveBackend`：`legacy | greenfield`；
- `source`：`default | environment`。

`desktop-runtime-decision.ts` 在进程模块初始化时只解析一次
`VETTA_DESKTOP_AGENT_RUNTIME`。Runtime 组合和 Knowledge Poller 均直接消费这一个对象，原有
`resolveDesktopAgentRuntimeBackend` 继续作为兼容函数保留。

### 2. 增加会话路由观察合同

`CatalogRoutedRuntimeHostSessionBackend` 的路由条目新增可选稳定 `id`，并提供
`onRoute({ routeId, source })` 观察回调：

- 新会话使用默认后端：`source=default`；
- 已有 Legacy 会话：`routeId=legacy`、`source=catalog`；
- 已有 Conversation V2 会话：`routeId=greenfield`、`source=catalog`。

回调只在成功选中后端后触发。未知会话不会伪造路由事件，仍保持原有错误语义。观察信息只写实现身份和
选择原因，不暴露会话文件路径或用户内容。

### 3. 拆分 Desktop Composition Root

原 `src/main/runtime.ts` 同时拥有进程单例、模型服务、Legacy Adapter、Greenfield 资源、Catalog、
路由和退出清理。现在拆为：

- `runtime.ts`：只保留 RuntimeHost/Greenfield Pool 单例、获取入口和关闭生命周期；
- `desktop-runtime-composition.ts`：生产组合、Catalog、路由和诊断；
- `desktop-coding-agent-host-services.ts`：Desktop 对 Coding Agent 宿主服务的适配；
- `desktop-legacy-runtime-compatibility.ts`：唯一 Legacy 组合兼容边界；
- `desktop-runtime-decision.ts`：唯一进程决策事实源。

`runtime.ts` 不再知道 Legacy 组合函数、Catalog 具体实现或模型注册表构造细节。

### 4. 收紧 Coding Agent 宿主服务公开面

新增稳定子路径 `@vetta/coding-agent/host-services`，公开 Desktop 组合仍需使用的
`AuthStorage`、`ModelRegistry` 和 `SettingsManager`。原 `legacy/host-services` 保留为带弃用标记的
兼容转发，避免本轮删除既有消费者功能。

Desktop 生产组合不再导入 `@vetta/coding-agent/legacy/*`。旧
`createLegacyRuntimeHostOptions` 在生产代码中只允许由
`desktop-legacy-runtime-compatibility.ts` 调用。

## 架构守卫与测试

新增或扩展以下门禁：

- selector 精确验证 requested/effective/source；
- Runtime Core 验证 default/catalog 路由观察，以及未知会话不产生观察事件；
- Coding Agent 验证稳定 `host-services` 子路径和 package exports；
- Desktop 结构守卫验证生产组合不依赖 `legacy/*`、旧组合函数只有一个调用点、`runtime.ts` 保持轻薄；
- Knowledge Poller 验证模块初始化时使用共享 Greenfield 决策；
- Legacy/Greenfield 宿主生命周期和 Model Call Frame 差分继续运行。

针对性测试结果：

- Coding Agent：1 个文件，2 项测试通过；
- Runtime Core：1 个文件，3 项测试通过；
- Desktop：6 个文件，26 项测试通过；
- 合计：8 个文件，31 项测试通过。

真实 `bun run verify:ui:runtime-diff` 结果：

- 未配置 Default 与显式 Greenfield：`blockingDifferences=[]`；
- 显式 Legacy 与显式 Greenfield：`blockingDifferences=[]`；
- 三路均通过 Knowledge 成功、中止、Provider 失败；
- 三路均完成 Desktop 重启、会话锁/原始文件锁释放、endpoint 删除、Provider 停止和正常退出。

最终质量门禁：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有删除 Legacy Backend、Legacy Catalog、旧公开子路径或兼容适配器；
- 没有迁移、改写或重命名任何已有会话；
- 没有改变 CLI、RPC、IM 的 Runtime 选择策略；
- 没有增加自动 fallback；
- 没有改变 Tool、Prompt、Skill、MCP、Todo、模型调用或 Knowledge 业务行为；
- 没有改变 Runtime 的进程级资源所有权和退出清理顺序。

## 结果

Desktop 默认切换后的边界已经稳定：

1. 进程选择与会话恢复路由被明确分层；
2. RuntimeHost 与 Knowledge 不再各自解析环境变量；
3. Desktop 生命周期入口不再承担生产组合细节；
4. Legacy 仍完整可回退，但生产组合依赖被压缩到一个可审计兼容模块；
5. 新旧实现的真实产品合同继续保持零阻断差异。

## 下一步

第 125 轮应以“证明 Legacy 是否仍有独占职责”为目标，而不是直接删除 Legacy：

1. 建立生产组合依赖清单，区分共享宿主服务、Legacy 独占实现和仅测试基线；
2. 为每个 Legacy 独占职责增加 Greenfield 等价实现或可执行差分门禁；
3. 定义 Legacy 删除前的硬性进入条件、观测周期和回滚窗口；
4. 进入条件全部满足后，再单独实施会话兼容读取与 Legacy 物理删除。
