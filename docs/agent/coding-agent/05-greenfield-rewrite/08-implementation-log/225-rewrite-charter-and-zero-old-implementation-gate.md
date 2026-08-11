# 第 225 阶段：固定重写目标与旧实现归零门禁

## 阶段目标

本阶段暂停具体能力迁移，先修正此前只以“旧执行入口为零”衡量全面重写进度的偏差。实施内容包括：

- 固定全面重写的最终目标、必须保留项和明确舍弃项；
- 强制后续实施记录重复确认这些不变量；
- 扫描整个 monorepo 的生产源码，而不再只扫描名称带 `greenfield` 的文件；
- 使用精确依赖边基线冻结当前旧实现依赖，目标统一为零；
- 将旧格式兼容边界与其对旧实现的依赖分开统计。

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

此前 `check-legacy-execution-retirement.mjs` 只证明旧 Agent 执行链路不可达，并将名称带 `greenfield` 的部分文件到旧 Core 的依赖作为分类预算。它没有覆盖普通 Host、公共门面和 Runtime 包，因此不能证明旧内部实现已经被替换。

本阶段新增独立门禁，不改变旧执行门禁的职责：

- 旧执行门禁继续保证 Legacy 执行入口为零；
- 重写进度门禁负责保证旧实现依赖、反向依赖、旧文件和兼容入口只能通过显式基线变更收缩；
- 实施记录门禁负责保证第 225 阶段及之后不会遗忘固定目标。

## 旧实现依赖变化

新的全量口径首次建立如下基线，所有数值的最终目标均为零，旧格式边界数量除外：

| 指标 | 当前基线 | 最终目标 |
| --- | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 216 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 3 | 0 |
| 明确登记的旧实现文件 | 184 | 0 |
| `compat/*` 包导出 | 2 | 0 |
| SDK 示例旧入口依赖 | 1 | 0 |
| 保留的旧会话格式边界 | 8 | 8，直到产品迁移政策允许退役 |
| 旧格式边界到旧实现的依赖 | 3 | 0 |

精确基线记录消费文件、模块路径、导入符号、依赖类别和旧能力域。实际状态必须与基线一致：新增依赖会失败，删除依赖但未同步收缩基线也会失败，因此已移除的边不能被不经审查地换成另一条旧依赖。

主要旧实现依赖域为 Extension、Tool、Session、SessionManager、消息、资源加载、设置、系统提示词和压缩。这一结果将用于决定后续能力重写顺序，而不再由示例或兼容 API 驱动。

## 实施内容

### 固定目标合同

新增 `REWRITE-CHARTER.md`，保存本记录中的固定区块。后续记录必须原样复制该区块，而不是只通过链接间接引用。

### 重写进度门禁

新增 `check-coding-agent-rewrite-progress.mjs`：

- 扫描全部 `packages/**/src` 生产代码；
- 使用 TypeScript AST 读取静态 import、export 和字符串形式的动态 import；
- 识别相对旧 Core 导入、公开 `core/*` 深层导入、`compat/*` 和旧包根入口；
- 独立统计 Runtime 包反向依赖、旧实现文件、兼容导出和旧 SDK 示例；
- 按旧能力域输出当前进度；
- 使用 `coding-agent-rewrite.json` 保存精确基线。

### 实施记录门禁

新增 `check-coding-agent-implementation-log.mjs`：

- 只治理第 225 阶段及之后的记录，不追改历史文档；
- 要求固定区块与目标合同逐字一致；
- 要求阶段记录包含目标关系、依赖变化、行为验证和未完成替换；
- 拒绝重复阶段编号。

两个门禁均接入根 `check:guards`，对应的针对性测试接入 `test:quality`。

## 行为兼容性验证

本阶段没有修改 Agent、Tool、Storage、MCP、CLI、Desktop、RPC 或 IM 的生产行为。新增测试覆盖：

- 普通 Host 与 Runtime 包中的旧依赖可以被发现；
- 新旧实现依赖被拒绝；
- 精确基线匹配通过；
- 已删除但未同步更新的陈旧基线被拒绝；
- 旧文件、兼容导出和旧 SDK 示例分别统计；
- 实施记录固定区块一致时通过，内容变化或章节缺失时失败。

针对性测试：

```text
bunx vitest --run scripts/quality/coding-agent-rewrite-governance.test.mjs
6 tests passed
```

仓库质量检查：

```text
bun run check:quick
passed

bun run check
passed（Biome、monorepo types、CLI、Desktop、Admin、全部 guards）
```

## 尚未完成的替换

- 当前 216 条旧实现依赖尚未开始在本阶段删除。
- `runtime-storage` 仍有 2 条反向依赖，`runtime-tools` 仍有 1 条反向依赖。
- 8 个旧格式兼容边界仍有 3 条依赖旧 Core；需要保留格式读取能力，但重写解析、锁和投影实现。
- `12-full-control.ts` 仍是唯一旧 SDK 示例；它不构成架构需求，后续应删除或在真实新合同存在后重写。
- 旧 `src/core` 与显式兼容文件仍有 184 个，只有在对应行为由新实现和测试覆盖后才能逐域删除。

下一阶段应根据新门禁的能力域统计，优先解除 Runtime 包的三条反向依赖，并建立真正独立的 Storage 与 Tool 实现边界；不能通过把旧实现移动到新包来降低统计数字。
