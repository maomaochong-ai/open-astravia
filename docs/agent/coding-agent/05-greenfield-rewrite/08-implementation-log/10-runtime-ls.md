# 实施日志：独立 Runtime Ls 与默认暴露兼容

本文件记录独立 Runtime Ls 与默认暴露兼容的实施与验证。

## 2026-07-26：独立 Runtime Ls 与默认暴露兼容

### 目标

在不修改旧生产工具和默认工具集合的前提下迁移 ls：

- 新实现不导入 `coding-agent`。
- 保留完整描述、Schema、路径、排序、目录标记、限制、截断、错误和取消行为。
- 复用已经由 read 合同验证的路径与截断纯模块。
- 保留旧 `scope_use: []` 的默认不激活语义。

### 审计结论

旧 `ls` 的空 `scope_use` 不是遗漏。旧选择器采用 fail-closed：

```text
scope_use = []
-> 工具存在于可用/只读工具集合
-> 任何场景都不默认激活
-> 只能由宿主显式选择或按需激活
```

因此新实现不能像 read 一样声明七个场景。Coding Tools Feature 可以创建 ls 注册对象，但默认
Runtime Snapshot 必须继续只有 `current_time + read`。

旧执行中取消也不是完全协作式：Promise 会立即以 `Operation aborted` 拒绝，但已经开始的
Operations 会继续完成。合同记录这一事实，本轮不改变。

### 修改范围

- 新增 `tools/ls/`：
  - `ls-tool.ts`
  - `description.ts`
  - `registration.ts`
  - `index.ts`
- 新增 TypeBox `LsToolInputSchema` 和独立 Runtime `createLsTool()`。
- 新增可注入 `LsOperations`：
  - `exists`
  - `stat`
  - `readdir`
- 将共享路径函数改名为中立的 `resolveExistingPath`，同时保留 `resolveReadPath` 别名，
  read 行为不变。
- 新增 `LS_TOOL_SCOPES = []` 与 `LS_TOOL_CATEGORY = "core"`。
- Coding Tools Feature 注册 ls，但场景选择后默认不贡献该工具。
- 新增 Ls Behavior Contract、Legacy/Runtime Adapter、旧新差分和显式 Engine Tool Loop。

### 合同覆盖

- 完整 name、label、description、TypeBox Schema、scope 和 category。
- dotfile、目录 `/` 后缀和大小写不敏感排序。
- path 缺省/空字符串、相对、绝对、`~`、Unicode/CJK 空格模糊路径。
- macOS AM/PM 窄空格、NFD、弯引号和组合 fallback。
- 路径不存在、非目录、空目录和 readdir 错误。
- 默认 500 项、恰好命中 limit、零值和小数 limit。
- 单项 stat 失败跳过。
- 50KB 字节截断以及 entry/byte 组合提示和 details。
- 自定义 Operations 的路径与调用顺序。
- 提前取消和执行中取消后 Operations 继续运行的旧语义。

### 明确未修改

- 未修改旧 `coding-agent` ls 源码、description.txt 或注册。
- 未修改包根旧 `createLsTool` 兼容导出。
- 未把 ls 改成任何场景默认激活。
- 未增加 Workspace Root 限制或收紧 Number limit Schema。
- 未修复旧执行中取消后 Operations 继续运行的行为。
- 未切换 RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未迁移 grep、find、glob、tree 或其他工具。

### 测试

- 旧实现基线：
  - `bunx vitest --run test/coding/ls/ls-legacy-contract.test.ts`
  - 1 个测试文件、15 个测试通过。
- 旧新合同及 Feature：
  - 3 个测试文件、39 个测试通过。
- `packages/runtime-tools`
  - `bun run test`
  - 6 个测试文件、82 个测试通过。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- ls 工具模块完成独立迁移，生产源码不依赖旧工具。
- 旧新定义、执行、注册和所有场景默认激活集合一致。
- 显式选择的 Runtime ls 可以通过真实 Agent Core Tool Loop 执行。
- Greenfield 默认 Snapshot 没有扩大模型工具权限。
- 旧生产入口保持不变。

### 未解决问题

- Greenfield Feature 尚未定义生产级显式工具选择/按需激活合同；当前只证明 Runtime ls 可被
  显式组合。
- 执行中取消无法停止已经启动的旧式 Operations。改变它需要单独的行为迁移决策。
- 完整只读工具组仍缺少 grep、glob、find 和 dir_tree。

### 下一步

1. 设计并测试显式工具选择/按需激活合同，保持 scope fail-closed。
2. 为 grep 提取参数化旧行为矩阵。
3. 在合同约束下实现独立 Runtime grep。
4. 继续保留包根兼容导出和旧生产入口，直到完整 Profile 与 Host 差分通过。
