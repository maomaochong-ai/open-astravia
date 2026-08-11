# 第 63 轮：CLI 显式类型门禁与 Build Surface 验证

## 问题

第 62 轮执行 `bun run check` 时，根 `tsgo --noEmit` 通过。后续单独使用
`packages/cli-app/tsconfig.build.json` 检查时出现三个错误：

```text
缺少 createCodingAgentPromptRuntime 导出
McpDeferredToolController.createFeature() 不接受参数
CodingAgentModelCallFrameComposerOptions 缺少 readMcpPromptState
```

这暴露出两个不同的类型检查口径：

1. 根 `tsconfig.json` 使用 workspace 源码 path map，检查当前源码。
2. `cli-app/tsconfig.build.json` 按 workspace 包的 `dist/*.d.ts` 检查真实构建消费面。

根 `--listFiles` 已确认包含
`packages/cli-app/src/greenfield-runtime-composition.ts`，所以问题不是根检查漏掉该文件；三个错误来自
`coding-agent` 和 `runtime-mcp` 的声明产物仍是第 61 轮版本。

此前将 `bun run check` 通过概括为“全部类型检查通过”不够准确：它只证明源码图通过，不证明生成
声明已经与源码同步。

## 修复

### 1. CLI 显式源码类型检查

根 `check:types` 现在顺序执行：

```text
root tsgo --noEmit
cli-app bun run typecheck
desktop-app tsc --noEmit
admin tsc -b
```

CLI 虽然仍在根 `include` 中，但额外显式执行自己的 `tsconfig.json`：

- 日志可以直接证明 CLI 门禁已运行。
- 未来根 `include` 调整时不会静默漏掉 CLI。
- 保持源码 path map，不依赖可能陈旧的生成声明。

### 2. 独立 Build Surface 门禁

新增：

```text
bun run check:types:build-surfaces
```

该命令执行：

```text
tsgo --noEmit -p packages/cli-app/tsconfig.build.json
```

它有意不并入只读 `bun run check`，原因是 build config 按真实 `dist/*.d.ts` 解析；上游源码修改后，
在声明尚未重新生成的正常开发窗口内它必须失败。把生成动作塞入 `check` 会让只读门禁产生文件
副作用，也会混淆源码错误和声明新鲜度问题。

正确使用顺序是：

```text
按正式依赖顺序生成 workspace 前置声明
-> bun run check:types:build-surfaces
```

### 3. 声明刷新与验证

本轮使用包级 TypeScript 编译器按依赖顺序刷新本地产物：

```text
coding-agent
-> runtime-mcp
-> cli-app build-surface noEmit check
```

没有手工编辑 `dist`，也没有改变正式构建图。刷新后，原来的三个 CLI build-config 错误全部消失。

## 验证

### CLI 源码覆盖

根和包级 `--listFiles` 均包含：

```text
packages/cli-app/src/greenfield-runtime-composition.ts
```

以下两种源码检查均通过：

```text
bun run --cwd packages/cli-app typecheck
bunx tsc --noEmit -p packages/cli-app/tsconfig.json
```

### Build Surface

```text
bun run check:types:build-surfaces
```

结果：通过。

### 完整门禁

```text
bun run check:quick
bun run check
```

结果：全部通过。`check` 输出已明确显示：

```text
bun run --cwd packages/cli-app typecheck
```

## 边界

- `bun run check` 是无生成副作用的源码门禁。
- `check:types:build-surfaces` 是声明生成后的消费门禁。
- 两者不能互相替代。
- 声明消费失败时先检查上游声明是否过期，不能通过修改 CLI 调用方式或降低类型约束掩盖。

