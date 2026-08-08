# 质量门禁（Quality Gates）

本仓库**没有**照搬 OpenClaw 的 oxlint/pnpm/巨型 CI 矩阵。在现有 **Bun + Biome + tsgo + Vitest + husky + Desktop `verify:ui`** 之上，补了分层门禁、按包/按变更测试与轻量架构守卫。

## 门禁分层

| 层级 | 命令 | 何时跑 | 内容 |
|------|------|--------|------|
| 提交前（快） | `bun run check:precommit`（husky 自动） | 每次 commit | staged 私钥/冲突标记 + Biome `--staged --write`；格式化后重新暂存整文件 |
| 开发中（快） | `bun run check:quick` | 一轮编辑后 | 准确合并分支已提交差异、暂存、未暂存和未跟踪文件；对变更文件运行 Biome，并运行架构守卫；不做类型检查 |
| 完整本地/PR | `bun run check` | 一轮代码任务完成、交付或开 PR 前一次 | 对显式源码根运行 Biome，并行执行根 `tsgo`、CLI 显式 `tsgo`、增量 desktop `tsc`、admin `tsc` 与架构守卫 |
| 构建声明消费 | `bun run check:types:build-surfaces` | workspace 前置声明生成后 | 按 `cli-app/tsconfig.build.json` 验证真实包声明消费；会拒绝陈旧 `dist/*.d.ts` |
| 质量脚本测试 | `bun run test:quality` | 修改 `scripts/quality` | 变更选择、依赖传播与包边界规则 |
| 单元测试 | `bun run test:unit` | 逻辑变更 | 当前有测试的核心包 |
| 按包 | `bun run test:pkg <name>` | 改单包 | 例：`test:pkg ai` |
| 按变更 | `bun run test:changed` | 提 PR 前可选 | 合并已提交/工作区/未跟踪改动，测试触达包及其下游依赖 |
| UI | `bun run verify:ui:*` | Renderer/Main 可见变更 | 见 [README](./README.md) |
| 死代码（可选） | `bun run deadcode:report` | 清理时 | Knip 报告，**默认不阻断** `check` |

## 新增脚本

```text
scripts/quality/
  lib.mjs                      共享工具
  precommit.mjs                快路径编排
  check-lint.mjs               显式源码根的全量 Biome 入口
  check-guards.mjs             并行全量守卫入口
  check-quick.mjs              按完整 Git 工作区差异做快速检查
  check-private-keys.mjs       私钥形态检测
  check-conflict-markers.mjs   未解决冲突标记
  check-build-order.mjs        workspace 正式依赖构建顺序
  check-package-boundaries.mjs 库/插件不得依赖 app 宿主
  check-coding-agent-architecture.mjs
                               Coding Agent 当前架构依赖与公开面
  test-pkg.mjs                 按包名跑 vitest
  test-changed.mjs             按 git 变更和依赖图选包
  quality-gates.test.mjs       质量脚本定向测试
knip.config.ts                 Knip（可选）
```

## 根 package.json scripts

| Script | 说明 |
|--------|------|
| `check:lint` / `check:lint:fix` | 对显式源码根执行 Biome 只读检查 / 写回，避免扫描无关目录 |
| `check:types` | 并行执行根 `tsgo`、CLI 显式 `tsgo`、带持久增量缓存的 desktop `tsc`、admin `tsc -b` |
| `check:types:build-surfaces` | 使用 CLI build config 验证上游 workspace `dist/*.d.ts` 的真实消费面；要求先生成当前声明 |
| `check:guards` | 并行执行私钥、冲突标记、包边界等全量守卫 |
| `check:staged` | 仅 staged Biome |
| `check:precommit` | husky 使用的快路径 |
| `check:quick` | 变更文件 Biome + 全量 guards；Biome 配置变化时自动回退全量 Biome |
| `check` | 并行 lint + types + guards（只读） |
| `fix` | Biome 全量格式化与安全修复 |
| `test:quality` | 质量脚本定向测试 |
| `test:unit` | ai / agent / coding-agent / ecosystem-adapter |
| `test:pkg` | 见 `bun run test:pkg --list` |
| `test:changed` | 默认比较 `origin/dev`；`--base origin/main` 可改基线 |
| `deadcode` / `deadcode:report` | Knip 严格 / 仅报告 |

