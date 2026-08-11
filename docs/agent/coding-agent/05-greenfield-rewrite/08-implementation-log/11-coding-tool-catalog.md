# 实施日志：动态 Coding Tool Catalog 与 Feature 解耦

本文件记录动态 Coding Tool Catalog 与 Feature 解耦的实施与验证。

## 2026-07-26：动态 Coding Tool Catalog 与 Feature 解耦

### 目标

修正 `CodingToolsFeatureOptions` 逐个暴露工具 Options 的扩展性问题：

- Feature 不认识 current_time、read、ls 或未来具体工具。
- 工具 Options 和环境依赖在组合根创建注册对象时注入。
- 工具可以动态注册和注销。
- 默认场景激活、显式追加和显式替代是独立编排合同。
- 动态变化不能修改已经编译或正在执行的 Runtime Snapshot。

### 修改范围

- 新增 `coding-tool-catalog.ts`：
  - `CodingToolCatalogSnapshot`
  - `CodingToolCatalog`
  - `CodingToolRegistry`
  - `InMemoryCodingToolRegistry`
- Registry：
  - 支持初始注册、动态 register 和 unregister。
  - 工具名重名时 fail-fast。
  - 每次有效修改增加版本。
  - 按工具名稳定排序并冻结成员快照。
  - 在注册边界复制 scope 元数据并冻结工具顶层定义。
- 新增 `CodingToolActivation`：
  - `mode: "scope"`。
  - `mode: "explicit"`。
- 新增 `selectCodingTools()`，保留 `selectCodingToolsForScope()` 兼容纯函数。
- `CodingToolsFeatureOptions` 收缩为：

```ts
interface CodingToolsFeatureOptions {
	readonly catalog: CodingToolCatalog;
	readonly activation?: CodingToolActivation;
}
```

- 删除 Feature 对 cwd、CurrentTimeToolOptions、ReadToolOptions 和 LsToolOptions 的认识。
- 测试组合根显式创建三个 Tool Registration 并注册到 Registry。

### 生命周期语义

```text
registry.register / unregister
  -> catalog.version + 1
  -> composition root 重新 compile
  -> AtomicRuntimeSnapshotProvider.swap(newSnapshot)
```

- Feature prepare 同步绑定当时的 Catalog Snapshot。
- prepare 之后的 Registry 变化不影响该 Feature 实例。
- 已编译 Runtime Snapshot 不读取可变 Registry。
- 当前 Turn 继续使用开始时获取的 Runtime Snapshot Lease。
- 自动监听和重编译由未来 Host Composition Root 负责，不由 Feature 控制 Runtime 生命周期。

### 激活语义

- scope 模式：`scopeUse` 包含当前场景的工具默认激活。
- scope 模式可通过 `additionallyEnabledToolNames` 激活 ls 等空 scope 工具。
- explicit 模式只激活显式名称，替代 scope 默认集合。
- 重复名称由 Set 去重。
- 未注册名称被忽略，保持 fail-closed。

### 明确未修改

- 未修改任何 Tool 的 Schema、描述、执行结果、错误、副作用或取消行为。
- 未修改旧生产工具注册和包根兼容导出。
- 未切换 RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未增加 Registry 自动监听、后台编译或 Host 自动 swap。
- 未把 Catalog 或 Coding 场景放入 Kernel 合同。
- 未迁移 grep 或其他新工具。

### 测试

- 新增 `coding-tool-catalog.test.ts`，覆盖：
  - 稳定排序、冻结快照和版本。
  - register/unregister 与旧快照隔离。
  - 初始/动态重名冲突。
  - scope 元数据边界复制。
  - class-backed Tool 的原型方法执行保持。
  - scope 追加激活、explicit 替代激活和未知名称。
- Feature 合同新增：
  - 同一 Registry 修改前后重新编译得到不同工具集合。
  - 修改前的旧 Runtime Snapshot 保持不变。
  - 空 scope 的 ls 通过 explicit Feature 激活进入真实 Agent Core Tool Loop。
- `packages/runtime-tools`
  - `bun run test`
  - 7 个测试文件、91 个测试通过。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- Coding Tools Feature 不再随着工具数量增长而修改 Options。
- 工具实现、注册目录、激活策略和 Runtime Snapshot 生命周期形成独立边界。
- 动态注册能力已建立，旧 Snapshot 隔离由自动测试验证。
- ls 可以通过正式 Feature 激活合同显式启用，默认暴露保持不变。
- 生产入口仍使用旧实现，本轮没有用户可观察功能变化。

### 未解决问题

- 生产 Composition Root 尚未创建 Registry，也没有监听外部能力变化后执行 compile/swap。
- Registry 当前是进程内实现；持久化启用选择属于 Host/Profile 配置，不属于 Catalog。
- 完整 Coding Tools 仍缺少 grep、glob、find、tree、write、edit 和进程工具。

### 下一步

1. 为 grep 提取旧行为矩阵和参数化合同。
2. 实现独立 Runtime grep，并通过 Registry 注册而不修改 Feature Options。
3. 继续迁移只读工具组。
4. 在生产 Profile/Host 阶段接入 Registry 重编译与 Atomic Snapshot 交换。
