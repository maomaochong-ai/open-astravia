# 第 199 阶段：Runtime Tool Surface

## 阶段目标

第 198 阶段分离 Session Initialization Transaction 后，`greenfield-runtime-composition.ts` 仍直接组合 Coding Tools、Knowledge Tools 与 MCP Coordinator，并内嵌单次模型调用的工具激活策略。

本阶段建立独立 Runtime Tool Surface：Composition Root 只选择并持有该子组合，不再理解工具注册顺序、Knowledge 激活、Session 动态覆盖、MCP Registry 同步或渐进披露细节。只重构架构，不修改原有工具功能与宿主合同。

## 实施前边界确认

这组逻辑具有共同生命周期和稳定合同：

- Coding Tool Registry 必须先创建，MCP Coordinator 才能向其中动态注册工具；
- MCP 初始同步失败时，必须释放已创建的 Coding Tools；
- 每次模型调用前必须刷新 MCP Catalog；
- Session Configuration 决定本次调用的 Agent Mode 与显式 Tool Override；
- Session Execution Runtime 拥有的工具不能在通用 Coding Tool Frame 中重复暴露；
- Knowledge Tool 必须同时满足宿主可用性与 Knowledge 场景策略；
- MCP Deferred Controller 决定动态 MCP Tool 是否已经对当前 Session 可见。

因此本阶段提取的是一个完整 Tool Surface 生命周期，而不是按行数移动若干 helper。

## 实施过程

### 1. 分离纯 Tool Activation Policy

新增：

`packages/coding-agent/src/composition/greenfield-tool-activation-policy.ts`

该文件只负责：

- Turn 级显式 Tool Override 优先级；
- Composition 级显式激活保持；
- Background Task capability 注入；
- Knowledge capability 注入；
- Agent Mode 透传；
- Knowledge Processing scope 与 `knowledge_mode_instruction` 判断。

策略不持有 Registry、MCP 或 Session Index，可独立测试。

### 2. 建立 Runtime Tool Surface

新增：

`packages/coding-agent/src/composition/greenfield-runtime-tool-surface.ts`

Tool Surface 统一组合：

- 既有 `CodingToolsRuntimeComposition`；
- Knowledge Tag List 与 Tag Filter 工具；
- 继承自父 Session 的 MCP Tool View；
- 共享 MCP Session Coordinator；
- Session Configuration、Execution Runtime 和 Deferred MCP Controller 索引；
- 模型调用前 MCP Catalog 刷新；
- Tool Registration 最终过滤。

初始化顺序仍为 `Coding Tools -> MCP Coordinator`。MCP Coordinator 创建失败时，Tool Surface 立即释放 Coding Tools，再向上抛出原始错误。

### 3. 保留动态 Session 读取语义

实施中专门区分了两个调用边界：

- Coding Tools 的模型调用 resolver 会读取当前 Session Configuration 中的 Agent Mode 和 Active Tool Override；
- 对外暴露的纯 `resolveActivation` 只使用调用方显式传入的状态。

该区分保留原实现语义，避免把默认参数绑定到 Session Index 后，使原本省略 override 的 Extension/Product Tool 调用意外继承动态覆盖。

### 4. 收窄 Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

Root 删除了以下直接责任：

- Coding Tool Registry 创建；
- Knowledge Tool 注册与模型顺序；
- Tool Activation 与 Knowledge Activation 策略；
- Execution-owned Tool 过滤；
- MCP Tool 注册、注销与 Catalog 刷新接线；
- Tool Surface 部分初始化失败清理。

Root 现在只创建 Resource Registry，调用 `createGreenfieldRuntimeToolSurface()`，再把返回的 Tools、Coordinator、Activation 与 resolver 接入 Session Initialization Transaction 和 Composition Shutdown。

主文件由 342 行降为 239 行；新 Tool Surface 为 148 行，纯 Activation Policy 为 37 行。

### 5. 增加测试与架构守卫

新增：

`packages/coding-agent/test/runtime-core/greenfield-tool-activation-policy.test.ts`

覆盖：

- Turn override 优先于 Composition 显式激活；
- 没有 override 时保持显式激活对象；
- Background、Knowledge capability 与 Agent Mode 合成；
- Knowledge 不可用时 fail-closed；
- Knowledge Processing scope 与 instruction context 激活；
- 无关 context 不激活 Knowledge。

修改质量守卫，禁止 Composition Root 重新直接引用 Coding Tool 组合、Knowledge Tool factory、模型顺序、MCP Coordinator factory 或 Tool Activation Policy；Root 只允许依赖 Runtime Tool Surface。

## 功能兼容性核对

- Coding Tools 的名称、描述、scope、requires、执行器与模型顺序未修改；
- Tool Registry 仍可在运行时动态注册和移除工具，不使用 Session 或进程级冻结快照；
- Active Tool Override 仍在每次模型调用时读取；
- Background Task capability 仍由真实 Background Service 可用性决定；
- Knowledge Tool 仍遵守宿主禁用开关与 Knowledge Mode fail-closed；
- MCP 仍在模型调用前刷新，新增和删除立即反映到下一次调用；
- Deferred MCP visibility、显式 MCP eager activation 与 Session 隔离未改变；
- Workflow Child 仍继承父级 MCP Tool View；
- Execution Runtime 拥有的工具仍不会重复出现在 Coding Tool Frame；
- MCP 初始化失败后的 Coding Tools 清理顺序未改变；
- 公共 Composition API、工具选项与宿主调用方式未改变。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。Tool Surface 接收的全部内容都是进程内强类型端口和已校验对象，没有新增 JSON、配置文件、RPC、MCP wire payload 或持久化输入边界。

## 验证结果

Coding Agent Activation、MCP、Session Initialization 与 Turn Capability 回归：

```text
4 files passed
11 tests passed
```

CLI Runtime Composition、Plugin MCP 与 Ownership 回归：

```text
3 files passed
19 tests passed
```

真实 Vetta RPC CLI 初始化失败回归：

```text
1 file passed
2 tests passed
```

质量守卫：

```text
1 file passed
47 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2078 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

Runtime Tool Surface 现在是独立的能力组合边界：底层 `runtime-tools` 提供通用 Registry 与 Feature，Coding Agent Tool Surface 选择产品工具并协调 Knowledge/MCP，Composition Root 只装配生命周期。

下一阶段应审计剩余 239 行 Root 中的 Composition Bootstrap 与宿主 facade，优先寻找具有独立资源生命周期或可替换端口的真实边界；Legacy 删除仍应作为单独的破坏性迁移阶段处理。