### 单测覆盖率（可选，不进门禁）

根依赖 `@vitest/coverage-v8`（与 `vitest` 3.x 对齐）。**默认 `test` / husky / `check` / CI 均不启用**覆盖率。

按需在包根执行：

```bash
bun run --cwd packages/coding-agent test:coverage
bun run --cwd packages/desktop-app test:coverage
```

- 报告目录：包内 `coverage/`（已 gitignore）；含 text / html / lcov
- 分母：`src/**/*.{ts,tsx}`（诚实全量；desktop 总百分比低是现状，不是配置错误）
- `reportOnFailure: true`：单测失败仍会出报告（coding-agent 在 Windows 上仍有已知基线失败）
- 不设全局 thresholds；不进 husky / `check` / CI；UI 验收仍用 `verify:ui:*`
- `@vitest/coverage-v8` 主版本须与根 `vitest` 对齐（当前均为 3.2.x）

## 包边界规则（`check-package-boundaries`）

依赖方向与 README 一致：**应用 → runtime-\* / coding-agent / agent / ai**；核心库不感知宿主。

守卫会扫描 lib/plugin 源码，禁止：

- 从 `packages/ai`、`agent`、`coding-agent`、`runtime-*`、`plugin-sdk` 等 **import 宿主应用**（`desktop-app` / `cli-app` / `admin` / `site` 及对应路径）
- 生产代码 import 其它包的 `test/` 树
- plugin presets/externals **deep-import** `desktop-app/src/**`

`coding-agent/examples/**` 已排除。

## Coding Agent 架构规则（`check-coding-agent-architecture`）

该守卫不生成全量 AST 模块图，也不启动 TypeScript TypeChecker。它只用 TypeScript AST 从
`import`、`export ... from` 和动态 `import()` 中提取模块边，再执行声明式规则，因此不会把注释、
字符串或同名变量误判为依赖。

长期规则包括：

- 合同不能反向依赖 Adapter、Composition 实现、Host 实现或公开门面；
- 产品能力域不能依赖 Adapter、Composition 实现或公开门面；
- Adapter 可以依赖 Composition 合同，但不能反向依赖 Composition 实现或公开门面；
- 历史会话格式模块不能依赖 Agent 执行；格式转换与文件生命周期可以在 `sessions/legacy` 边界内按职责拆分；
- 外部消费者只能使用 `package.json#exports` 声明的稳定子路径，支持精确和通配符导出；
- 包根保持 Extension facade；Composition 允许扩展根级能力与合同，但不能导出内部组装实现；
- 旧 `src/core`、`src/compat` 实现目录不得恢复。

公开子路径以 manifest 为唯一事实来源，不在守卫中维护第二份符号或子路径快照。旧迁移进度基线、
Greenfield/Legacy 名称墓碑、固定文件数量、行数阈值及实施日志格式不再进入构建门禁。
架构规则测试位于 `scripts/quality/coding-agent-architecture.test.mjs`。

## Workspace 构建顺序（`check-build-order`）

根 `scripts/build.sh` 与 Desktop 的 `packages/desktop-app/scripts/build-workspace-prereqs.mjs` 都必须先构建正式 workspace 依赖，再构建依赖方。守卫会分别检查：

- 根脚本中的 `build_pkg` 顺序；
- Desktop 前置构建脚本导出的分层；
- 各包 `dependencies`、`optionalDependencies`、`peerDependencies` 中声明的 `workspace:*` 正式依赖。

Desktop 前置构建脚本只维护参与构建的包和并行层，包之间的依赖直接从 manifest 推导，不再维护第二份容易过期的手写依赖图。

`devDependencies` 不参与生产构建顺序：例如 `runtime-core` 的测试会引用 `coding-agent`，但 `runtime-core/src` 不依赖它；把测试边计入会制造不存在的生产依赖环。

该守卫防止构建错误地读取上一次残留的 `dist/*.d.ts` 而偶然成功。新增 workspace 依赖后仍必须执行正常的 `bun install`；`bun install --lockfile-only` 只更新锁文件，不创建包级 workspace 链接。

`test:changed` 会读取可测包的 `package.json` 自动计算下游依赖闭包。`package.json`、`bun.lock`、根 TypeScript/Biome 配置和 `scripts/quality/**` 变化会触发全部核心测试；无效基线会直接失败，不会静默跳过。

