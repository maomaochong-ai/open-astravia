# 第 60 轮：Desktop 前置构建图纠偏与 `TS5055` 回归门禁

## 现象

Desktop 的 workspace 前置构建在构建 `coding-agent` 时失败：

```text
TS5055: Cannot write file 'packages/coding-agent/dist/utils/clipboard.d.ts'
because it would overwrite input file.
```

同类错误共触发 142 项。它们不是 142 个相互独立的源码类型错误，而是同一条错误声明输入链产生的级联结果。

## 根因

仓库有两个独立的 workspace 构建入口：

1. 根 `scripts/build.sh`；
2. `packages/desktop-app/scripts/build-workspace-prereqs.mjs`。

第 59 轮只纠正了根构建脚本。Desktop 脚本仍维护一份手写依赖图，其中：

```text
coding-agent -> 未声明 runtime-core
runtime-core -> 错误声明 coding-agent
```

因此 Desktop 仍先构建 `coding-agent`。此时 TypeScript 从陈旧的 `runtime-core/dist/*.d.ts` 读取旧声明；旧声明又反向导入 `@vetta/coding-agent`，解析到 `coding-agent/dist`。这些待输出的 `.d.ts` 因而同时成为编译输入，触发 `TS5055`。

当前生产源码的真实方向是：

```text
runtime-core -> coding-agent -> runtime-tools/runtime-storage/runtime-mcp
```

`runtime-core` 对 `coding-agent` 的引用只存在于测试用 `devDependencies`，不属于生产构建图。

## 实施

### 1. 移除重复的手写依赖边

Desktop 脚本现在只显式维护：

- 参与前置构建的 package 目录；
- 可并行执行的构建层。

每个包的正式 workspace 依赖从其 `package.json` 动态推导，范围包括：

- `dependencies`；
- `optionalDependencies`；
- `peerDependencies`。

`devDependencies` 明确不参与生产构建顺序。

### 2. 纠正 Desktop 构建分层

关键顺序调整为：

```text
agent / capability-runtime
  -> runtime-core
  -> coding-agent
  -> runtime-tools / runtime-storage / runtime-mcp
  -> cli-app
```

这与正式 package manifests 以及根构建入口保持一致。

### 3. 让构建图变化失效旧缓存

Desktop 的增量构建缓存原来只包含根 manifest、锁文件和 TypeScript 基础配置。现在把前置构建脚本自身也纳入全局哈希。

构建层或依赖推导逻辑变化后，所有相关前置包会重新构建，陈旧的 `runtime-core/dist` 不会继续被缓存判定掩盖。

### 4. 覆盖第二个构建入口

`check-build-order.mjs` 现在同时检查：

- 根 `scripts/build.sh` 的线性顺序；
- Desktop 前置构建脚本的并行层顺序。

如果正式 workspace 依赖与依赖方处于同层，或依赖方位于更早层，质量门会直接失败。

Desktop 构建配置以 import-safe 方式导出；被质量门导入时不会执行实际构建。

## 测试

新增回归用例验证：

- Desktop 中依赖方先于被依赖方时失败；
- Desktop 中依赖与依赖方处于正确前后层时通过；
- 测试专用 `devDependency` 不进入生产构建图。

最终结果：

- `bun run check:quick`：通过；构建顺序守卫检查根入口 18 个包、Desktop 前置入口 16 个包；
- `bun run test:quality`：26 项全部通过；
- `runtime-mcp/tsconfig.build.json` 独立无输出检查：通过；
- `cli-app/tsconfig.json` 独立无输出检查：通过；
- 根 `bun run check`：Biome、根/desktop/admin 类型检查和全部 guards 通过；
- 先执行 `runtime-core/tsconfig.build.json`，再执行 `coding-agent/tsconfig.build.json` 的真实声明输出：两步均通过，未再出现 `TS5055`。

## 明确未采用

- 未关闭 declaration emit 来规避 `TS5055`；
- 未通过删除 `dist` 掩盖错误构建顺序；
- 未修改 `coding-agent` 的工具、Prompt、Skill、会话或模型调用功能；
- 未给级联出现的隐式 `any` 逐个补类型；
- 未引入第三份依赖关系配置。

## 约束

以后修改 workspace 正式依赖时：

1. package manifest 是依赖关系唯一事实来源；
2. 根构建顺序和 Desktop 构建层必须同时通过守卫；
3. 构建入口自身的变化必须能使增量缓存失效；
4. 包级发布配置与根源码配置都需要通过类型检查。
