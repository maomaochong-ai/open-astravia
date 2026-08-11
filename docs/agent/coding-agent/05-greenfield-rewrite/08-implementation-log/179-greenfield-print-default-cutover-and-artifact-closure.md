# 第 179 轮：Greenfield Print 默认切换与安装产物闭环

## 目标

第 178 轮已经证明显式 Greenfield Print 与 Legacy 的高风险行为一致，但标准 Print 调用仍默认 Legacy，而且 Greenfield 启动依赖测试注入的 `--session-dir`。本轮统一会话目录宿主策略，将 Print 默认切换到 Greenfield，保留显式 Legacy 和结构化自动回退，并使用最终单文件可执行产物完成验证。

## 审计结论

### 1. 默认切换不能只修改 Runtime Selector

Legacy `SessionManager` 在没有 `--session-dir` 时会按 cwd 计算默认目录；Greenfield 组合此前直接拒绝缺失目录。若只把 `defaultBackend()` 改为 Greenfield，真实的 `vetta --print` 会在启动阶段失败。

会话目录是宿主存储策略，不属于 Agent Kernel。Legacy 和 Greenfield 必须消费同一个宿主解析结果，不能在 CLI 复制路径编码规则。

### 2. 自动回退必须继续由结构化证据驱动

默认 Greenfield 后，Extension 能力缺口和不可表示的旧会话仍允许回退；Provider 错误、Tool 错误和普通 Runtime 缺陷不能触发 Legacy。既有穷尽回退策略已满足该边界，本轮通过默认 Print 进程补齐门禁，没有增加宽泛的 catch fallback。

### 3. 临时 Bundle 不能代表最终发布能力

原 Print 测试运行依赖工作区 Bun 和源码包路径，无法发现单文件产物缺少动态依赖的问题。切换到真实编译产物后，测试发现 Photon WASM 和 CommonJS 模块没有进入单文件闭包，图片被降级为省略说明。

该问题属于发布产物能力缺失，不能通过降低图片断言规避。最终产物需要同时嵌入 WASM，并给图片适配器注入编译期可发现的延迟模块加载器。

## 实施内容

### 统一会话目录宿主策略

新增 `resolveCodingAgentSessionDir(cwd, sessionDir?)`：

- 显式目录原样优先。
- 未提供目录时沿用既有 cwd 安全编码和 Coding Agent sessions 根目录。
- 负责创建解析后的默认目录。
- 通过 `@vetta/coding-agent/bootstrap` 暴露给 CLI Composition Root。

Legacy `getDefaultSessionDir()` 改为委托该策略，因此旧新 Runtime 不再各自维护默认目录规则。

### Print 默认 Greenfield

Runtime 默认选择现在为：

- control：Legacy 控制入口，不创建 Session Runtime。
- print：Greenfield。
- ordinary RPC：Greenfield。
- IM RPC：Greenfield IM。

显式 `--agent-runtime legacy`、显式 Greenfield 和 Greenfield IM 的限制均保留。Greenfield CLI 启动使用统一会话目录，不再要求用户传入 `--session-dir`。

### 自动回退边界

最终产物测试确认：

- 不支持的 Extension event 以 `legacy-extension` 结构化回退，并报告具体 event/capability 缺口。
- 不可表示的旧会话以 `legacy-session` 结构化回退，Legacy 继续写入既有源会话。
- 回退前的旧记录保持为文件前缀，没有发布错误的 Greenfield conversation。
- Tool 返回错误和 Provider 401 不触发 Legacy 回退。

### 单文件图片能力闭包

Standalone 编译入口现在：

- 以 Bun file asset 嵌入 `photon_rs_bg.wasm`。
- 向 Photon wrapper 注入嵌入资产路径。
- 注入编译期可发现的 Photon 延迟模块加载器，使 CommonJS 模块本身进入可执行文件。
- 仍在首次图片处理时加载 Photon，不改变普通启动时序。

源码/Node 环境继续使用既有 `require()` fallback；旧 sidecar WASM 路径也继续兼容。

### 最终产物 Print 门禁

Print 测试不再执行临时 `.mjs` Bundle，而是通过正式 `compile-standalone.mjs` 生成并直接运行仓库外单文件可执行产物。测试进程不注入：

- `--session-dir`。
- `VETTA_PACKAGE_DIR`。
- 工作区 Bun 运行时入口。

18 项场景覆盖默认/显式 Runtime、JSON/Text、piped stdin、附件、完整 Tool Loop、Tool 错误、Provider HTTP/断连/401、retry、Extension 错误与回退、跨进程 continue、旧会话回退和 control 命令。

## TypeBox / Zod 判断

本轮没有新增 wire、配置或持久化数据格式。会话目录和 Photon loader 都是内部宿主组合值，因此无需引入 TypeBox/Zod。既有 Provider 请求测试继续使用 Zod 校验外部请求边界。

## 测试与验证

- 最终单文件 Print 产物：1 个文件、18 项通过。
- Runtime 默认选择与 RPC 回归：1 个文件、10 项通过。
- 图片处理源码回归：1 个文件、11 项通过。
- `bun run check:quick` 通过，包含 standalone CLI build guard。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。

## 明确未修改

- 没有删除 Legacy Print、Legacy RPC adapter 或旧会话兼容代码。
- 显式 `--agent-runtime legacy` 仍可用。
- Tool 名称、参数、描述、结果和执行逻辑未重构。
- Prompt、Skill、MCP、Knowledge、Memory、Extension wire 和会话格式未修改。
- 自动回退允许集合没有扩大。
- 普通 RPC、IM 和 Desktop 的既有默认选择没有改变。

## 尚未闭合

CLI Print、普通 RPC、IM 和 Desktop 的默认生产路径均已进入 Greenfield，但安装产物仍包含 Legacy 执行实现，用于显式选择和两类结构化兼容回退。尚不能删除 Legacy；必须先确认剩余真实回退缺口，并把格式兼容、迁移能力与旧执行实现的依赖进一步分开。

## 下一步

下一阶段应进行 Legacy 执行隔离与移除准备审计：建立生产入口到 Legacy 执行的静态 allowlist 和真实进程门禁，分别统计显式 Legacy、Extension 能力回退和旧会话回退；随后按能力缺口逐项关闭回退原因。此阶段先收紧依赖和证明边界，不直接删除仍被兼容路径使用的功能。
