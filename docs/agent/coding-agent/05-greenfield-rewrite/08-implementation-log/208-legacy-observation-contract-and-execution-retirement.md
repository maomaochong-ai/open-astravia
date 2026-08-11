# 第 208 阶段：Legacy Observation Contract 与执行实现退役

## 目标

本阶段把第 207 阶段保留的 Legacy 测试参照冻结为版本化观察合同，并彻底删除 Legacy 执行实现，同时严格保留既有会话格式、迁移和 MCP 兼容能力：

- Legacy 执行边从 7 条降为 0；
- `@vetta/coding-agent` 的 Legacy package exports 从 3 个降为 0；
- 保留 8 条 Legacy 会话格式与迁移边界；
- Print、RPC、Provider、工具、会话替换与 Desktop Host 的可观察行为由显式合同或业务断言覆盖；
- `--agent-runtime legacy` 继续作为兼容输入映射到 Canonical Greenfield Host，不再激活旧实现。

## 实施前事实

第 207 阶段已经完成可执行所有权切换，但仍保留以下内部执行参照：

1. `coding-agent/src/main.ts` 与 Legacy Print Session Adapter；
2. Runtime Core 的 Legacy Composition、Session Backend、Ports、Services 和事件映射；
3. Legacy Knowledge Processing Session Factory；
4. `./legacy/session`、`./legacy/tools`、`./legacy/host-services` 三个 package exports；
5. CLI 测试中的 Legacy CLI/RPC 动态入口；
6. 大量以“同时运行 Legacy 与 Greenfield，再比较结果”为形式的差分测试。

其中 Print 核心事件测试存在一个重要问题：所谓 Legacy 与 Greenfield 两次观察实际都启动了 Canonical 可执行产物，形成了自比较。它不能证明 Legacy 兼容性，也不能作为删除旧实现后的长期合同。

## 实施内容

### 1. 冻结版本化观察合同

新增 `legacy-runtime-contract-v1.json`，记录删除执行参照前需要长期保持的归一化可观察结果：

- Print 核心事件顺序；
- Tool Execution 起止帧；
- Provider HTTP/断流重试结果；
- 不可重试错误与文本模式退出状态；
- RPC 流式生命周期与终止帧；
- Windows/POSIX 默认 Coding Tool 名称集合。

合同通过 Zod 在测试运行时解析，并固定 `schemaVersion: 1`。这里引入运行时校验是必要的：fixture 是独立 JSON 数据，TypeScript 无法验证文件内容；错误字段、错误版本或错误数据类型必须在测试收集阶段立即失败。

该合同不是 Runtime 快照、Turn 快照或能力注册快照。工具、Prompt、Skill 等动态能力仍在每个模型调用边界按现有机制解析；合同只冻结删除 Legacy 执行参照后必须保持的外部观察结果。

### 2. 删除动态 Legacy 测试 Oracle

CLI 测试不再编译或运行旧 `main.ts`：

- 删除测试专用 Legacy CLI 入口；
- 删除测试专用 Legacy RPC 入口；
- `agent-rpc-test-process` 只构建 Canonical RPC 可执行产物；
- 测试请求 `legacy` 时仍把它作为用户兼容输入传给 Canonical CLI，验证其映射行为；
- Provider、Extension、Session Transition、Replacement、Admission、Terminal 和资源关闭测试改为运行 Greenfield，并对显式历史期望或版本化合同断言；
- 删除由机械迁移产生的 Greenfield 自比较断言。

Print 事件合同最终按真实 Canonical JSONL 输出记录了启动阶段的空 assistant 消息边界和实际 assistant 输出边界，避免把错误的七帧猜测固化为合同。

### 3. 删除 Legacy 执行实现

删除 Coding Agent 中不再可达的执行实现：

- Legacy `main`；
- Legacy Print Session Adapter；
- Runtime Core Legacy Composition；
- Legacy Session Backend；
- Legacy Session Ports 与 Services；
- Legacy AgentSession 事件适配；
- Legacy Knowledge Processing Session Factory；
- Legacy Session、Tools、Host Services 公共转发文件。

同时从 Runtime Core Adapter 和 Composition 索引中删除对应导出，清理根 `tsconfig`、Desktop `tsconfig` 与 Vitest alias，防止源码路径映射继续伪装已经退役的公开面。

### 4. 收缩 package exports

`@vetta/coding-agent` 删除以下导出：

- `./legacy/session`；
- `./legacy/tools`；
- `./legacy/host-services`。

中立兼容面继续存在：

- `./host-services`；
- `./compat/runtime-storage`；
- `./compat/runtime-tools`；
- Bootstrap、RPC、Profile、Knowledge 和 Resource 等现有中立入口。

