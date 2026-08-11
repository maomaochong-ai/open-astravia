# 143：安装产物 Extension 门禁与 IM 默认切换

## 目标

把第 142 阶段的源码级 Extension Profile 门禁推进到标准安装产物，并在同一阶段完成 Desktop IM
Composition Root 的默认切换：

- 标准安装后的独立 Vetta CLI 必须证明已支持 Extension 进入 Greenfield；
- 未知 Extension Event 必须继续回退 Legacy，并在 stderr 给出结构化诊断；
- Desktop IM 默认选择 Greenfield，同时保留显式 Legacy 回滚；
- Provider 请求中的工具定义和顺序必须与 Legacy 完全一致，不能以“测试忽略顺序”掩盖行为变化；
- 源码进程门禁与安装产物门禁都进入 CI。

## 分析结论

### 1. 默认切换属于宿主 Composition Root

Greenfield 不是 coding-agent 内核的全局隐式默认。不同宿主仍可按自身承载能力选择 Runtime；本轮只把
Desktop IM 的 `coding-agent` 启动规格默认值改为 `greenfield-im`。CLI 的通用选择器、旧会话格式识别和
显式参数语义不变。

`VETTA_IM_AGENT_RUNTIME=legacy` 仍是明确的进程级回滚开关。空值和未配置值选择 Greenfield，未知值
继续抛错，避免拼写错误静默改变运行时。

### 2. 安装产物必须验证能力选择，而不只是验证可启动

源码测试不能覆盖单文件编译、安装目录隔离和 Extension virtual module 加载。因此安装产物测试在临时
安装目录运行真实可执行文件，并覆盖四条路径：

1. Event、Tool、Command 组合 Extension 选择 Greenfield；
2. Shortcut、Renderer 和 `user_bash` 作为 RPC 宿主不适用能力，不触发回退；
3. 未知 `future_event` 回退 Legacy，stderr 包含具体事件和未满足能力；
4. 显式 Legacy 始终进入 Legacy，且不伪造 fallback。

每个进程都通过真实 JSONL RPC `get_state` 建立会话，测试同时约束 stdout 协议纯净性。

### 3. Tool 顺序是 Provider 合同

完整切换门禁暴露了一个真实差异：Legacy 按“基础工具 → Extension/自定义宿主工具 → MCP”组装；
Greenfield 先保留 `im_send_attachment`，再把 Extension Tool 追加到末尾。这虽然不改变工具集合，却会改变
Provider 请求体和 Prompt Cache，因此不能把数组排序后再比较。

Extension Tool Surface 现先建立 Extension 段，再并入未被覆盖的 Frame 工具。带 `modelOrder` 的基础工具
仍由通用 Composer 排到前面；不带顺序值的宿主工具自然位于 Extension 之后。实现不识别
`im_send_attachment` 等具体工具名，并继续保留同名覆盖和未激活隐藏语义。

### 4. 差异测试规范化必须保留业务文本

Provider 差异测试原先在替换临时 fixture 根路径时，错误丢弃了路径前缀，导致 Extension Tool 结果文本被
截断。规范化逻辑现只替换路径片段，不再删除其前面的业务内容。这项修正使测试能够继续发现上述真实的
工具顺序偏差。

## 实施内容

### Desktop IM

- `resolveImAgentRuntimeBackend()` 的未配置和空值默认改为 `greenfield-im`；
- 显式 `legacy` 和 `greenfield-im` 保持可选；
- `buildCodingAgentSpec()` 测试同时覆盖默认切换和环境变量回滚；
- Runtime 决策观察回调继续由宿主注入，未改变 sidecar 协议。

### CLI 与 CI

- `verify:runtime-cutover` 纳入真实 Runtime 选择进程测试，不再只覆盖 Provider 差异和 Host 单测；
- 安装产物测试新增 Extension Profile 与回滚闭环；
- CI 新增独立的 `verify:artifact:installed` 步骤，标准编译/安装产物失败会阻止合入。

### coding-agent

- Extension Tool 的调用级 Frame 顺序恢复为 Legacy 合同；
- 增加单元测试约束 Extension 位于未排序宿主工具之前；
- 没有把具体 IM 工具或宿主名称写入内核与排序器。

## 功能兼容性

本轮是架构切换和验证门禁，不是功能重构：

- Extension 注册 API、事件 payload、Tool/Command 执行和动态 reload 均未修改；
- RPC JSONL Frame、会话文件格式和旧会话恢复规则未修改；
- 未知 Extension、旧 JSONL 会话和不支持的会话选择仍回退 Legacy；
- 显式 Legacy 回滚继续有效；
- Tool 集合、Schema、执行结果和 Provider 顺序与 Legacy 保持一致。

## Schema 决策

没有引入 TypeBox 或 Zod。本轮没有新增外部输入、持久化格式或网络协议；Extension Profile 继续使用
TypeScript 穷尽类型，RPC Frame 继续复用既有 TypeBox 校验边界。为进程内默认值或测试 fixture 再增加
运行时 Schema 不会提升边界安全性。

## 测试

通过的验证：

```text
bunx vitest --run test/runtime-core/greenfield-extension-tool-runtime.test.ts（coding-agent，4 项）
bun run verify:runtime-cutover（cli-app，34 项）
bun run verify:artifact:installed（cli-app，4 项）
bunx vitest --run src/main/im-host/coding-agent-spec.test.ts（desktop-app，5 项）
bun run check:quick
bun run check
```

## 结果

Desktop IM 已默认进入 Greenfield，显式 Legacy、旧会话和未知能力回退仍保留。源码进程和标准安装产物
现在共同约束 Extension Profile、Runtime 选择、Provider 工具顺序与 JSONL 协议，不再存在“源码测试通过、
安装后能力选择失真”的空档。

## 下一步

下一阶段应收敛剩余 Legacy fallback 的生产责任：为 `legacy-session` 和
`unsupported-session-selection` 建立可观察的命中基线，区分长期格式兼容与仍需迁移的交互式会话选择，
然后只关闭有真实宿主差分门禁覆盖的回退分支。不要直接删除 Legacy Runtime，也不要把旧格式迁移与执行
内核退役混成一个阶段。
