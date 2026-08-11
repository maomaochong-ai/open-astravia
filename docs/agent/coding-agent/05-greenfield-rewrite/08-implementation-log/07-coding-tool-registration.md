# 实施日志：Coding Tool 注册边界与差分合同

本文件记录 Coding Tool 注册边界与差分合同的实施与验证。

## 2026-07-26：Coding Tool 注册边界与差分合同

### 目标

补齐 `current_time` 首个纵向切片尚未覆盖的注册语义，并把单工具手写对比改为后续工具可以
复用的差分合同：

- Tool 执行定义不绑定 Coding 场景。
- `scope_use` 和 `category` 由 Coding 能力注册层持有。
- 会话场景不与 Agent Profile ID 混用。
- 旧新定义、注册和执行通过同一观察合同对比。

### 修改范围

- 新增 `tool-registration.ts`：
  - `CodingToolScope` 和旧场景全集。
  - `CodingToolCategory`。
  - `CodingToolRegistration`。
  - 默认 `cli` 场景。
  - 按场景选择 Runtime Tool Definition 的纯函数。
- 在 `tools/current-time/` 新增 `registration.ts`：
  - 保留旧 `scope_use` 的七个场景。
  - 保留 `category: "core"`。
  - 注册对象与 `RuntimeToolDefinition` 分离。
- `createCodingToolsFeature()`：
  - 由组合根通过 options 传入会话场景。
  - 未传场景时保持旧系统的 `cli` fallback。
  - Agent Profile ID 不参与场景判断。
- 新增测试专用 Tool Compatibility Contract：
  - 比较模型可见定义和注册元数据。
  - 比较 fulfilled/rejected 结果。
  - 记录 update、phase 和已取消直接调用。
- `current_time` 差分测试改用统一合同。
- 对七个旧会话场景逐一比较旧 `resolveActiveToolNames` 和新选择器的最终工具集合。

### 明确未修改

- 未向通用 `RuntimeToolDefinition` 增加 `scope_use` 或 `category`。
- 未让 Kernel 认识 `im-claw`、`project`、`cli` 等 Coding 场景。
- 未迁移 read 或其他工具。
- 未切换生产 Profile、RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未删除包根对旧 `coding-agent` 工具的兼容转发。

### 测试

- `packages/runtime-tools`
  - `bun run test`
  - 2 个测试文件、9 个测试通过。
- 新增覆盖：
  - `current_time` 的 scope 和 category 旧新一致。
  - 七个场景的最终激活集合旧新一致。
  - 注册元数据不会污染 Runtime Tool Definition。
  - 场景筛选可以排除不属于当前场景的注册。
  - 兼容合同同时比较正常执行和已取消直接执行。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- `current_time` 的定义、执行和注册行为均已完成差分验证。
- Coding 场景属于能力编排层，不进入 Kernel，也不借用 Agent Profile ID。
- 新工具迁移可以复用相同差分观察合同，不再为每个工具重新手写定义和执行对比框架。
- 生产入口保持旧实现，不受本轮架构调整影响。

### 下一步

1. 从旧 read 测试提取共享 fixture，先让旧实现单独通过完整合同。
2. 扩展合同对文件环境和自定义 Read Operations 的观察，不在 Adapter 中归一化行为。
3. 在 `tools/read/` 实现新 read，生产源码不得导入旧 `coding-agent`。
4. 旧新 read 对文本、编码、图片、路径、锚点、截断、取消和错误全部一致后再加入 Feature。
# 实施日志：Read 工具迁移

本文件记录 Read 行为基线与独立 Runtime Read 接入相关实施。
