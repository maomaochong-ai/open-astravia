# ADR-0079: Turborepo 持有 TypeScript Workspace 任务图

## 状态

Accepted

## 背景

仓库的 Bun workspace 已扩展到应用、Runtime、核心库、插件工具、Preset 和主题。此前根 `scripts/build.sh`、Windows `scripts/build.ps1`、Desktop 前置构建脚本和质量守卫分别维护包顺序、并行 layer、依赖闭包与内容哈希。包新增或依赖变化需要同步多份清单，已经出现跨平台脚本漂移；为了校验这些重复事实源，又需要额外的顺序守卫。

包自身的 `package.json#scripts.build` 已经是稳定执行入口，缺少的是统一任务图、并行调度、输出缓存和可观测性。Preset zip/staging、平台模型下载和 Electron 打包则包含领域校验、网络、平台或共享目录副作用，不能被通用任务调度器替代。

## 决策

- 使用固定版本的 Turborepo 作为 Bun/TypeScript workspace 的任务图和本地缓存层。Bun 继续负责 workspace、安装和脚本执行，tsgo、Vite、Next 与 electron-builder 继续生成实际制品。
- `package.json` 中的内部依赖声明是包图事实源，根 `turbo.json` 的 `build.dependsOn = ["^build"]` 负责依赖优先和可并行执行。删除根 shell/PowerShell 顺序、Desktop 手写包清单与 layer、通用 workspace 哈希缓存及其顺序守卫。
- 普通构建缓存 `dist/**`、`release/**` 和 `.next/**`；lockfile、内部依赖任务、根 `.env*` 和 `VETTA_*` 变量参与哈希。迁移期使用 loose environment mode 保持既有脚本环境可见性，后续收紧必须先形成完整变量合同。
- Desktop 完整 build 初始设为不可缓存，因为它组合平台语音模型、Preset/Theme staging、生成源码和多个 Vite 入口。正式 workspace 前置构建继续使用 `--force`；开发前置构建允许读取本地缓存。
- Remote Cache 默认关闭。启用属于后续安全和制品兼容决策，必须验证跨平台可移植性、环境变量覆盖、日志中无敏感信息、缓存完整性和失败回退后再修改本 ADR。
- Preset 的租户/profile 选择、冻结安装、工具构建、zip 校验与 Desktop staging 继续由 `build-presets.mjs` 持有；Turbo 只负责它调用或依赖的包级 build。Go IM Gateway 和 Kotlin Mobile 暂不包装为 JavaScript workspace 任务。
- 本地 `test:changed` 保留完整 Git 工作区语义，包括未暂存和未跟踪文件；Turbo affected 能力不替代这一合同。

## 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 继续扩展自研脚本 | 否决 | 会继续复制包图、缓存和跨平台执行逻辑，并需要更多守卫防止漂移 |
| 只使用 Bun workspace filter | 否决为最终方案 | 能减少手写顺序，但不提供声明式输出缓存、任务 dry-run、运行摘要和后续远程缓存边界 |
| 全量迁移 Desktop、Preset、Go、Kotlin | 否决 | 通用任务缓存无法替代领域制品、安全校验和原生平台生命周期 |
| Nx、Bazel 或 Pants | 暂不采用 | 当前变化集中在 JavaScript workspace 调度，引入更广的项目模型和迁移成本没有对应收益 |

## 后果

- 新 workspace 包只需注册 Bun workspace、声明真实内部依赖并提供包级脚本，不再编辑中央构建 layer。
- 根构建和 Desktop 开发可共享本地任务缓存；任务输入或依赖变化会沿包图自动失效。
- Turbo 配置错误可能产生错误缓存命中，因此环境变量、输出目录和不可缓存任务是受测试保护的构建合同。
- 历史实现日志仍描述当时的手写构建阶段，不回写历史；当前流程以本 ADR、`turbo.json`、package manifests 和质量文档为准。