`check:quick` 复用同一套 Git 变更选择器，因此不会漏掉未暂存或未跟踪文件。删除文件会从 Biome 输入中排除；修改任意 `biome.json` / `biome.jsonc` 或根 `.editorconfig` 时，会自动回退为全仓 Biome，避免配置影响未被检查。它不做类型检查，不能替代任务结束时的完整 `check`。

根 `tsconfig.json` 已包含 `packages/cli-app/src/**/*` 和 `packages/cli-app/test/**/*`。完整 `check`
仍额外显式执行 `packages/cli-app` 的 `typecheck`，避免未来调整根 `include` 时静默漏掉 CLI，也让
日志直接显示 CLI 门禁。

`check:types:build-surfaces` 与源码 typecheck 是不同口径：它不使用根源码 path map，而是按真实
workspace 包声明解析。因此，上游源码修改但 `dist/*.d.ts` 尚未重新生成时，该命令会失败。这是
声明新鲜度问题，不应通过手改 `dist` 或把生成动作塞进只读 `check` 解决；应先按正式依赖顺序
生成前置包声明，再运行该门禁。

## CI

`.github/workflows/quality.yml` 在 PR 和推送到 `dev` 时执行冻结依赖安装、`bun run check` 和质量脚本测试。CI 使用只读检查，不会自动修复候选提交。

四个核心包的历史测试目前仍有模型目录和跨平台相关的基线失败，因此暂不作为 PR 强制门禁。修复这些基线后，再将 `bun run test:unit` 加入 CI；在此之前它仍用于本地完整诊断，`bun run test:changed` 用于按影响范围验证。

## 与 OpenClaw 的对应关系（有意不做的）

| OpenClaw | 本仓库选择 |
|----------|------------|
| oxlint / oxfmt | 继续 **Biome**（已覆盖 lint+format） |
| 170+ test shards | `test:pkg` / `test:changed` 薄封装 |
| pre-commit 全家桶 | husky + 快路径；类型检查放 `check` |
| knip 阻断 CI | 仅扫描四个核心包，`deadcode:report` 先观察，再收紧 |
| OpenGrep / CodeQL | 未引入；有安全面再加 |
| Docker E2E 矩阵 | 继续用现有 `verify:ui` 与包内测试 |

## 推荐工作流

```bash
# 日常开发
# （commit 时 husky 自动 check:precommit）

# 改核心库
bun run test:pkg ai
bun run check:quick
bun run check

# 改多个包 / 不确定范围
bun run test:changed
bun run check:quick
bun run check

# 改 Desktop UI
bun run check
bun run verify:ui:start
# ... verify:ui:pw ...

# 可选清理
bun run deadcode:report
```

## 后续可增强（未做，待有痛点再上）

1. desktop i18n CJK **ratchet**（基线文件数，只许下降）——当前硬编码存量大，全量 fail 不现实  
2. CI path filter：只改 `packages/ai` 时跳过 desktop `tsc`  
3. Go：`packages/api` / `im-gateway` 的 `go test` / golangci-lint 挂到根 `check:go`  
4. Knip 收紧后纳入 `check`  
5. 插件 SDK **契约测试**（public API 形状快照）

## 核查清单

- [ ] `bun run check:guards` 通过  
- [ ] 根构建脚本和 Desktop 前置构建脚本中，所有正式 workspace 依赖都先于依赖方
- [ ] `bun run check:quick` 覆盖已提交、暂存、未暂存和未跟踪文件  
- [ ] `bun run test:quality` 通过  
- [ ] `bun run check:precommit` 在有 staged 文件时行为正确  
- [ ] `bun run test:pkg --list` 列出 4 个可测包  
- [ ] `bun run check` 仍包含类型检查（比 pre-commit 更严）  
- [ ] `bun run check` 输出中包含 `packages/cli-app` 的显式 `typecheck`
- [ ] 生成当前 workspace 声明后，`bun run check:types:build-surfaces` 通过
- [ ] husky `.husky/pre-commit` 调用的是 `check:precommit` 而非整仓慢 `check`  
- [ ] 未新增 oxlint/oxfmt/pnpm 强制依赖  
