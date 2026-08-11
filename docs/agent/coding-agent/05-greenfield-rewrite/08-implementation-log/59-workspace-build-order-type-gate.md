# 第 59 轮：Workspace 构建顺序纠偏与类型门禁补漏

## 问题

第 58 轮最初只执行了：

- 根 `bun run check`；
- 继承根 `tsconfig.json` path mapping 的 CLI 类型检查；
- `bun install --lockfile-only`。

这不足以证明包发布配置可解析新依赖。单独检查 `runtime-mcp/tsconfig.build.json` 时实际出现：

```text
TS2307: Cannot find module '@vetta/runtime-core/kernel'
TS7006: Parameter 'context' implicitly has an 'any' type
```

第二个错误是第一个错误导致类型信息丢失后的派生错误，不应该用局部参数标注修补。

## 根因

### 1. Workspace 链接未同步

`runtime-mcp/package.json` 已声明 `@vetta/runtime-core`，锁文件也已更新，但 `bun install --lockfile-only` 不更新 `node_modules` workspace 链接。因此根检查可通过源码 path mapping，而包发布配置按 package exports 解析时失败。

执行正常 `bun install` 后，`runtime-mcp/node_modules/@vetta/runtime-core` 被正确创建，两个错误同时消失。

这是开发环境同步要求，不需要新增运行时代码兜底。

### 2. 生产构建顺序与正式依赖图相反

审计 `scripts/build.sh` 和 package manifests 后发现：

```text
@vetta/coding-agent
  -> dependencies: @vetta/runtime-core
```

但旧构建顺序是：

```text
coding-agent
  -> runtime-core
```

这会让 `coding-agent` 读取上一次残留的 `runtime-core/dist/*.d.ts`。旧 dist 恰好匹配时构建偶然成功；干净环境或 dist 过期时则出现大量“缺少导出”错误。

## 修复

生产构建分层调整为：

```text
Layer 0
  ai / agent / action-rpc / telemetry / ecosystem-adapter / ...

Layer 1
  capability-runtime
  runtime-core

Layer 2
  coding-agent

Layer 3
  runtime-tools
  runtime-storage
  runtime-mcp

Layer 4
  cli-app
  desktop-app
```

`runtime-core` 的 `devDependencies` 包含 `coding-agent`，但只用于测试，不是 `runtime-core/src` 的生产依赖，因此不构成生产构建环。

## 自动门禁

新增 `check-build-order.mjs`：

1. 从 `scripts/build.sh` 提取并去重 `build_pkg packages/...` 顺序。
2. 读取对应 package manifests。
3. 检查 `dependencies`、`optionalDependencies`、`peerDependencies` 中的 `workspace:*`。
4. 如果依赖方先于被依赖方构建，`check:guards` 直接失败。
5. 明确忽略 `devDependencies`，避免把测试边误判为生产构建环。

该门禁已接入 `check:quick` 和根 `check` 共用的 `check:guards`。

## 测试

质量门定向测试覆盖：

- 构建包顺序解析和重复调用去重；
- 正确顺序通过；
- 依赖方在前时给出明确错误；
- 测试专用 `devDependency` 不参与生产顺序。

验证结果：

- 正常 `bun install` 后，`runtime-mcp/tsconfig.build.json` 独立检查通过。
- CLI 源码 TypeScript 配置检查通过。
- `bun run test:quality`：25 项全部通过。
- `bun run check:quick`：通过，构建顺序守卫检查 18 个包。
- 根 `bun run check`：Biome、全仓/desktop/admin 类型检查和全部 guards 通过。

## 明确未修改

- 未给隐式 `any` 补局部类型以掩盖模块解析失败。
- 未把根 path mapping 删除；源码级全仓检查仍需要它。
- 未让运行时代码动态解析 workspace。
- 未修改 MCP、Agent 或工具业务功能。
- 未把 `devDependencies` 强行纳入生产构建图。

## 后续规则

新增或调整 workspace 正式依赖时：

1. 更新 package manifest。
2. 执行正常 `bun install`，不能只更新 lockfile。
3. 确认 `scripts/build.sh` 中被依赖包先构建。
4. 运行包自身 `tsconfig.build.json` 检查和根 `bun run check`。