公开 subpath 测试现在显式断言 package manifest 中不存在任何 `./legacy/*` 导出。

### 5. 保留格式、迁移与 MCP 边界

本阶段没有删除名称中包含 Legacy 但职责属于数据兼容的模块。保留内容包括：

- Legacy Session JSONL 识别、读取和规范化；
- Legacy Session 到 Runtime Conversation 的迁移；
- Desktop Legacy Session Migration Backend；
- Legacy MCP 输入结构适配；
- Legacy History/Model Registry 等中立兼容控制器。

退役守卫继续分别统计“执行边”和“格式边界”，避免以后为了消除 Legacy 命名而误删用户历史数据兼容能力。

### 6. 退役守卫归零

退役门禁的执行基线与 package export 基线均改为空数组，并登记所有已退役文件，防止它们被重新引入：

```text
[legacy-execution] ok (0 execution edge(s), 8 retained format boundary(s), 98 Greenfield shared-core import(s))
```

门禁同时验证：

- 已退役文件不存在；
- production/test config 不再引用 Legacy 执行入口；
- package manifest 不再发布 Legacy subpath；
- 8 条格式与迁移边界仍然存在。

## 测试调整原则

本阶段只重构架构和测试 Oracle，没有重构功能：

- 原差分测试中已有明确业务期望的，保留明确期望；
- 只有动态 Legacy 比较、没有明确期望的，补充 Provider Frame、工具集合、生命周期或错误类型断言；
- 删除只验证已删除实现内部装配细节的 Runtime Core Legacy Adapter 测试；
- 保留并运行中立 Runtime Host 路由、Session Model View、Session Services 和迁移边界测试；
- Desktop 差分测试改为 Canonical Host 合同测试，继续覆盖 Tool Loop、历史恢复、并发所有权、动态能力、Skill 增删改和多场景 Model Call Frame。

## 验证记录

- CLI 定向合同与集成测试：13 个文件、79 项测试通过；
- Coding Agent 公开面、控制命令、身份切换和 Knowledge Processing：4 个文件、27 项测试通过；
- Runtime Core 中立 Session Host：3 个文件、9 项测试通过；
- Desktop Canonical Host、Model Call Frame 与迁移边界：4 个文件、20 项测试通过；
- Legacy retirement quality gate：6 项测试通过；
- `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、monorepo tsgo、CLI 独立类型检查、Desktop 独立类型检查、Admin project build 与全部 guards 通过。

Windows 沙箱内的 Bun/Vitest worker 无法正确处理 file URL，并且集成测试需要在系统临时目录生成一次性可执行产物，因此定向测试使用工作区提供的 Node 运行 Vitest；需要临时产物的测试在授权后运行。最终 `bun run check` 因 Admin 已安装声明文件的 ACL 不允许沙箱身份读取，也在沙箱外完成。两类调整都未改变测试代码或质量门语义。

## 兼容性结论

- Canonical CLI、RPC、Print、Tool、Provider、Extension、Session Replacement 和 Desktop Host 行为保持；
- `--agent-runtime legacy` 参数仍被接受，并明确映射为 Greenfield；
- 用户已有 Legacy Session 文件仍可读取、迁移或得到显式不兼容错误；
- MCP 兼容输入不受影响；
- `@vetta/coding-agent/legacy/session`、`legacy/tools` 和 `legacy/host-services` 已删除，属于公开破坏性变化，发布时应按 minor release 处理；
- Runtime 中已经不存在可被回滚激活的 Legacy 执行后端。

## 下一阶段建议

第 209 阶段应处理当前守卫记录的 98 条 Greenfield shared-core imports，而不是继续删除格式兼容代码：

1. 按 Kernel、Conversation、Capability、Host Adapter、产品工具和纯兼容格式分类 98 条 import；
2. 找出 Greenfield Runtime 仍直接依赖旧 `coding-agent/core`、`host` 或交互模式内部实现的真实反向边；
3. 将多宿主共用且职责中立的能力迁移到现有 Runtime 包或明确的 Coding Agent Host Adapter 公共面；
4. 对单宿主、单用途代码保持原位，避免为追求零 import 制造无意义抽象；
5. 在每次迁移后保持 Canonical CLI、Desktop、Knowledge Processing 和动态能力合同不变；
6. 评估旧 `AgentSession` 是否已只剩兼容/交互用途，再决定后续退役范围。

下一阶段的目标不是把 98 条机械降为 0，而是形成有证据的依赖分类，并只消除违反内核、能力编排和宿主适配边界的 import。
