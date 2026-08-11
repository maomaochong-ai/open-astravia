# 第 293 轮：CLI Runtime 生产合同门禁补全

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

第 292 轮已经将 CLI Runtime 测试从多后端迁移脚手收口为唯一生产 Runtime 合同，但 `verify:runtime-contract` 仍只执行 4 个文件、39 项测试，无法覆盖 CLI 生产组合中的 Plugin、MCP、Tool、Todo、Subagent、Hook、动态 Host 能力、历史会话恢复和所有权清理。

本轮不修改 Runtime 行为，而是把这些既有功能测试纳入生产合同门禁，并删除测试文件和描述中的迁移身份。历史 fixture 与 Oracle 继续用于证明旧功能兼容，但生产源码不得依赖它们。

## 实施内容

### 生产合同测试集

- `verify:runtime-contract` 从 4 个合同文件、39 项测试扩展到 26 个文件、136 项测试；
- 新合同覆盖 Runtime Host、RPC Session Adapter、Session 资源关闭、初始化失败、Print Mode、Plugin、MCP、Tool、Todo、Subagent、Ecosystem Hook、动态 Host Capability、Runtime Composition、历史会话 Fork/恢复和所有权清理；
- 使用 `--maxWorkers=4` 控制合同门禁并发度。默认无界并发下，终端流断连用例曾出现一次时序抖动；该文件单独运行和受控并发运行均稳定通过，因此没有削弱断言或改变功能语义；
- 独立可执行产物测试继续由 CLI 全量测试与宿主验收门禁覆盖，不与 Runtime 合同命令重复绑定。

### 迁移命名收口

- 10 个 `greenfield-*.test.ts` 文件改为按生产职责命名的 `*-contract.test.ts`；
- `legacy-session-fallback-narrowing.test.ts` 改为 `historical-session-import-recovery-contract.test.ts`，明确它验证历史数据导入恢复，而非旧 Runtime 执行；
- 清理 Agent 初始化、Print Mode、Runtime Host、RPC Session Adapter 和独立产物测试中的迁移描述；
- 保留 `GreenfieldRuntimeSession` 公开类型及公开 `kind` 判别值。本轮不以内部清理为由破坏跨包 API 或 wire protocol。

### 历史 Oracle 边界

- `legacy-runtime-contract.ts`、`legacy-session-fixture.ts` 和 `legacy-session-resource-fixture.ts` 继续作为测试 Oracle/fixture；
- 新增生产源码引用扫描，确保历史 Oracle 只可从测试代码使用；
- 历史会话字段和 fixture 表示数据兼容合同，不代表旧 Runtime 执行路径仍然存在。

### 类型校验判断

本轮没有新增外部不可信结构化输入，也没有改变 RPC、Session 或 Provider 数据协议。质量脚本只读取仓库内受控的 `package.json` 并使用 `JSON.parse` 提取脚本，因此无需引入 TypeBox 或 Zod。

## 防回退门禁

迁移残留审查新增以下指标与负例：

- CLI 测试文件不得重新使用 `greenfield-*` 或旧 fallback 文件名；
- 历史 Oracle 的生产源码引用必须为 `0`；
- `verify:runtime-contract` 必须包含规定的生产合同过滤器，缺失数必须为 `0`；
- 审查脚本使用结构化 JSON 解析读取 package script，避免用字符串片段猜测配置；
- 门禁测试增加迁移文件名回流、生产代码引用历史 Oracle、合同命令漏项三类失败场景。

## 旧实现依赖变化

- CLI `greenfield-*.test.ts` 文件：`10 -> 0`；
- 迁移命名的 fallback 测试文件：`1 -> 0`；
- 历史 Oracle 生产引用：保持 `0`；
- Runtime 合同缺失过滤器：`0`；
- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 用户可见功能与协议变化：`0`。

## 行为兼容性验证

- CLI Runtime 生产合同：26 个文件、136 项通过；
- CLI 包全量测试：34 个文件、183 项通过；
- 迁移残留门禁测试：24 项通过；
- `verify:agent-hosts` 通过，覆盖独立 CLI 可执行产物、coding-agent、CLI、Desktop 和 IM Gateway；其中 Desktop 组合验证 118 个文件、499 项通过、1 项跳过；
- `bun run check:quick` 通过；CLI Runtime 测试迁移文件、迁移身份、历史 Oracle 生产引用和合同缺失过滤器均为 `0/0`；
- 根级 `bun run check` 通过：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过；
- 本轮未向外部真实模型发送请求，Provider 行为由现有本地测试服务与 fixture 验证。

## 尚未完成的替换

- `GreenfieldRuntimeSession` 和公开 Runtime Host `kind` 仍是正式跨包合同；若要移除迁移词汇，需要单独的版本化 API/协议迁移，而不是内部批量改名；
- coding-agent 内仍有少量 `greenfield-*` 测试文件名和测试描述，它们不构成生产依赖，但应在后续阶段按相同原则区分生产合同、历史格式和测试 Oracle；
- 历史 Legacy 字段、fixture 和格式迁移器仍需保留，直到受支持的用户会话数据完成明确的生命周期策略；它们必须继续与生产执行实现隔离。
